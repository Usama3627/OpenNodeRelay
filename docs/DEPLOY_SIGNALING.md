# Deploying the OpenNodeRelay Signaling Server

The signaling server is a Cloudflare Worker + KV store. It exchanges WebRTC handshake messages (SDP offers/answers and ICE candidates) between the daemon and mobile app via HTTP polling. It is only used for ~3-5 seconds during connection setup, then both peers communicate directly via P2P.

**Already deployed at**: `https://opennoderelay-signal.opennoderelay.workers.dev`

## How to deploy your own (if needed)

### Prerequisites

1. Cloudflare account (free tier): https://dash.cloudflare.com/sign-up
2. Node.js installed

### Steps

```bash
# 1. Install wrangler CLI
npm install -g wrangler

# 2. Log in
wrangler login

# 3. Create a KV namespace
cd signaling
npx wrangler kv namespace create SIGNAL_KV
# Output: { binding = "SIGNAL_KV", id = "abc123..." }

# 4. Put the id in wrangler.toml
# Edit wrangler.toml → set id = "abc123..." (your actual ID)

# 5. Deploy
npm install
npx wrangler deploy
# Output: https://opennoderelay-signal.<your-subdomain>.workers.dev
```

### Verify

```bash
curl https://opennoderelay-signal.<your-subdomain>.workers.dev/health
# → {"status":"ok"}

# Simulate a pairing:
BASE="https://opennoderelay-signal.<your-subdomain>.workers.dev/room/TEST01"
curl -X POST "$BASE/join" -H "Content-Type: application/json" -d '{"role":"daemon"}'
curl -X POST "$BASE/join" -H "Content-Type: application/json" -d '{"role":"app"}'
curl -X POST "$BASE/offer" -H "Content-Type: application/json" -d '{"sdp":"test-offer"}'
curl "$BASE/offer"
# → {"sdp":"test-offer"}
```

## Free Tier Limits

| Resource | Free Tier | Enough? |
|----------|-----------|---------|
| Worker requests/day | 100,000 | Each pairing = ~20 requests. Supports ~5,000 pairings/day |
| KV reads/day | 100,000 | Same math |
| KV writes/day | 1,000 | Each pairing = ~6 writes. Supports ~160 pairings/day |
| KV storage | 1 GB | All keys expire in 5 min. Never accumulates. |

The write limit (1,000/day) is the bottleneck — supports ~160 pairings per day. For a personal tool this is more than enough. If you need more, the $5/mo paid plan gives unlimited.

## How the signaling endpoints work

All state is in Cloudflare KV with 5-minute TTL. No persistent data.

```
POST /room/{CODE}/join           → Register as "daemon" or "app"
POST /room/{CODE}/offer          → App stores its SDP offer
GET  /room/{CODE}/offer          → Daemon polls for the offer
POST /room/{CODE}/answer         → Daemon stores its SDP answer
GET  /room/{CODE}/answer         → App polls for the answer
POST /room/{CODE}/ice/{role}     → Store ICE candidates
GET  /room/{CODE}/ice/{role}?since=N → Poll for new ICE candidates
```

Both sides poll every 500ms. The entire exchange takes ~3-5 seconds.
