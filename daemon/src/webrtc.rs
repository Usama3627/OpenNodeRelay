use datachannel::{
    DataChannelHandler, DataChannelInfo, IceCandidate, PeerConnectionHandler,
    RtcConfig, RtcDataChannel, RtcPeerConnection, SessionDescription, SdpType,
    ConnectionState, GatheringState,
};
use datachannel::sdp;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::signaling::SignalCommand;

// ---------------------------------------------------------------------------
// Events emitted by WebRTC layer to the main loop
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum RtcEvent {
    DataChannelOpen,
    DataChannelClosed,
    Message(String),
    ConnectionStateChange(String),
}

// ---------------------------------------------------------------------------
// DataChannel handler — bridges callbacks to async channel
// ---------------------------------------------------------------------------

struct DcHandler {
    event_tx: mpsc::Sender<RtcEvent>,
}

impl DataChannelHandler for DcHandler {
    fn on_open(&mut self) {
        info!("datachannel opened");
        let _ = self.event_tx.try_send(RtcEvent::DataChannelOpen);
    }

    fn on_closed(&mut self) {
        warn!("datachannel closed");
        let _ = self.event_tx.try_send(RtcEvent::DataChannelClosed);
    }

    fn on_error(&mut self, err: &str) {
        error!("datachannel error: {}", err);
    }

    fn on_message(&mut self, msg: &[u8]) {
        if let Ok(text) = std::str::from_utf8(msg) {
            info!("datachannel received: {}", &text[..text.len().min(100)]);
            let _ = self.event_tx.try_send(RtcEvent::Message(text.to_string()));
        } else {
            warn!("datachannel received non-utf8 data ({} bytes)", msg.len());
        }
    }

    fn on_buffered_amount_low(&mut self) {}
    fn on_available(&mut self) {}
}

// ---------------------------------------------------------------------------
// PeerConnection handler — handles SDP/ICE callbacks
// ---------------------------------------------------------------------------

/// Shared slot for the remote DataChannel received via on_data_channel.
/// The PcHandler writes it, and the Peer reads it to get a send handle.
type SharedDc = Arc<StdMutex<Option<Box<RtcDataChannel<DcHandler>>>>>;

struct PcHandler {
    event_tx: mpsc::Sender<RtcEvent>,
    signal_tx: mpsc::Sender<SignalCommand>,
    remote_dc: SharedDc,
}

impl PeerConnectionHandler for PcHandler {
    type DCH = DcHandler;

    fn data_channel_handler(&mut self, _info: DataChannelInfo) -> Self::DCH {
        DcHandler {
            event_tx: self.event_tx.clone(),
        }
    }

    fn on_description(&mut self, sess_desc: SessionDescription) {
        if sess_desc.sdp_type == SdpType::Answer {
            let sdp = sess_desc.sdp.to_string();
            debug!("generated SDP answer, sending via signaling");
            let _ = self.signal_tx.try_send(SignalCommand::Answer { sdp });
        }
    }

    fn on_candidate(&mut self, cand: IceCandidate) {
        debug!("local ICE candidate generated");
        let _ = self.signal_tx.try_send(SignalCommand::IceCandidate {
            candidate: cand.candidate.clone(),
            mid: cand.mid.clone(),
        });
    }

    fn on_connection_state_change(&mut self, state: ConnectionState) {
        let state_str = format!("{:?}", state);
        info!("connection state: {}", state_str);
        let _ = self.event_tx.try_send(RtcEvent::ConnectionStateChange(state_str));
    }

    fn on_gathering_state_change(&mut self, state: GatheringState) {
        debug!("ICE gathering state: {:?}", state);
    }

    fn on_data_channel(&mut self, dc: Box<RtcDataChannel<Self::DCH>>) {
        info!("remote data channel received — storing as send channel");
        let mut slot = self.remote_dc.lock().unwrap();
        *slot = Some(dc);
    }
}

// ---------------------------------------------------------------------------
// Peer — high-level wrapper around the WebRTC peer connection
// ---------------------------------------------------------------------------

pub struct Peer {
    pc: Box<RtcPeerConnection<PcHandler>>,
    /// The DataChannel received from the app (via on_data_channel).
    remote_dc: SharedDc,
}

impl Peer {
    pub fn new(
        event_tx: mpsc::Sender<RtcEvent>,
        signal_tx: mpsc::Sender<SignalCommand>,
    ) -> anyhow::Result<Self> {
        let ice_servers = vec![
            "stun:stun.cloudflare.com:3478",
            "stun:stun.l.google.com:19302",
        ];
        let config = RtcConfig::new(&ice_servers);

        let remote_dc: SharedDc = Arc::new(StdMutex::new(None));

        let handler = PcHandler {
            event_tx,
            signal_tx,
            remote_dc: remote_dc.clone(),
        };

        let pc = RtcPeerConnection::new(&config, handler)?;

        Ok(Peer { pc, remote_dc })
    }

    pub fn handle_offer(&mut self, sdp: &str) -> anyhow::Result<()> {
        let sdp_session = sdp::parse_sdp(sdp, false)
            .map_err(|e| anyhow::anyhow!("failed to parse SDP: {:?}", e))?;
        let desc = SessionDescription {
            sdp_type: SdpType::Offer,
            sdp: sdp_session,
        };
        self.pc.set_remote_description(&desc)?;
        Ok(())
    }

    pub fn add_ice_candidate(&mut self, candidate: &str, mid: &str) -> anyhow::Result<()> {
        let cand = IceCandidate {
            candidate: candidate.to_string(),
            mid: mid.to_string(),
        };
        self.pc.add_remote_candidate(&cand)?;
        Ok(())
    }

    /// Send a message through the remote DataChannel (the one the app created).
    pub fn send(&self, msg: &str) -> anyhow::Result<()> {
        let mut slot = self.remote_dc.lock().unwrap();
        if let Some(ref mut dc) = *slot {
            info!("sending {} bytes over datachannel", msg.len());
            dc.send(msg.as_bytes())?;
            info!("send succeeded");
            Ok(())
        } else {
            error!("send failed: remote_dc is None");
            anyhow::bail!("data channel not open yet");
        }
    }
}

unsafe impl Send for Peer {}
