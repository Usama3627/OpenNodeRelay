use anyhow::Context;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

/// Messages we receive from signaling to pass to WebRTC
#[derive(Debug)]
pub enum SignalEvent {
    /// SDP offer from the app
    Offer { sdp: String },
    /// ICE candidate from the app
    IceCandidate { candidate: String, mid: String },
}

/// Messages we want to send through signaling
#[derive(Debug)]
pub enum SignalCommand {
    /// Send our SDP answer
    Answer { sdp: String },
    /// Send an ICE candidate
    IceCandidate { candidate: String, mid: String },
    /// Done — stop polling
    Done,
}

/// HTTP-polling signaling client.
/// Daemon joins the room, polls for the app's offer and ICE candidates,
/// and posts its own answer and ICE candidates.
pub async fn run_signaling(
    signaling_url: &str,
    room_code: &str,
    event_tx: mpsc::Sender<SignalEvent>,
    mut cmd_rx: mpsc::Receiver<SignalCommand>,
) -> anyhow::Result<()> {
    let base = format!("{}/room/{}", signaling_url.trim_end_matches('/'), room_code);
    let client = reqwest::Client::new();

    // Step 1: Join the room as daemon
    info!("joining signaling room: {}", room_code);
    let resp = client
        .post(format!("{}/join", base))
        .json(&json!({"role": "daemon"}))
        .send()
        .await
        .context("failed to join room")?;

    let join_result: Value = resp.json().await?;
    if let Some(err) = join_result.get("error") {
        anyhow::bail!("join failed: {}", err);
    }
    info!("joined room, peers: {}", join_result["peers"]);

    // Step 2: Poll for offer + ICE candidates from app, while also sending our own
    let mut got_offer = false;
    let mut ice_since: usize = 0;

    let poll_interval = std::time::Duration::from_millis(500);

    loop {
        tokio::select! {
            // Outgoing commands (answer, ICE candidates)
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SignalCommand::Answer { sdp }) => {
                        debug!("posting SDP answer");
                        let resp = client
                            .post(format!("{}/answer", base))
                            .json(&json!({"sdp": sdp}))
                            .send()
                            .await;
                        if let Err(e) = resp {
                            error!("failed to post answer: {}", e);
                        }
                    }
                    Some(SignalCommand::IceCandidate { candidate, mid }) => {
                        debug!("posting ICE candidate");
                        let resp = client
                            .post(format!("{}/ice/daemon", base))
                            .json(&json!({"candidate": candidate, "mid": mid}))
                            .send()
                            .await;
                        if let Err(e) = resp {
                            error!("failed to post ICE candidate: {}", e);
                        }
                    }
                    Some(SignalCommand::Done) | None => {
                        info!("signaling done");
                        return Ok(());
                    }
                }
            }

            // Poll for offer and ICE candidates from app
            _ = tokio::time::sleep(poll_interval) => {
                // Poll for offer
                if !got_offer {
                    match client.get(format!("{}/offer", base)).send().await {
                        Ok(resp) => {
                            if let Ok(data) = resp.json::<Value>().await {
                                if let Some(sdp) = data["sdp"].as_str() {
                                    info!("received SDP offer from app");
                                    got_offer = true;
                                    let _ = event_tx.send(SignalEvent::Offer {
                                        sdp: sdp.to_string(),
                                    }).await;
                                }
                            }
                        }
                        Err(e) => debug!("poll offer error: {}", e),
                    }
                }

                // Poll for ICE candidates from app
                match client
                    .get(format!("{}/ice/app?since={}", base, ice_since))
                    .send()
                    .await
                {
                    Ok(resp) => {
                        if let Ok(data) = resp.json::<Value>().await {
                            if let Some(candidates) = data["candidates"].as_array() {
                                for c in candidates {
                                    let candidate = c["candidate"].as_str().unwrap_or("").to_string();
                                    let mid = c["mid"].as_str().unwrap_or("0").to_string();
                                    debug!("received ICE candidate from app");
                                    let _ = event_tx.send(SignalEvent::IceCandidate {
                                        candidate,
                                        mid,
                                    }).await;
                                }
                            }
                            if let Some(total) = data["total"].as_u64() {
                                ice_since = total as usize;
                            }
                        }
                    }
                    Err(e) => debug!("poll ice error: {}", e),
                }
            }
        }
    }
}
