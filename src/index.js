'use strict';

require('dotenv').config();

const { NewMessage } = require('telegram/events');
const logger = require('./utils/logger');
const { createClient } = require('./client');
const { loadConfig } = require('./config');
const { handleMessageWithMap } = require('./handler');
const { startServer } = require('./server');

// ─────────────────────────────────────────────────────────────────────────────
//  Shared mutable state — passed to Express server for hot-reload support.
//  The handler always reads from state.sourceMap so a /routes/reload call
//  updates routing without needing to re-register the event listener.
// ─────────────────────────────────────────────────────────────────────────────
const state = {
    routes: [],
    sourceMap: new Map(),
    startedAt: new Date().toISOString(),
    authResolvers: {}, // stores promises for Telegram login (phone, code, password)
    needsAuth: null,   // tracks current auth step (e.g., 'phone', 'code')
};

async function main() {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('  🚀 Telegram Forwarder — Starting up');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Load routes configuration
    const configPath = process.env.ROUTES_CONFIG_PATH || './config/routes.json';
    try {
        const { routes, sourceMap } = loadConfig(configPath);
        state.routes = routes;
        state.sourceMap = sourceMap;
    } catch (err) {
        logger.error(`[Main] Failed to load routes config: ${err.message}`);
        process.exit(1);
    }

    // 2. Start Express HTTP server first so it can serve the UI
    // The UI is used to provide the phone number and OTP for Telegram Auth
    startServer(state);

    // 3. Initialize and authenticate MTProto client
    let client;
    try {
        client = await createClient(state);
        state.needsAuth = null;
    } catch (err) {
        logger.error(`[Main] Failed to initialize Telegram client: ${err.message}`);
        process.exit(1);
    }

    // 4. Register message event handler.
    //    The handler closure references state.sourceMap directly so that
    //    POST /routes/reload can update routing live without re-registering.
    state.telegramClient = client; // expose to /api/channels

    client.addEventHandler(
        (event) => handleMessageWithMap(client, state.sourceMap, event),
        new NewMessage({})
    );
    logger.info('[Main] ✅ Message handler registered — listening for new messages');

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('  ✅ Telegram Forwarder is running');
    logger.info(`  📡 Monitoring ${state.sourceMap.size} source channel(s)`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
    logger.info('[Main] Received SIGINT — shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('[Main] Received SIGTERM — shutting down gracefully...');
    process.exit(0);
});

process.on('unhandledRejection', (reason) => {
    logger.error(`[Main] Unhandled Promise Rejection: ${reason}`);
});

main().catch((err) => {
    logger.error(`[Main] Fatal error: ${err.message}`);
    process.exit(1);
});
