const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

/**
 * Validates a single route object for required fields.
 */
function validateRoute(route, index) {
    const errors = [];
    if (!route.id) errors.push(`routes[${index}] missing "id"`);
    if (!route.source) errors.push(`routes[${index}] missing "source"`);
    if (!Array.isArray(route.destinations) || route.destinations.length === 0)
        errors.push(`routes[${index}] must have at least one "destinations" entry`);
    if (route.processing?.enabled && !route.processing?.url)
        errors.push(`routes[${index}] has processing.enabled=true but no processing.url`);
    return errors;
}

/**
 * Loads and parses the routes config file.
 * Returns { routes, sourceMap } where sourceMap maps source channel id -> [routes]
 */
function loadConfig(configPath) {
    const absPath = path.resolve(configPath);

    if (!fs.existsSync(absPath)) {
        throw new Error(`Routes config not found at: ${absPath}`);
    }

    const raw = fs.readFileSync(absPath, 'utf-8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Invalid JSON in routes config: ${err.message}`);
    }

    if (!Array.isArray(parsed.routes)) {
        throw new Error(`Routes config must have a top-level "routes" array`);
    }

    // Validate all routes
    const allErrors = [];
    parsed.routes.forEach((route, i) => {
        const errs = validateRoute(route, i);
        allErrors.push(...errs);
    });

    if (allErrors.length > 0) {
        throw new Error(`Routes config validation failed:\n  - ${allErrors.join('\n  - ')}`);
    }

    // Build source -> routes lookup map
    const sourceMap = new Map();
    parsed.routes.forEach((route) => {
        const enabled = route.enabled !== false; // default true if not set
        if (!enabled) {
            logger.info(`[Config] Route "${route.id}" (${route.name || 'unnamed'}) is DISABLED — skipping`);
            return;
        }

        const key = String(route.source);
        if (!sourceMap.has(key)) {
            sourceMap.set(key, []);
        }
        sourceMap.get(key).push(route);
    });

    const enabledCount = parsed.routes.filter((r) => r.enabled !== false).length;
    const totalSources = sourceMap.size;

    logger.info(
        `[Config] Loaded ${parsed.routes.length} routes (${enabledCount} enabled) across ${totalSources} unique source channel(s)`
    );

    return { routes: parsed.routes, sourceMap };
}

/**
 * Returns all enabled routes for a given source channel ID.
 * Returns empty array if no routes configured for that source.
 */
function getRoutesForSource(sourceMap, channelId) {
    return sourceMap.get(String(channelId)) || [];
}

module.exports = { loadConfig, getRoutesForSource };
