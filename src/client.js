const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

let clientInstance = null;

/**
 * Loads existing session string from file, returns empty string if not found.
 */
function loadSession(sessionFile) {
    const absPath = path.resolve(sessionFile);
    if (fs.existsSync(absPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
            if (data.session) {
                logger.info(`[Client] Loaded existing session from ${absPath}`);
                return data.session;
            }
        } catch {
            logger.warn('[Client] Could not parse session file, starting fresh session');
        }
    }
    return '';
}

/**
 * Persists the session string to file after successful auth.
 */
function saveSession(sessionFile, sessionString) {
    const absPath = path.resolve(sessionFile);
    fs.writeFileSync(absPath, JSON.stringify({ session: sessionString }, null, 2));
    logger.info(`[Client] Session saved to ${absPath}`);
}

/**
 * Initializes and authenticates the MTProto Telegram client.
 * On first run, assigns promises to `state.authResolvers` so the web UI can provide auth info.
 * Subsequent runs reuse the saved session string.
 */
async function createClient(state = { authResolvers: {} }) {
    if (clientInstance) return clientInstance;

    const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const sessionFile = process.env.TELEGRAM_SESSION_FILE || './session.json';

    if (!apiId || !apiHash) {
        throw new Error(
            'TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in your .env file.\n' +
            'Get them from: https://my.telegram.org/apps'
        );
    }

    const sessionString = loadSession(sessionFile);
    const stringSession = new StringSession(sessionString);

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        retryDelay: 1000,
        autoReconnect: true,
        baseLogger: {
            warn: (msg) => logger.warn(`[Telegram] ${msg}`),
            error: (msg) => logger.error(`[Telegram] ${msg}`),
            info: () => { },   // suppress verbose gramjs info logs
            debug: () => { },  // suppress verbose gramjs debug logs
            canSend: () => true, // fix crash: client._log.canSend is not a function
        },
    });

    await client.start({
        phoneNumber: async () => {
            state.needsAuth = 'phone';
            state.authStepId = Date.now();
            logger.info('[Client] 🔐 First-time auth: Waiting for phone number via UI...');
            return new Promise(resolve => { state.authResolvers['phone'] = resolve; });
        },
        password: async () => {
            state.needsAuth = 'password';
            state.authStepId = Date.now();
            logger.info('[Client] 🔐 Two-step verification enabled: Waiting for password via UI...');
            return new Promise(resolve => { state.authResolvers['password'] = resolve; });
        },
        phoneCode: async () => {
            state.needsAuth = 'code';
            state.authStepId = Date.now();
            logger.info('[Client] 🔐 OTP sent to your Telegram app / SMS: Waiting for code via UI...');
            return new Promise(resolve => { state.authResolvers['code'] = resolve; });
        },
        onError: (err) => {
            logger.error(`[Client] Auth error: ${err.message}`);
        },
    });

    // Save session for next run
    const newSessionString = client.session.save();
    saveSession(sessionFile, newSessionString);

    const me = await client.getMe();
    logger.info(`[Client] ✅ Logged in as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);

    clientInstance = client;
    return client;
}

/**
 * Returns the existing client instance (must call createClient() first).
 */
function getClient() {
    if (!clientInstance) throw new Error('Telegram client not initialized. Call createClient() first.');
    return clientInstance;
}

module.exports = { createClient, getClient };
