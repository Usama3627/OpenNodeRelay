import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from 'react-native-webrtc';

const DEFAULT_SIGNALING = 'https://opennoderelay-signal.opennoderelay.workers.dev';

const ICE_SERVERS = [
  {urls: 'stun:stun.cloudflare.com:3478'},
  {urls: 'stun:stun.l.google.com:19302'},
];

const CONNECT_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Connect to a daemon using a 6-char pairing code.
 *
 * @param {string} pairingCode     - The 6-char uppercase pairing code.
 * @param {string} signalingUrl    - Override signaling base URL.
 * @param {function} onStatusChange - Called with a human-readable status string during pairing.
 * @returns {Promise<{pc: RTCPeerConnection, dc: RTCDataChannel}>}
 */
export async function connectToDaemon(
  pairingCode,
  signalingUrl = DEFAULT_SIGNALING,
  onStatusChange = () => {},
) {
  const BASE = `${signalingUrl}/room/${pairingCode.toUpperCase()}`;
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;

  const checkTimeout = () => {
    if (Date.now() > deadline) {
      throw new Error('Connection timed out. Is the daemon running?');
    }
  };

  // Step 1: Join the signaling room
  onStatusChange('Joining room...');
  const joinResp = await fetch(`${BASE}/join`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({role: 'app'}),
  });
  if (!joinResp.ok) {
    throw new Error(`Failed to join room: ${joinResp.status}`);
  }

  // Step 2: Create PeerConnection
  onStatusChange('Creating connection...');
  const pc = new RTCPeerConnection({iceServers: ICE_SERVERS});

  // Step 3: Create DataChannel
  const dc = pc.createDataChannel('control');

  // Collect ICE candidates and post them to the signaling server
  const iceCandidateQueue = [];
  pc.onicecandidate = async event => {
    if (event.candidate) {
      try {
        await fetch(`${BASE}/ice/app`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            candidate: event.candidate.candidate,
            mid: event.candidate.sdpMid,
          }),
        });
      } catch (err) {
        // ICE candidate posting failure is non-fatal; log and continue
        console.warn('[WebRTC] Failed to post ICE candidate:', err.message);
      }
    }
  };

  // Step 4: Create and post SDP offer
  onStatusChange('Sending offer...');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const offerResp = await fetch(`${BASE}/offer`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sdp: offer.sdp}),
  });
  if (!offerResp.ok) {
    pc.close();
    throw new Error(`Failed to post offer: ${offerResp.status}`);
  }

  // Step 5: Poll for daemon's SDP answer
  onStatusChange('Waiting for daemon...');
  let answer = null;
  while (!answer) {
    checkTimeout();
    try {
      const resp = await fetch(`${BASE}/answer`);
      const data = await resp.json();
      if (data.sdp) {
        answer = data;
      }
    } catch (_) {
      // transient network error — keep polling
    }
    if (!answer) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  onStatusChange('Handshake in progress...');
  await pc.setRemoteDescription(
    new RTCSessionDescription({type: 'answer', sdp: answer.sdp}),
  );

  // Step 6: Poll for daemon's ICE candidates
  let iceSince = 0;
  const iceInterval = setInterval(async () => {
    try {
      const resp = await fetch(`${BASE}/ice/daemon?since=${iceSince}`);
      const data = await resp.json();
      if (data.candidates && data.candidates.length > 0) {
        for (const c of data.candidates) {
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate({candidate: c.candidate, sdpMid: c.mid}),
            );
          } catch (err) {
            console.warn('[WebRTC] Failed to add ICE candidate:', err.message);
          }
        }
      }
      if (typeof data.total === 'number') {
        iceSince = data.total;
      }
    } catch (_) {
      // transient — keep polling
    }
  }, POLL_INTERVAL_MS);

  // Step 7: Wait for DataChannel to open
  onStatusChange('Establishing P2P connection...');
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(iceInterval);
      pc.close();
      reject(
        new Error(
          'Connection timed out. Check the pairing code and try again.',
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    dc.onopen = () => {
      clearInterval(iceInterval);
      clearTimeout(timeoutId);
      resolve({pc, dc});
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        clearInterval(iceInterval);
        clearTimeout(timeoutId);
        reject(
          new Error(
            'WebRTC connection failed. Your network may be blocking direct connections.',
          ),
        );
      }
    };
  });
}
