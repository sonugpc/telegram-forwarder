const { createLogger, format, transports } = require('winston');
const path = require('path');
const logStore = require('./logStore');

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`;
});

/**
 * Custom Winston transport that pushes every log entry into the in-memory logStore.
 */
class LogStoreTransport extends transports.Stream {
  constructor(opts = {}) {
    // We need a writable stream — use a pass-through
    const { Writable } = require('stream');
    const sink = new Writable({ write(chunk, enc, cb) { cb(); } });
    super({ stream: sink, ...opts });
  }

  log(info, callback) {
    logStore.push(info.level, info[Symbol.for('message')] || info.message || '');
    if (callback) callback();
  }
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    // Console output with colors
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    // Persistent log file (errors only)
    new transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
    }),
    // Full log file
    new transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
    }),
    // In-memory store for UI
    new LogStoreTransport(),
  ],
});

module.exports = logger;
