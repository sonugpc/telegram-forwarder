# Telegram Forwarder — API Reference

Base URL: `http://localhost:{PORT}` (default port `3003`)

All endpoints except `/health` require HTTP Basic Authentication when `ADMIN_PASSWORD` is set in `.env`:

```
Authorization: Basic base64("admin:{ADMIN_PASSWORD}")
```

All JSON responses share a common envelope shape. Success and error types are defined once here and referenced throughout:

```ts
// Every successful response includes these fields plus the endpoint-specific payload
type SuccessEnvelope = {
  success: true;
  // ...endpoint-specific fields
};

// Every error response
type ErrorEnvelope = {
  success: false;
  error: string; // human-readable error message
};
```

---

## Table of Contents

1. [Probes](#1-probes)
2. [Telegram Auth](#2-telegram-auth)
3. [Channels](#3-channels)
4. [WhatsApp](#4-whatsapp)
5. [Routes](#5-routes)
6. [Stats](#6-stats)
7. [Logs](#7-logs)
8. [Legacy](#8-legacy)
9. [Type Definitions](#9-type-definitions)
10. [Environment Variables](#10-environment-variables)

---

## 1. Probes

### `GET /health`

Health check. **No authentication required.**

**Response type**

```ts
type HealthResponse = {
  status: "ok";
  uptime: number; // seconds since process start
};
```

**Example**

```json
{ "status": "ok", "uptime": 482.3 }
```

---

### `GET /status`

Full system status including all live routes.

**Response type**

```ts
type StatusResponse = {
  success: true;
  status: "running";
  uptime: number; // seconds
  startedAt: string; // ISO 8601 datetime
  needsAuth: boolean; // true when Telegram login is in progress
  authType: "phone" | "code" | "password" | null;
  totalRoutes: number;
  enabledRoutes: number;
  routes: RouteObject[]; // see §9 Type Definitions
};
```

**Example**

```json
{
  "success": true,
  "status": "running",
  "uptime": 482.3,
  "startedAt": "2026-03-21T10:00:00.000Z",
  "needsAuth": false,
  "authType": null,
  "totalRoutes": 2,
  "enabledRoutes": 2,
  "routes": []
}
```

---

## 2. Telegram Auth

Used by the Admin UI to complete Telegram's interactive login flow. Only needed on first run or when the session expires.

### `POST /api/auth/:type`

Submit a value for the current Telegram auth step.

**URL parameter**

| `:type`    | Accepted value                                   |
| ---------- | ------------------------------------------------ |
| `phone`    | International phone number, e.g. `+919876543210` |
| `code`     | OTP sent to the Telegram app                     |
| `password` | Two-Factor Authentication password               |

**Request type**

```ts
type AuthRequest = {
  value: string; // required — the phone number, OTP code, or 2FA password
};
```

**Response type**

```ts
type AuthResponse = {
  success: true;
};
```

**Error responses**

| HTTP | Condition                           | `error` value                             |
| ---- | ----------------------------------- | ----------------------------------------- |
| 400  | No active auth request of this type | `"No active auth request of type {type}"` |

**Example request**

```json
{ "value": "+919876543210" }
```

**Example response**

```json
{ "success": true }
```

---

## 3. Channels

### `GET /api/channels`

Returns all Telegram channels and groups the authenticated user is a member of (up to 200).

**Response type**

```ts
type ChannelItem = {
  id: string; // Bot-API format: "-100XXXXXXXXXX" for channels, "-XXXXXXXXXX" for groups
  name: string; // Display name
  type: "channel" | "group";
  username: string | null; // Public @username, or null if private
};

type ChannelsResponse = {
  success: true;
  channels: ChannelItem[];
};
```

**Example**

```json
{
  "success": true,
  "channels": [
    {
      "id": "-1001234567890",
      "name": "Deals Hub",
      "type": "channel",
      "username": "dealshub"
    },
    {
      "id": "-1009876543210",
      "name": "My Private Group",
      "type": "group",
      "username": null
    }
  ]
}
```

---

## 4. WhatsApp

### `GET /api/whatsapp/contacts`

Proxies to the configured WAHA instance to return all chats and newsletter channels.

**Response type**

```ts
type WAHAChat = {
  id: string; // WhatsApp chat ID, e.g. "919876543210@c.us"
  name: string | null; // Contact or group name
};

type WAHAChannel = {
  id: string; // WhatsApp channel ID
  name: string;
};

type WhatsAppContactsResponse = {
  success: true;
  chats: { data: WAHAChat[] };
  channels: { data: WAHAChannel[] };
  errors: {
    chats: string | null; // null = OK, string = error message
    channels: string | null;
  };
};
```

**Example**

```json
{
  "success": true,
  "chats": {
    "data": [{ "id": "919876543210@c.us", "name": "Deal Group" }]
  },
  "channels": {
    "data": [{ "id": "newsletter@g.us", "name": "Deals Newsletter" }]
  },
  "errors": { "chats": null, "channels": null }
}
```

> Requires `WAHA_BASE_URL` and `WAHA_API_KEY` in `.env`. If credentials are missing, arrays will be empty and `errors` will contain a message string.

---

## 5. Routes

A route defines the full forwarding pipeline: one source Telegram channel → any combination of Telegram destinations, WhatsApp chats, and WordPress endpoints.

### `GET /api/routes`

Returns all configured routes.

**Response type**

```ts
type RoutesListResponse = {
  success: true;
  routes: RouteObject[]; // see §9 Type Definitions
};
```

**Example**

```json
{ "success": true, "routes": [] }
```

---

### `POST /api/routes`

Creates a new route and immediately persists it to `config/routes.json`. No restart needed.

**Request type**

```ts
type CreateRouteRequest = {
  // ── Required ──────────────────────────────────────────────────────────────
  source: string; // Telegram channel ID, e.g. "-1001370241291"
  destinations: string[]; // One or more Telegram destination IDs (non-empty)

  // ── Optional ──────────────────────────────────────────────────────────────
  name?: string; // Human-readable label. Default: ""
  enabled?: boolean; // Default: true
  waDestinations?: string[]; // WhatsApp chat/group IDs, e.g. ["919876543210@c.us"]
  wpDestinations?: WpDestination[]; // WordPress post targets (see §9)

  processing?: {
    enabled?: boolean; // Default: false
    url?: string; // Full POST URL of the affiliate processing microservice
    timeoutMs?: number; // Request timeout in ms. Default: 5000
    skipOnError?: boolean; // If true, forward original on API failure. Default: true
  };

  filters?: {
    allowText?: boolean; // Forward text messages. Default: true
    allowMedia?: boolean; // Forward media messages. Default: true
    allowedMediaTypes?: MediaType[]; // Default: all types. See §9 for MediaType values
  };

  schedule?: {
    enabled?: boolean; // Default: false (always active)
    startTime?: string; // "HH:MM" 24-hour, e.g. "09:00"
    endTime?: string; // "HH:MM" 24-hour, e.g. "21:00"
    timezone?: string; // IANA tz name or "Local". Default: "Local"
  };
};
```

**Response type** — `201 Created`

```ts
type CreateRouteResponse = {
  success: true;
  route: RouteObject; // The fully-constructed route including server-generated id
};
```

**Error responses**

| HTTP | Condition                             | `error` value                            |
| ---- | ------------------------------------- | ---------------------------------------- |
| 400  | `source` missing                      | `"source and destinations are required"` |
| 400  | `destinations` missing or empty array | `"source and destinations are required"` |
| 500  | Unexpected server error               | `"<error message>"`                      |

**Example request**

```json
{
  "name": "Deals → All Channels",
  "enabled": true,
  "source": "-1001370241291",
  "destinations": ["-1001783017529"],
  "waDestinations": ["919876543210@c.us"],
  "wpDestinations": [
    {
      "endpoint": "https://myblog.com/wp-json/deals/v1/import",
      "siteurl": "https://myblog.com"
    }
  ],
  "processing": {
    "enabled": true,
    "url": "https://affiliate-api.example.com/convert",
    "timeoutMs": 5000,
    "skipOnError": true
  },
  "filters": {
    "allowText": true,
    "allowMedia": true,
    "allowedMediaTypes": ["photo", "video", "document"]
  },
  "schedule": {
    "enabled": true,
    "startTime": "09:00",
    "endTime": "21:00",
    "timezone": "Asia/Kolkata"
  }
}
```

**Example response**

```json
{
  "success": true,
  "route": {
    "id": "route_1773413179670_8jjv0",
    "name": "Deals → All Channels",
    "enabled": true,
    "source": "-1001370241291",
    "destinations": ["-1001783017529"],
    "waDestinations": ["919876543210@c.us"],
    "wpDestinations": [
      {
        "endpoint": "https://myblog.com/wp-json/deals/v1/import",
        "siteurl": "https://myblog.com"
      }
    ],
    "processing": {
      "enabled": true,
      "url": "https://affiliate-api.example.com/convert",
      "timeoutMs": 5000,
      "skipOnError": true
    },
    "filters": {
      "allowText": true,
      "allowMedia": true,
      "allowedMediaTypes": ["photo", "video", "document"]
    },
    "schedule": {
      "enabled": true,
      "startTime": "09:00",
      "endTime": "21:00",
      "timezone": "Asia/Kolkata"
    }
  }
}
```

---

### `PUT /api/routes/:id`

Partially updates an existing route. Only fields present in the body are changed; all others keep their current values.

**URL parameter:** `id` — route ID string, e.g. `route_1773413179670_8jjv0`

**Request type**

```ts
// All fields are optional — send only what you want to change
type UpdateRouteRequest = Partial<CreateRouteRequest>;
```

**Response type**

```ts
type UpdateRouteResponse = {
  success: true;
  route: RouteObject; // Full updated route
};
```

**Error responses**

| HTTP | Condition               | `error` value                |
| ---- | ----------------------- | ---------------------------- |
| 404  | Route ID not found      | `"Route \"<id>\" not found"` |
| 500  | Unexpected server error | `"<error message>"`          |

**Example request** — disable a route

```json
{ "enabled": false }
```

---

### `DELETE /api/routes/:id`

Permanently deletes a route and persists the change.

**URL parameter:** `id` — route ID string

**Response type**

```ts
type DeleteRouteResponse = {
  success: true;
};
```

**Error responses**

| HTTP | Condition               | `error` value                |
| ---- | ----------------------- | ---------------------------- |
| 404  | Route ID not found      | `"Route \"<id>\" not found"` |
| 500  | Unexpected server error | `"<error message>"`          |

---

## 6. Stats

Forwarding statistics are persisted in `data/stats.db.json` (gitignored). The storage layer is model-based and can be swapped for SQL without changing this API contract.

### `GET /api/stats`

Returns global totals and per-route breakdowns.

**Response type**

```ts
type StatCounters = {
  messages: number; // Distinct messages processed (one per route dispatch)
  telegram: number; // Successful sends to Telegram destinations
  whatsapp: number; // Successful sends to WhatsApp destinations
  wordpress: number; // Successful POSTs to WordPress endpoints
  failed: number; // Failed send/post attempts across all platforms
};

type RouteStatEntry = StatCounters & {
  name: string; // Route display name at time of last forward
  lastForwarded: string | null; // ISO 8601 datetime of most recent forward, or null
};

type StatsResponse = {
  success: true;
  totals: StatCounters;
  byRoute: Record<string, RouteStatEntry>; // key = route ID
};
```

**Example**

```json
{
  "success": true,
  "totals": {
    "messages": 42,
    "telegram": 38,
    "whatsapp": 20,
    "wordpress": 15,
    "failed": 2
  },
  "byRoute": {
    "route_1773413179670_8jjv0": {
      "name": "Deals → Main",
      "messages": 42,
      "telegram": 38,
      "whatsapp": 20,
      "wordpress": 15,
      "failed": 2,
      "lastForwarded": "2026-03-21T14:30:00.000Z"
    }
  }
}
```

---

### `DELETE /api/stats`

Resets all forwarding statistics to zero.

**Response type**

```ts
type ResetStatsResponse = {
  success: true;
};
```

---

## 7. Logs

Log entries are kept in a ring-buffer in memory (most recent 1000 entries) and streamed live via SSE.

### `GET /api/logs`

Returns recent buffered log entries.

**Query parameters**

| Param   | Type   | Default | Description                                                      |
| ------- | ------ | ------- | ---------------------------------------------------------------- |
| `limit` | number | `200`   | Maximum number of entries to return (1 – 1000)                   |
| `level` | string | _(all)_ | Filter to a single level: `debug` \| `info` \| `warn` \| `error` |

**Response type**

```ts
type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  level: LogLevel;
  message: string; // Formatted log string including module prefix
  timestamp: string; // ISO 8601 datetime
};

type LogsResponse = {
  success: true;
  logs: LogEntry[];
};
```

**Example**

```json
{
  "success": true,
  "logs": [
    {
      "level": "info",
      "message": "[Handler] 📨 Incoming message 123 from @dealshub — matched 2 route(s)",
      "timestamp": "2026-03-21T14:22:10.501Z"
    },
    {
      "level": "error",
      "message": "[WordPress] ❌ Failed to post to https://myblog.com/wp-json/deals/v1/import: HTTP 401",
      "timestamp": "2026-03-21T14:22:11.003Z"
    }
  ]
}
```

---

### `DELETE /api/logs`

Clears the in-memory log buffer.

**Response type**

```ts
type ClearLogsResponse = {
  success: true;
};
```

---

### `GET /api/logs/stream`

Server-Sent Events stream. Pushes a new event for each log line as it is written. Useful for the live log viewer in the Admin UI.

**Response**

- Content-Type: `text/event-stream`
- Each event `data` field is a JSON-serialised `LogEntry` (same type as above)

**Event format**

```
data: {"level":"info","message":"[Handler] ...","timestamp":"2026-03-21T14:22:10.501Z"}
```

**Browser usage**

```js
const source = new EventSource("/api/logs/stream");
source.onmessage = (e) => {
  const entry = JSON.parse(e.data); // LogEntry
  console.log(`[${entry.level}] ${entry.message}`);
};
```

---

## 8. Legacy

### `POST /routes/reload`

Hot-reloads `config/routes.json` from disk without restarting the process. Kept for backward compatibility — prefer the `PUT /api/routes/:id` CRUD endpoints for programmatic use.

**Request body:** none

**Response type**

```ts
type ReloadResponse = {
  success: true;
  message: string; // e.g. "Reloaded 3 routes"
};
```

**Example**

```json
{ "success": true, "message": "Reloaded 3 routes" }
```

---

## 9. Type Definitions

All reusable types referenced throughout this document.

### `RouteObject`

The canonical shape of a route, as stored and returned by all route endpoints.

```ts
type MediaType =
  | "photo"
  | "video"
  | "document"
  | "audio"
  | "voice"
  | "sticker"
  | "animation";

type WpDestination = {
  endpoint: string; // Full POST URL, e.g. "https://myblog.com/wp-json/deals/v1/import"
  siteurl: string; // Sent as-is in the WordPress payload body, e.g. "https://myblog.com"
};

type ProcessingConfig = {
  enabled: boolean; // Whether to call the microservice before forwarding
  url: string; // POST endpoint of the affiliate/processing microservice
  timeoutMs: number; // Request timeout in ms
  skipOnError: boolean; // true = forward original if API fails; false = drop message
};

type FiltersConfig = {
  allowText: boolean; // Forward plain-text messages
  allowMedia: boolean; // Forward media messages
  allowedMediaTypes: MediaType[]; // Permitted media types (all types allowed when empty)
};

type ScheduleConfig = {
  enabled: boolean; // false = always active
  startTime: string; // "HH:MM" in 24-hour format
  endTime: string; // "HH:MM" in 24-hour format
  timezone: string; // IANA timezone name, e.g. "Asia/Kolkata", or "Local"
};

type RouteObject = {
  id: string; // Auto-generated: "route_{timestamp}_{random5}"
  name: string; // Human-readable label
  enabled: boolean; // Whether this route is actively processing messages
  source: string; // Telegram channel ID to listen on
  destinations: string[]; // Telegram channel/group IDs to forward to
  waDestinations: string[]; // WhatsApp chat IDs, e.g. "919876543210@c.us"
  wpDestinations: WpDestination[]; // WordPress post targets
  processing: ProcessingConfig;
  filters: FiltersConfig;
  schedule: ScheduleConfig;
};
```

---

### WordPress Post Payload

When a message is forwarded to a WordPress destination the server sends:

```ts
// POST to wpDestination.endpoint
type WordPressPostPayload = {
  message: string; // Original raw message text BEFORE affiliate link conversion
  siteurl: string; // Copied from wpDestination.siteurl
};
```

**Headers sent by the server**

```
Content-Type: application/json
Authorization: Bearer {PROCESSING_AUTH_TOKEN}
```

The same `PROCESSING_AUTH_TOKEN` is used for both the affiliate processing microservice and all WordPress posts.

---

### Processing Microservice Contract

When `processing.enabled` is `true`, the server POSTs a Telegram Bot API–shaped update to `processing.url` before forwarding.

**Request sent to microservice**

```ts
// POST to processing.url
type ProcessingRequest = {
  update_id: number;
  channel_post: {
    message_id: number;
    date: number; // Unix timestamp
    chat: {
      id: number | null; // Telegram channel ID in Bot API format (-100XXXXXXXXXX)
      type: "channel";
    };
    text?: string; // Present for text messages
    entities?: TelegramMessageEntity[]; // Bold, links, mentions, etc.
    // photo / document / video fields may also be present depending on media type
  };
};
```

**Expected response from microservice**

```ts
// Option A — forward the converted text
type ProcessingSuccess = {
  message: string; // The transformed message text to forward
};

// Option B — silently drop this message, do not forward at all
type ProcessingSkip = {
  skip: true;
};

type ProcessingResponse = ProcessingSuccess | ProcessingSkip;
```

If the microservice returns an HTTP error or times out, behaviour is controlled by `processing.skipOnError`:

| `skipOnError`    | Behaviour on failure                    |
| ---------------- | --------------------------------------- |
| `true` (default) | Forward the original unmodified message |
| `false`          | Drop the message entirely               |

---

### `LogEntry`

```ts
type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  level: LogLevel;
  message: string; // Formatted string including module tag, e.g. "[Handler] ..."
  timestamp: string; // ISO 8601, e.g. "2026-03-21T14:22:10.501Z"
};
```

---

### `StatCounters` / `RouteStatEntry`

```ts
type StatCounters = {
  messages: number; // Messages processed (one increment per route per incoming message)
  telegram: number; // Successful individual sends to Telegram destinations
  whatsapp: number; // Successful individual sends to WhatsApp destinations
  wordpress: number; // Successful individual POSTs to WordPress endpoints
  failed: number; // Failed attempts across all platforms combined
};

type RouteStatEntry = StatCounters & {
  name: string; // Route name captured at time of forward
  lastForwarded: string | null; // ISO 8601 or null if never forwarded
};
```

---

## 10. Environment Variables

| Variable                | Type   | Required | Default                | Description                                                                                        |
| ----------------------- | ------ | -------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `TELEGRAM_API_ID`       | number | **Yes**  | —                      | Telegram app API ID (from [my.telegram.org](https://my.telegram.org/apps))                         |
| `TELEGRAM_API_HASH`     | string | **Yes**  | —                      | Telegram app API hash                                                                              |
| `TELEGRAM_SESSION_FILE` | string | No       | `./session.json`       | Path where the MTProto session is persisted                                                        |
| `PORT`                  | number | No       | `3000`                 | HTTP server port                                                                                   |
| `ADMIN_PASSWORD`        | string | No       | _(auth disabled)_      | Enables HTTP Basic Auth on all protected endpoints. Username is always `admin`                     |
| `PROCESSING_AUTH_TOKEN` | string | No       | —                      | Bearer token sent to the affiliate processing microservice **and** to all WordPress post endpoints |
| `WAHA_BASE_URL`         | string | No       | —                      | Base URL of your WAHA instance, e.g. `https://waha.example.com`                                    |
| `WAHA_API_KEY`          | string | No       | —                      | JWT key for WAHA API authentication                                                                |
| `GLOBAL_TAGLINE`        | string | No       | —                      | Text appended to every forwarded message (after a blank line)                                      |
| `ROUTES_CONFIG_PATH`    | string | No       | `./config/routes.json` | Override path to the routes configuration file                                                     |
| `LOG_LEVEL`             | string | No       | `info`                 | Winston log level: `debug` \| `info` \| `warn` \| `error`                                          |
