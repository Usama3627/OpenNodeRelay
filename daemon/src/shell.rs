use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use tokio::sync::mpsc;
use tracing::info;

/// Events emitted by the shell session
#[derive(Debug, Clone)]
pub enum ShellEvent {
    Output { stream: String, line: String },
    Exited { code: Option<i32> },
}

/// A persistent shell session running in a PTY.
/// Interactive programs (claude, vim, etc.) work because they see a real terminal.
pub struct ShellSession {
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

impl ShellSession {
    pub fn spawn(event_tx: mpsc::Sender<ShellEvent>) -> Result<Self, String> {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        info!("spawning PTY shell: {}", shell);

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to open PTY: {e}"))?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("LANG", "en_US.UTF-8");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn shell: {e}"))?;

        // Drop the slave side — we only use the master
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("failed to take PTY writer: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("failed to clone PTY reader: {e}"))?;

        // Spawn a thread to read PTY output and send it to the event channel.
        // We use a std thread because portable-pty readers are blocking.
        let tx = event_tx;
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = tx.blocking_send(ShellEvent::Exited { code: None });
                        break;
                    }
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        // Split into lines but preserve partial lines
                        // PTY output comes as raw bytes, send as chunks
                        let _ = tx.blocking_send(ShellEvent::Output {
                            stream: "stdout".to_string(),
                            line: text,
                        });
                    }
                    Err(e) => {
                        info!("PTY read error (shell likely exited): {}", e);
                        let _ = tx.blocking_send(ShellEvent::Exited { code: None });
                        break;
                    }
                }
            }
        });

        Ok(ShellSession {
            writer,
            _child: child,
            _master: pair.master,
        })
    }

    pub fn write_input(&mut self, input: &str) -> Result<(), String> {
        self.writer
            .write_all(input.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        self.writer
            .flush()
            .map_err(|e| format!("flush failed: {e}"))?;
        Ok(())
    }

    /// Resize the PTY (e.g., when the mobile app reports its terminal size).
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self._master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }
}
