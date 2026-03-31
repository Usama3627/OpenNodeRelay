mod config;
mod process_manager;
mod protocol;
mod shell;
mod signaling;
mod webrtc;

use config::Config;
use protocol::{Action, output_msg, pong_msg};
use shell::{ShellEvent, ShellSession};
use signaling::{SignalCommand, SignalEvent};
use webrtc::{Peer, RtcEvent};

use rand::Rng;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

fn generate_pairing_code() -> String {
    let chars: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| chars[rng.gen_range(0..chars.len())] as char)
        .collect()
}

fn print_pairing_banner(machine_id: &str, code: &str) {
    let short_id = if machine_id.len() > 13 {
        &machine_id[..13]
    } else {
        machine_id
    };
    println!();
    println!("\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}");
    println!("  OpenNodeRelay Daemon Ready");
    println!("  Machine ID: {}...", short_id);
    println!("  Pairing Code: {}", code);
    println!("  Enter this code in your OpenNodeRelay app to pair.");
    println!("\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}");
    println!();
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = Config::load_or_create().expect("failed to load config");
    info!(machine_id = %config.machine_id, "starting opennoderelay-daemon v0.3.0");

    loop {
        if let Err(e) = run_session(&config).await {
            error!("session error: {:#}", e);
        }
        info!("restarting session in 3s...");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

async fn run_session(config: &Config) -> anyhow::Result<()> {
    let pairing_code = generate_pairing_code();
    print_pairing_banner(&config.machine_id, &pairing_code);

    // Channels
    let (signal_event_tx, mut signal_event_rx) = mpsc::channel::<SignalEvent>(64);
    let (signal_cmd_tx, signal_cmd_rx) = mpsc::channel::<SignalCommand>(64);
    let (rtc_event_tx, mut rtc_event_rx) = mpsc::channel::<RtcEvent>(256);
    let (shell_event_tx, mut shell_event_rx) = mpsc::channel::<ShellEvent>(4096);

    // Start signaling
    let sig_url = config.signaling_url.clone();
    let code = pairing_code.clone();
    let sig_event_tx = signal_event_tx.clone();
    let _signaling_handle = tokio::spawn(async move {
        if let Err(e) =
            signaling::run_signaling(&sig_url, &code, sig_event_tx, signal_cmd_rx).await
        {
            warn!("signaling ended: {:#}", e);
        }
    });

    // Create WebRTC peer
    let peer = Arc::new(Mutex::new(Peer::new(
        rtc_event_tx.clone(),
        signal_cmd_tx.clone(),
    )?));

    let mut datachannel_open = false;
    let mut shell_session: Option<ShellSession> = None;

    info!("waiting for app to connect via signaling...");

    loop {
        tokio::select! {
            // Signaling events
            Some(event) = signal_event_rx.recv() => {
                match event {
                    SignalEvent::Offer { sdp } => {
                        info!("received SDP offer from app");
                        let mut p = peer.lock().unwrap();
                        if let Err(e) = p.handle_offer(&sdp) {
                            error!("failed to handle offer: {}", e);
                        }
                    }
                    SignalEvent::IceCandidate { candidate, mid } => {
                        let mut p = peer.lock().unwrap();
                        if let Err(e) = p.add_ice_candidate(&candidate, &mid) {
                            error!("failed to add ICE candidate: {}", e);
                        }
                    }
                }
            }

            // WebRTC events
            Some(event) = rtc_event_rx.recv() => {
                match event {
                    RtcEvent::DataChannelOpen => {
                        info!("P2P data channel established!");
                        datachannel_open = true;
                        let _ = signal_cmd_tx.send(SignalCommand::Done).await;

                        // Spawn persistent shell session
                        match ShellSession::spawn(shell_event_tx.clone()) {
                            Ok(session) => {
                                info!("shell session started");
                                shell_session = Some(session);
                            }
                            Err(e) => {
                                error!("failed to start shell: {}", e);
                            }
                        }
                    }
                    RtcEvent::DataChannelClosed => {
                        warn!("data channel closed");
                        return Ok(());
                    }
                    RtcEvent::Message(text) => {
                        match protocol::parse_message(&text) {
                            Action::Input { text: input } => {
                                if let Some(ref mut session) = shell_session {
                                    if let Err(e) = session.write_input(&input) {
                                        error!("shell write failed: {}", e);
                                    }
                                }
                            }
                            Action::Resize { rows, cols } => {
                                if let Some(ref session) = shell_session {
                                    if let Err(e) = session.resize(rows, cols) {
                                        warn!("PTY resize failed: {}", e);
                                    } else {
                                        info!("PTY resized to {}x{}", cols, rows);
                                    }
                                }
                            }
                            Action::Ping => {
                                let p = peer.lock().unwrap();
                                let _ = p.send(&pong_msg());
                            }
                            Action::Unknown => {
                                warn!("unknown message: {}", &text[..text.len().min(80)]);
                            }
                        }
                    }
                    RtcEvent::ConnectionStateChange(state) => {
                        if state.contains("Failed") || state.contains("Disconnected") || state.contains("Closed") {
                            if datachannel_open {
                                warn!("P2P connection lost: {}", state);
                                return Ok(());
                            }
                        }
                    }
                }
            }

            // Shell output -> forward to app
            Some(event) = shell_event_rx.recv() => {
                if datachannel_open {
                    match event {
                        ShellEvent::Output { stream, line } => {
                            let msg = output_msg(&stream, &line);
                            let p = peer.lock().unwrap();
                            if let Err(e) = p.send(&msg) {
                                warn!("failed to send shell output: {}", e);
                            }
                        }
                        ShellEvent::Exited { code } => {
                            info!("shell exited with code: {:?}", code);
                            let msg = output_msg("system", &format!("[shell exited with code {:?}]", code));
                            let p = peer.lock().unwrap();
                            let _ = p.send(&msg);
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}
