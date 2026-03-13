const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const logger = require('./utils/logger');
const logStore = require('./utils/logStore');
const whatsapp = require('./whatsapp');

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function saveRoutesConfig(routes) {
    const configPath = path.resolve(process.env.ROUTES_CONFIG_PATH || './config/routes.json');
    fs.writeFileSync(configPath, JSON.stringify({ routes }, null, 2));
}

function generateId() {
    return `route_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Fetches all channel/group dialogs from the Telegram client.
 * Returns array of { id, name, type, username }
 */
async function fetchChannels(telegramClient) {
    if (!telegramClient) return [];
    try {
        const dialogs = await telegramClient.getDialogs({ limit: 200 });
        return dialogs
            .filter((d) => d.isChannel || d.isGroup)
            .map((d) => {
                const entity = d.entity;
                // Build Bot-API style ID
                const rawId = entity.id?.value ?? entity.id;
                const id = d.isChannel ? `-100${rawId}` : `-${rawId}`;
                return {
                    id: String(id),
                    name: d.title || entity.title || entity.firstName || 'Unknown',
                    type: d.isChannel ? 'channel' : 'group',
                    username: entity.username || null,
                };
            });
    } catch (err) {
        logger.error(`[Server] Failed to fetch channels: ${err.message}`);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Express App Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates and configures the Express app.
 * @param {object} state - Shared mutable state: { sourceMap, routes, startedAt, telegramClient }
 */
function createServer(state) {
    const app = express();
    app.use(express.json());

    // Basic API Authentication (if ADMIN_PASSWORD is set)
    app.use((req, res, next) => {
        if (!process.env.ADMIN_PASSWORD) return next();

        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

        if (login === 'admin' && password === process.env.ADMIN_PASSWORD) {
            return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="401"');
        res.status(401).send('Authentication required.');
    });

    // Serve admin UI static files
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // ─── Probes ────────────────────────────────────────────────────────────────

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
    });

    app.get('/status', (req, res) => {
        const routeSummary = (state.routes || []).map((r) => ({
            id: r.id,
            name: r.name || '',
            enabled: r.enabled !== false,
            source: r.source,
            destinations: r.destinations,
            waDestinations: r.waDestinations || [],
            processing: {
                enabled: r.processing?.enabled || false,
                url: r.processing?.url || '',
                skipOnError: r.processing?.skipOnError !== false,
                timeoutMs: r.processing?.timeoutMs || 5000,
            },
            filters: r.filters || {},
            schedule: r.schedule || { enabled: false, startTime: '00:00', endTime: '23:59', timezone: 'Local' },
        }));

        res.json({
            status: 'running',
            uptime: process.uptime(),
            startedAt: state.startedAt,
            needsAuth: !!state.needsAuth,
            authType: state.needsAuth || null,
            totalRoutes: routeSummary.length,
            enabledRoutes: routeSummary.filter((r) => r.enabled).length,
            routes: routeSummary,
        });
    });

    // ─── Auth API ──────────────────────────────────────────────────────────────

    app.post('/api/auth/:type', (req, res) => {
        const { type } = req.params; // 'phone', 'code', 'password'
        const { value } = req.body;

        if (state.authResolvers && state.authResolvers[type]) {
            state.authResolvers[type](value);
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: `No active auth request of type ${type}` });
        }
    });

    // ─── Channels API ──────────────────────────────────────────────────────────

    /**
     * GET /api/channels
     * Returns all Telegram channels/groups the user is a member of.
     */
    app.get('/api/channels', async (req, res) => {
        try {
            const channels = await fetchChannels(state.telegramClient);
            res.json({ success: true, channels });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /api/whatsapp/contacts
     * Proxies request to WAHA API to fetch all WhatsApp chats and channels
     */
    app.get('/api/whatsapp/contacts', async (req, res) => {
        try {
            const [chatsRes, channelsRes] = await Promise.all([
                whatsapp.getChats(),
                whatsapp.getChannels()
            ]);

            res.json({
                success: true,
                chats: chatsRes.success ? chatsRes.data : [],
                channels: channelsRes.success ? channelsRes.data : [],
                errors: {
                    chats: chatsRes.success ? null : 'Failed to fetch chats',
                    channels: channelsRes.success ? null : 'Failed to fetch channels'
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ─── Routes API ────────────────────────────────────────────────────────────

    /**
     * GET /api/routes
     * Returns all routes.
     */
    app.get('/api/routes', (req, res) => {
        res.json({ success: true, routes: state.routes || [] });
    });

    /**
     * POST /api/routes
     * Creates a new route and persists to routes.json.
     */
    app.post('/api/routes', (req, res) => {
        try {
            const body = req.body;
            if (!body.source || !Array.isArray(body.destinations) || body.destinations.length === 0) {
                return res.status(400).json({ success: false, error: 'source and destinations are required' });
            }

            const newRoute = {
                id: body.id || generateId(),
                name: body.name || '',
                enabled: body.enabled !== false,
                source: String(body.source),
                destinations: body.destinations.map(String),
                waDestinations: Array.isArray(body.waDestinations) ? body.waDestinations.map(String) : [],
                processing: {
                    enabled: body.processing?.enabled || false,
                    url: body.processing?.url || '',
                    timeoutMs: body.processing?.timeoutMs || 5000,
                    skipOnError: body.processing?.skipOnError !== false,
                },
                filters: {
                    allowText: body.filters?.allowText !== false,
                    allowMedia: body.filters?.allowMedia !== false,
                    allowedMediaTypes: body.filters?.allowedMediaTypes || ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation'],
                },
                schedule: {
                    enabled: body.schedule?.enabled || false,
                    startTime: body.schedule?.startTime || '00:00',
                    endTime: body.schedule?.endTime || '23:59',
                    timezone: body.schedule?.timezone || 'Local',
                },
            };

            const updatedRoutes = [...(state.routes || []), newRoute];
            saveRoutesConfig(updatedRoutes);

            // Reload into live state
            const configPath = process.env.ROUTES_CONFIG_PATH || './config/routes.json';
            const { routes, sourceMap } = loadConfig(configPath);
            state.routes = routes;
            state.sourceMap = sourceMap;

            logger.info(`[Server] Route "${newRoute.id}" created`);
            res.status(201).json({ success: true, route: newRoute });
        } catch (err) {
            logger.error(`[Server] Create route failed: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * PUT /api/routes/:id
     * Updates an existing route by ID and persists.
     */
    app.put('/api/routes/:id', (req, res) => {
        try {
            const { id } = req.params;
            const routes = state.routes || [];
            const idx = routes.findIndex((r) => r.id === id);

            if (idx === -1) {
                return res.status(404).json({ success: false, error: `Route "${id}" not found` });
            }

            const body = req.body;
            const updated = {
                ...routes[idx],
                name: body.name ?? routes[idx].name,
                enabled: body.enabled !== undefined ? body.enabled : routes[idx].enabled,
                source: body.source ? String(body.source) : routes[idx].source,
                destinations: body.destinations ? body.destinations.map(String) : routes[idx].destinations,
                waDestinations: body.waDestinations ? body.waDestinations.map(String) : (routes[idx].waDestinations || []),
                processing: {
                    ...routes[idx].processing,
                    ...body.processing,
                },
                filters: {
                    ...routes[idx].filters,
                    ...body.filters,
                },
                schedule: {
                    ...routes[idx].schedule,
                    ...body.schedule,
                },
            };

            const updatedRoutes = [...routes];
            updatedRoutes[idx] = updated;
            saveRoutesConfig(updatedRoutes);

            const configPath = process.env.ROUTES_CONFIG_PATH || './config/routes.json';
            const { routes: r2, sourceMap } = loadConfig(configPath);
            state.routes = r2;
            state.sourceMap = sourceMap;

            logger.info(`[Server] Route "${id}" updated`);
            res.json({ success: true, route: updated });
        } catch (err) {
            logger.error(`[Server] Update route failed: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /api/routes/:id
     * Deletes a route by ID and persists.
     */
    app.delete('/api/routes/:id', (req, res) => {
        try {
            const { id } = req.params;
            const routes = state.routes || [];
            const idx = routes.findIndex((r) => r.id === id);

            if (idx === -1) {
                return res.status(404).json({ success: false, error: `Route "${id}" not found` });
            }

            const updatedRoutes = routes.filter((r) => r.id !== id);
            saveRoutesConfig(updatedRoutes);

            const configPath = process.env.ROUTES_CONFIG_PATH || './config/routes.json';
            const { routes: r2, sourceMap } = loadConfig(configPath);
            state.routes = r2;
            state.sourceMap = sourceMap;

            logger.info(`[Server] Route "${id}" deleted`);
            res.json({ success: true });
        } catch (err) {
            logger.error(`[Server] Delete route failed: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /routes/reload  (legacy — keep for backward compat)
     * Hot-reloads routes.json without restart.
     */
    app.post('/routes/reload', (req, res) => {
        try {
            const configPath = process.env.ROUTES_CONFIG_PATH || './config/routes.json';
            const { routes, sourceMap } = loadConfig(configPath);
            state.routes = routes;
            state.sourceMap = sourceMap;
            logger.info(`[Server] Routes reloaded: ${routes.length} routes`);
            res.json({ success: true, message: `Reloaded ${routes.length} routes` });
        } catch (err) {
            logger.error(`[Server] Routes reload failed: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ─── Logs API ──────────────────────────────────────────────────────────────

    /**
     * GET /api/logs?limit=200&level=info
     * Returns buffered log entries.
     */
    app.get('/api/logs', (req, res) => {
        const limit = parseInt(req.query.limit || '200', 10);
        const level = req.query.level || null;
        res.json({ success: true, logs: logStore.getEntries(limit, level) });
    });

    /**
     * DELETE /api/logs
     * Clears the log buffer.
     */
    app.delete('/api/logs', (req, res) => {
        logStore.clear();
        res.json({ success: true });
    });

    /**
     * GET /api/logs/stream
     * Server-Sent Events stream — pushes new log lines to connected clients.
     */
    app.get('/api/logs/stream', (req, res) => {
        logStore.registerSseClient(res);
    });

    return app;
}

/**
 * Starts the Express HTTP server on the configured port.
 */
function startServer(state) {
    const app = createServer(state);
    const port = parseInt(process.env.PORT || '3000', 10);

    const server = app.listen(port, () => {
        logger.info(`[Server] ✅ Express server listening on http://localhost:${port}`);
        logger.info(`[Server]    → Admin UI:            http://localhost:${port}`);
        logger.info(`[Server]    → GET  /health`);
        logger.info(`[Server]    → GET  /status`);
        logger.info(`[Server]    → GET  /api/channels`);
        logger.info(`[Server]    → GET/POST /api/routes`);
        logger.info(`[Server]    → PUT/DELETE /api/routes/:id`);
        logger.info(`[Server]    → GET  /api/logs`);
        logger.info(`[Server]    → GET  /api/logs/stream  (SSE)`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`[Server] Port ${port} is already in use. Set a different PORT in .env`);
        } else {
            logger.error(`[Server] HTTP server error: ${err.message}`);
        }
        process.exit(1);
    });

    return app;
}

module.exports = { startServer };
