/**
 * In-memory log store with SSE (Server-Sent Events) broadcasting.
 * Keeps last MAX_ENTRIES log entries. New entries are pushed to all connected SSE clients.
 */

const MAX_ENTRIES = 500;

/** @type {Array<{id: number, timestamp: string, level: string, message: string}>} */
const entries = [];
let nextId = 1;

/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set();

/**
 * Appends a log entry to the store and broadcasts to all SSE clients.
 */
function push(level, message) {
    const entry = {
        id: nextId++,
        timestamp: new Date().toISOString(),
        level,
        message,
    };

    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();

    // Broadcast to all connected SSE clients
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(data);
        } catch {
            sseClients.delete(res);
        }
    }
}

/**
 * Returns recent log entries, optionally filtered by level.
 * @param {number} limit  Max entries to return (default 200)
 * @param {string|null} level  Filter by level (null = all)
 */
function getEntries(limit = 200, level = null) {
    let result = level ? entries.filter((e) => e.level === level) : entries;
    return result.slice(-limit);
}

/**
 * Registers an Express response object as an SSE client.
 * Sends all buffered entries immediately on connect.
 */
function registerSseClient(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send existing entries on connect
    for (const entry of entries) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    sseClients.add(res);

    res.on('close', () => {
        sseClients.delete(res);
    });
}

/**
 * Clears the log buffer.
 */
function clear() {
    entries.length = 0;
}

module.exports = { push, getEntries, registerSseClient, clear };
