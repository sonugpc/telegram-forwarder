# Telegram Forwarder

A feature-rich Telegram message forwarder built with Node.js and MTProto (user account). Listens to source channels, optionally processes messages through an affiliate link conversion microservice, and forwards them (text + media) to multiple destination channels — with per-route configuration.

---

## ✨ Features

- **MTProto / User Account** — listens to any channel you're a member of (no bot admin required)
- **Many-to-many routing** — one source → multiple destinations, multiple sources in one config
- **Affiliate link processing** — POST messages to your microservice and forward the converted result
- **Per-route toggles** — enable/disable routes, processing, media types individually
- **Media forwarding** — photos, videos, documents, audio, voice, stickers, animations
- **Hot-reload** — update routes without restarting via `POST /routes/reload`
- **Express HTTP server** — health check and status endpoints

---

## 📁 Project Structure

```
telegramforwarder/
├── config/
│   └── routes.json          # Channel mappings & route config
├── src/
│   ├── index.js             # Entry point
│   ├── client.js            # MTProto client (GramJS)
│   ├── config.js            # Config loader & validator
│   ├── handler.js           # Incoming message dispatcher
│   ├── forwarder.js         # Forwarding engine (text + media)
│   ├── processor.js         # Affiliate processing microservice client
│   ├── server.js            # Express HTTP server
│   └── utils/
│       └── logger.js        # Winston logger
├── logs/                    # Auto-created log files
├── .env                     # Your credentials (see .env.example)
├── .env.example
└── package.json
```

---

## 🚀 Setup

### 1. Get Telegram API Credentials

1. Go to [https://my.telegram.org/apps](https://my.telegram.org/apps)
2. Create an app → copy `api_id` and `api_hash`

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
TELEGRAM_SESSION_FILE=./session.json
PORT=3000
LOG_LEVEL=info
ROUTES_CONFIG_PATH=./config/routes.json
PROCESSING_AUTH_TOKEN=your_jwt_token
WAHA_BASE_URL=http://localhost:3000
WAHA_API_KEY=your_waha_key_here
GLOBAL_TAGLINE=Join our premium channel for more deals!
```

### 3. Configure Routes

Edit `config/routes.json`:

```json
{
  "routes": [
    {
      "id": "route_1",
      "name": "Deals Channel → My Channels",
      "enabled": true,
      "source": "-100XXXXXXXXXX",
      "destinations": ["-100YYYYYYYYYY"],
      "waDestinations": ["1234567890@c.us", "newsletter@g.us"],
      "processing": {
        "enabled": true,
        "url": "https://your-api.example.com/process",
        "timeoutMs": 5000,
        "skipOnError": true
      },
      "filters": {
        "allowText": true,
        "allowMedia": true,
        "allowedMediaTypes": ["photo", "video", "document", "audio", "voice", "sticker", "animation"]
      }
    }
  ]
}
```

> **How to get a channel ID?** Forward any message from the channel to [@userinfobot](https://t.me/userinfobot) or use Bot API. Channel IDs have the format `-100XXXXXXXXXX`.

### 4. Install & Run

```bash
npm install
npm start         # production
npm run dev       # development (auto-reload with nodemon)
```

**First run:** You'll be prompted for your phone number and OTP. The session is saved to `session.json` and reused on subsequent runs.

---

## 🔧 Route Config Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | string | required | Unique route identifier |
| `name` | string | `""` | Human-readable name |
| `enabled` | boolean | `true` | Master on/off switch for the route |
| `source` | string | required | Source channel ID (`-100XXXXXXXXXX`) |
| `destinations` | string[] | `[]` | Array of target Telegram channel IDs |
| `waDestinations` | string[] | `[]` | Array of target WhatsApp IDs (via WAHA) |
| `processing.enabled` | boolean | `false` | Enable affiliate API |
| `processing.url` | string | `""` | Processing microservice POST URL |
| `processing.timeoutMs` | number | `5000` | HTTP timeout in milliseconds |
| `processing.skipOnError` | boolean | `true` | If `true`, forward original on API error; if `false`, drop message |
| `filters.allowText` | boolean | `true` | Forward text messages |
| `filters.allowMedia` | boolean | `true` | Forward media messages |
| `filters.allowedMediaTypes` | string[] | all | Which media types to forward |

*(Note: Provide your processing microservice JWT token in the `.env` file as `PROCESSING_AUTH_TOKEN`. It will be sent as the `authX` header).*

---

## 🔌 Processing Microservice API Contract

**Request** — `POST {processing.url}`

```json
{
  "update_id": 12345,
  "channel_post": {
    "message_id": 100,
    "date": 1700000000,
    "chat": { "id": -100123456789, "type": "channel" },
    "text": "Check this out: https://example.com/product",
    "entities": [{ "type": "url", "offset": 16, "length": 30 }],
    "photo": [...],
    "_media_type": "photo",
    "_proxy_url": "https://media.bigtricks.in/file/<file_id>"
  }
}
```

**Response** — expected by the forwarder:

```json
{
  "success": true,
  "message": "Check this out: https://affiliate.link/product",
  "skip": false
}
```

| Response field | Description |
|---|---|
| `success` | `true` = OK, `false` = triggers `skipOnError` policy |
| `message` | The converted text to forward (markdown supported) |
| `skip` | If `true`, message is silently dropped — nothing forwarded |

---

## 🌐 HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe — returns `{ status: "ok", uptime: N }` |
| `GET` | `/status` | All routes, enabled/disabled state, uptime |
| `POST` | `/routes/reload` | Hot-reload `routes.json` without restart |

---

## 📊 Logs

Logs are written to:
- **Console** — colorized, all levels
- `logs/combined.log` — all levels
- `logs/error.log` — errors only

Control verbosity with `LOG_LEVEL=debug` in `.env`.

---

## 🚢 Production Deployment

Using PM2:
```bash
npm install -g pm2
pm2 start src/index.js --name telegram-forwarder
pm2 save
pm2 startup
```

Using Docker (example):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "src/index.js"]
```
