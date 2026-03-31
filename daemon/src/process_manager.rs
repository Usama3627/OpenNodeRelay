use serde::Serialize;
use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub id: String,
    pub command: String,
    pub state: ProcessState,
    pub exit_code: Option<i32>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Running,
    Completed,
    Failed,
}

impl std::fmt::Display for ProcessState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessState::Running => write!(f, "running"),
            ProcessState::Completed => write!(f, "completed"),
            ProcessState::Failed => write!(f, "failed"),
        }
    }
}

#[derive(Debug, Clone)]
pub enum ProcessEvent {
    Log {
        process_id: String,
        stream: String,
        line: String,
    },
    StateChange {
        process_id: String,
        state: String,
        exit_code: Option<i32>,
    },
}

// ---------------------------------------------------------------------------
// Internal bookkeeping
// ---------------------------------------------------------------------------

struct ManagedProcess {
    info: ProcessInfo,
    /// `None` once the process has exited.
    kill_handle: Option<tokio::process::Child>,
}

// ---------------------------------------------------------------------------
// ProcessManager
// ---------------------------------------------------------------------------

pub struct ProcessManager {
    processes: HashMap<String, ManagedProcess>,
    event_tx: mpsc::Sender<ProcessEvent>,
}

impl ProcessManager {
    pub fn new(event_tx: mpsc::Sender<ProcessEvent>) -> Self {
        Self {
            processes: HashMap::new(),
            event_tx,
        }
    }

    /// Spawn a new child process via `sh -c <command>` (unix) or `cmd /C <command>` (windows).
    /// Returns the process id (UUID).
    pub fn spawn(&mut self, command: String) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();

        let mut child = build_command(&command)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn process: {e}"))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let started_at = chrono_now();

        let info = ProcessInfo {
            id: id.clone(),
            command: command.clone(),
            state: ProcessState::Running,
            exit_code: None,
            started_at,
        };

        // Send initial state change
        let tx = self.event_tx.clone();
        let id_clone = id.clone();
        tokio::spawn(async move {
            let _ = tx
                .send(ProcessEvent::StateChange {
                    process_id: id_clone,
                    state: "running".to_string(),
                    exit_code: None,
                })
                .await;
        });

        // Spawn reader tasks for stdout / stderr
        if let Some(out) = stdout {
            self.spawn_reader(id.clone(), "stdout".to_string(), out);
        }
        if let Some(err) = stderr {
            self.spawn_reader(id.clone(), "stderr".to_string(), err);
        }

        // Spawn a task that waits for the child to exit and updates state
        self.spawn_waiter(id.clone(), &mut child);

        self.processes.insert(
            id.clone(),
            ManagedProcess {
                info,
                kill_handle: Some(child),
            },
        );

        Ok(id)
    }

    /// Send SIGTERM to the process. If it doesn't exit within 5 seconds, send SIGKILL.
    pub async fn kill(&mut self, process_id: &str) -> Result<(), String> {
        let proc = self
            .processes
            .get_mut(process_id)
            .ok_or_else(|| format!("process {process_id} not found"))?;

        let child = match proc.kill_handle.as_mut() {
            Some(c) => c,
            None => return Err("process already exited".to_string()),
        };

        // Try SIGTERM first (on unix) or kill (on windows)
        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                // SIGTERM
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = child.start_kill();
        }

        // Give it 5 seconds, then SIGKILL
        let id_for_kill = child.id();
        let wait_result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            child.wait(),
        )
        .await;

        match wait_result {
            Ok(Ok(_status)) => {
                // Exited gracefully after SIGTERM – the waiter task will update state.
            }
            _ => {
                // Timed out or error – force kill
                #[cfg(unix)]
                {
                    if let Some(pid) = id_for_kill {
                        unsafe {
                            libc::kill(pid as i32, libc::SIGKILL);
                        }
                    }
                }
                #[cfg(not(unix))]
                {
                    let _ = child.kill().await;
                }
            }
        }

        Ok(())
    }

    /// Return info for all tracked processes.
    pub fn list(&self) -> Vec<ProcessInfo> {
        self.processes.values().map(|p| p.info.clone()).collect()
    }

    /// Update process state from the waiter task. Called internally.
    pub fn mark_exited(&mut self, process_id: &str, exit_code: Option<i32>) {
        if let Some(proc) = self.processes.get_mut(process_id) {
            proc.kill_handle = None;
            proc.info.exit_code = exit_code;
            proc.info.state = if exit_code == Some(0) {
                ProcessState::Completed
            } else {
                ProcessState::Failed
            };
        }
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    fn spawn_reader<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
        &self,
        process_id: String,
        stream: String,
        reader: R,
    ) {
        let tx = self.event_tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx
                    .send(ProcessEvent::Log {
                        process_id: process_id.clone(),
                        stream: stream.clone(),
                        line,
                    })
                    .await;
            }
        });
    }

    fn spawn_waiter(&self, process_id: String, child: &mut tokio::process::Child) {
        // We cannot move child into the future because we store it in ManagedProcess.
        // Instead we take the child's id and poll via a shared-state pattern.
        // However tokio::process::Child::wait requires &mut self.
        //
        // The cleanest approach: extract the child's wait handle before storing.
        // Unfortunately Child doesn't expose that directly.
        //
        // Alternative: we store the child in an Arc<Mutex<>>, but that complicates kill().
        //
        // Practical approach: we'll rely on the reader tasks ending (EOF) as a signal,
        // plus a separate task that just periodically checks. But the simplest Tokio
        // pattern is: DON'T store the Child at all for waiting, just store the pid and
        // use `kill_handle` only for sending signals.
        //
        // Actually the best approach: use `child.wait()` in a task and send an event.
        // We can't do that if we also store the child. So we'll store the child id (OS pid)
        // for kill purposes and move the Child into the waiter task, but expose a
        // JoinHandle so kill() can signal it.
        //
        // Let's keep it simple: we don't call child.wait() here. The waiter is handled
        // externally via the `try_wait` approach driven by the event loop.
        // See: `poll_processes` below.

        // We do nothing here; polling is done via poll_processes.
        let _ = (process_id, child);
    }

    /// Poll all running processes to check if they've exited.
    /// Should be called periodically from the main loop.
    pub fn poll_processes(&mut self) {
        let mut updates: Vec<(String, Option<i32>)> = Vec::new();

        for (id, proc) in self.processes.iter_mut() {
            if proc.info.state != ProcessState::Running {
                continue;
            }
            if let Some(ref mut child) = proc.kill_handle {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        updates.push((id.clone(), status.code()));
                    }
                    Ok(None) => {} // still running
                    Err(_) => {
                        updates.push((id.clone(), None));
                    }
                }
            }
        }

        for (id, exit_code) in updates {
            let state_str = if exit_code == Some(0) {
                "completed"
            } else {
                "failed"
            }
            .to_string();

            self.mark_exited(&id, exit_code);

            let tx = self.event_tx.clone();
            let id_clone = id.clone();
            tokio::spawn(async move {
                let _ = tx
                    .send(ProcessEvent::StateChange {
                        process_id: id_clone,
                        state: state_str,
                        exit_code,
                    })
                    .await;
            });
        }
    }
}

fn build_command(command: &str) -> Command {
    #[cfg(unix)]
    {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    }
    #[cfg(not(unix))]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }
}

/// Simple ISO-8601-ish timestamp without pulling in chrono.
fn chrono_now() -> String {
    use std::time::SystemTime;
    let dur = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    // Return seconds since epoch – good enough without an extra crate.
    format!("{}", dur.as_secs())
}
