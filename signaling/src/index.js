// OpenNodeRelay Signaling Server — Cloudflare Worker + KV
//
// HTTP polling-based signaling for WebRTC.
// Both peers exchange SDP offers/answers and ICE candidates via KV-backed HTTP endpoints.
// No WebSockets needed — daemon and app poll every 500ms during the ~3-5 second handshake.
//
// KV Namespace binding: SIGNAL_KV
//
// Room keys (all expire after 5 minutes):
//   room:{code}:offer     — SDP offer from app
//   room:{code}:answer    — SDP answer from daemon
//   room:{code}:ice:app   — JSON array of ICE candidates from app
//   room:{code}:ice:daemon — JSON array of ICE candidates from daemon
//   room:{code}:status    — room metadata (created_at, peers)

const TTL = 300; // 5 minutes in seconds
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === "/health") {
      return json({ status: "ok" });
    }

    // POST /room/:code/join — Register as a peer (daemon or app)
    let match = path.match(/^\/room\/([A-Z0-9]{4,8})\/join$/);
    if (match && request.method === "POST") {
      const code = match[1];
      const body = await request.json();
      const role = body.role; // "daemon" or "app"

      const statusKey = `room:${code}:status`;
      const existing = await env.SIGNAL_KV.get(statusKey, "json");

      if (!existing) {
        // First peer creates the room
        await env.SIGNAL_KV.put(statusKey, JSON.stringify({
          created_at: Date.now(),
          [role]: true,
        }), { expirationTtl: TTL });
        return json({ ok: true, peers: 1, you: role });
      }

      if (existing[role]) {
        return json({ error: "role already taken" }, 409);
      }

      existing[role] = true;
      await env.SIGNAL_KV.put(statusKey, JSON.stringify(existing), {
        expirationTtl: TTL,
      });
      return json({ ok: true, peers: 2, you: role });
    }

    // POST /room/:code/offer — App sends SDP offer
    match = path.match(/^\/room\/([A-Z0-9]{4,8})\/offer$/);
    if (match && request.method === "POST") {
      const code = match[1];
      const body = await request.json();
      await env.SIGNAL_KV.put(`room:${code}:offer`, JSON.stringify(body), {
        expirationTtl: TTL,
      });
      return json({ ok: true });
    }

    // GET /room/:code/offer — Daemon polls for SDP offer
    if (match && request.method === "GET") {
      const code = match[1];
      const data = await env.SIGNAL_KV.get(`room:${code}:offer`, "json");
      if (!data) return json({ waiting: true });
      return json(data);
    }

    // POST /room/:code/answer — Daemon sends SDP answer
    match = path.match(/^\/room\/([A-Z0-9]{4,8})\/answer$/);
    if (match && request.method === "POST") {
      const code = match[1];
      const body = await request.json();
      await env.SIGNAL_KV.put(`room:${code}:answer`, JSON.stringify(body), {
        expirationTtl: TTL,
      });
      return json({ ok: true });
    }

    // GET /room/:code/answer — App polls for SDP answer
    if (match && request.method === "GET") {
      const code = match[1];
      const data = await env.SIGNAL_KV.get(`room:${code}:answer`, "json");
      if (!data) return json({ waiting: true });
      return json(data);
    }

    // POST /room/:code/ice/:role — Add ICE candidate
    match = path.match(/^\/room\/([A-Z0-9]{4,8})\/ice\/(daemon|app)$/);
    if (match && request.method === "POST") {
      const code = match[1];
      const role = match[2];
      const body = await request.json();
      const key = `room:${code}:ice:${role}`;

      const existing = await env.SIGNAL_KV.get(key, "json") || [];
      existing.push(body);
      await env.SIGNAL_KV.put(key, JSON.stringify(existing), {
        expirationTtl: TTL,
      });
      return json({ ok: true, count: existing.length });
    }

    // GET /room/:code/ice/:role?since=N — Poll ICE candidates from the other peer
    if (match && request.method === "GET") {
      const code = match[1];
      const role = match[2];
      const since = parseInt(url.searchParams.get("since") || "0");
      const key = `room:${code}:ice:${role}`;

      const all = await env.SIGNAL_KV.get(key, "json") || [];
      const newCandidates = all.slice(since);
      return json({ candidates: newCandidates, total: all.length });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
