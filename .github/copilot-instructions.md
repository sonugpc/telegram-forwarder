# Copilot / AI Agent Instructions

These rules apply to **every** change made to this repository — whether by a human, Copilot, or any AI agent. Read and follow them before writing any code.

---

## Mandatory update checklist

For **every** change that touches any of the items below, the corresponding docs must be updated **in the same commit/PR**:

| If you change…                                                | You must also update…                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Add, remove, or modify an Express route in `src/server.js`    | `API.md` + `README.md`                                           |
| Add, remove, or modify a route request body field or response | `API.md`                                                         |
| Add a new source module (new forwarder, new platform)         | `API.md` + `README.md`                                           |
| Change an environment variable (name, default, purpose)       | `API.md` → _Environment Variables Reference_ table + `README.md` |
| Change the data schema of `RouteObject` or `StatsObject`      | `API.md` → _Data Models_ section                                 |
| Add or remove a dashboard tab or admin UI feature             | `README.md`                                                      |
| Change the stats DB model (`src/db/models/stats.js`)          | `API.md` → Stats section                                         |
| Change authentication mechanism                               | `API.md` → intro auth block                                      |

> **Never ship a code change without updating the relevant docs. An undocumented API endpoint is a broken API endpoint.**

---

## API.md conventions

- Every endpoint must have: HTTP method + path, auth requirement, request body (if any), full response example, and error responses.
- Use the exact same field names as the code — copy from the actual Express handler, not from memory.
- Mark optional vs required fields in tables.
- Keep sections in this order: Probes → Auth → Channels → WhatsApp → Routes → Stats → Logs → Legacy → Data Models → Env Vars.
- Do not add a new top-level section without also adding it to the Table of Contents.

---

## README.md conventions

- The **Features** list must reflect currently implemented capabilities — remove features that are removed, add new ones.
- The **Project Structure** tree must mirror the actual file system. Update it when files are added or removed.
- The **Setup / Configuration** section must list every `.env` variable that a user needs to configure.
- Do not describe future plans or hypothetical features.

---

## Code conventions

- `src/server.js` is the single source of truth for all HTTP endpoints. Do not add routes elsewhere.
- New platform forwarders go in `src/<platform>.js` (e.g. `src/wordpress.js`, `src/whatsapp.js`).
- The `forwardMessage` function in `src/forwarder.js` must always return `{ telegramSent, whatsappSent, wordpressSent, failed }`. Add a counter for any new platform.
- Stats are recorded in `src/handler.js` by calling `stats.recordForward()`. Do not record stats inside individual forwarder files.
- The DB layer lives in `src/db/`. `JsonStore.js` is the storage adapter; models live in `src/db/models/`. A model must only import `JsonStore` — never write to files directly.
- `data/` is gitignored. Never commit `data/stats.db.json` or any generated data file.
- All secrets and credentials must come from `.env` — never hardcode them.
- Authentication for WordPress posts and the processing microservice both use `PROCESSING_AUTH_TOKEN`. Do not introduce a separate env var for WP auth.

---

## Adding a new forwarding platform (checklist)

1. Create `src/<platform>.js` with a `send*` function.
2. Import it in `src/forwarder.js` and add a forwarding loop that reads `route.<platform>Destinations`.
3. Return the send count in the `forwardMessage` return object.
4. Add `<platform>SendCount` tracking to `src/db/models/stats.js` and `JsonStore` schema.
5. Accept `<platform>Destinations` in `POST /api/routes` and `PUT /api/routes/:id` in `src/server.js`.
6. Add the platform column to the routes table and the modal section in `public/index.html`.
7. Add the platform counter card to the Dashboard tab in `public/index.html`.
8. **Update `API.md`** — RouteObject model, Stats section, and env vars if applicable.
9. **Update `README.md`** — Features list and Project Structure.

---

## Security reminders

- All non-`/health` endpoints are guarded by `requireAuth`. Do not add unprotected endpoints that expose data or trigger actions.
- Validate all user-supplied IDs and URLs before using them — use `String()` coercion and `.filter(Boolean)` as already done in route CRUD.
- Never log or return `PROCESSING_AUTH_TOKEN`, `ADMIN_PASSWORD`, `WAHA_API_KEY`, or `TELEGRAM_API_HASH` in API responses or log lines.
