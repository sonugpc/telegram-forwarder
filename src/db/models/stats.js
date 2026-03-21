"use strict";
/**
 * Stats Model — tracks forwarding events per route.
 *
 * Storage schema (data/stats.db.json):
 * {
 *   totals: { messages, telegram, whatsapp, wordpress, failed },
 *   byRoute: {
 *     [routeId]: { name, messages, telegram, whatsapp, wordpress, failed, lastForwarded }
 *   }
 * }
 *
 * "messages" = distinct messages processed (one per route dispatch).
 * "telegram / whatsapp / wordpress" = total successful sends to each platform.
 * "failed" = total failed send attempts across all platforms.
 *
 * Designed to be model-compatible: swap JsonStore for a SQL adapter here
 * and the rest of the codebase stays unchanged.
 */
const JsonStore = require("../JsonStore");
const path = require("path");

const store = new JsonStore(path.resolve("./data/stats.db.json"));

function _emptyTotals() {
  return { messages: 0, telegram: 0, whatsapp: 0, wordpress: 0, failed: 0 };
}

function _emptyRoute(name) {
  return {
    name,
    messages: 0,
    telegram: 0,
    whatsapp: 0,
    wordpress: 0,
    failed: 0,
    lastForwarded: null,
  };
}

/**
 * Records one forwarding event for a route.
 * @param {string} routeId
 * @param {string} routeName
 * @param {{ telegram?: number, whatsapp?: number, wordpress?: number, failed?: number }} counts
 */
function recordForward(
  routeId,
  routeName,
  { telegram = 0, whatsapp = 0, wordpress = 0, failed = 0 } = {},
) {
  const data = store.read();
  if (!data.totals) data.totals = _emptyTotals();
  if (!data.byRoute) data.byRoute = {};
  if (!data.byRoute[routeId]) data.byRoute[routeId] = _emptyRoute(routeName);

  const r = data.byRoute[routeId];
  r.name = routeName; // keep name fresh
  r.messages += 1;
  r.telegram += telegram;
  r.whatsapp += whatsapp;
  r.wordpress += wordpress;
  r.failed += failed;
  r.lastForwarded = new Date().toISOString();

  data.totals.messages += 1;
  data.totals.telegram += telegram;
  data.totals.whatsapp += whatsapp;
  data.totals.wordpress += wordpress;
  data.totals.failed += failed;

  store.write(data);
}

/**
 * Returns all stats.
 * @returns {{ totals: object, byRoute: object }}
 */
function getStats() {
  const data = store.read();
  return {
    totals: data.totals || _emptyTotals(),
    byRoute: data.byRoute || {},
  };
}

/** Resets all stats. */
function reset() {
  store.write({});
}

module.exports = { recordForward, getStats, reset };
