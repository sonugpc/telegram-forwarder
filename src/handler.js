const { NewMessage } = require("teleproto/events");
const logger = require("./utils/logger");
const { getRoutesForSource } = require("./config");
const { processMessage, getMediaType } = require("./processor");
const { forwardMessage } = require("./forwarder");
const stats = require("./db/models/stats");

/**
 * Resolves the source channel ID from a GramJS message event.
 * Returns the channel ID as a string in the "-100XXXXX" Bot API format.
 */
function resolveChannelId(message) {
  // For channel posts, peerId is a PeerChannel
  const peerId = message.peerId;
  if (!peerId) return null;

  // GramJS stores raw channel IDs without the -100 prefix
  const rawId = peerId.channelId || peerId.chatId || peerId.userId;
  if (!rawId) return null;

  // Normalize to Bot API format (-100XXXXXXX)
  return `-100${String(rawId)}`;
}

/**
 * Checks if a route is currently active based on its schedule.
 */
function isRouteActive(schedule) {
  if (!schedule || !schedule.enabled) return true;

  let timeString;
  try {
    const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    if (schedule.timezone && schedule.timezone !== "Local") {
      options.timeZone = schedule.timezone;
    }
    timeString = new Intl.DateTimeFormat("en-CA", options).format(new Date());
  } catch (err) {
    logger.warn(
      `[Handler] Invalid timezone "${schedule.timezone}", using Local time`,
    );
    timeString = new Intl.DateTimeFormat("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
  }

  const currentStr = timeString;
  const startStr = schedule.startTime || "00:00";
  const endStr = schedule.endTime || "23:59";

  if (startStr <= endStr) {
    return currentStr >= startStr && currentStr <= endStr;
  } else {
    // Overnight schedule
    return currentStr >= startStr || currentStr <= endStr;
  }
}

/**
 * Processes a single incoming Telegram message through the route pipeline.
 * Exported as handleMessageWithMap for hot-reload support in index.js.
 */
async function handleMessageWithMap(client, sourceMap, event) {
  const message = event.message;
  if (!message) return;

  const channelId = resolveChannelId(message);
  if (!channelId) {
    logger.debug(
      `[Handler] Could not resolve channel ID for message ${message.id}`,
    );
    return;
  }

  let routes = getRoutesForSource(sourceMap, channelId);
  if (routes.length === 0) {
    logger.info(
      `[Handler] No enabled routes for channel ${channelId} — ignoring`,
    );
    return;
  }

  // Apply schedule logic
  routes = routes.filter((r) => {
    if (!isRouteActive(r.schedule)) {
      logger.info(
        `[Handler] Route "${r.id}" is outside active schedule window — skipping`,
      );
      return false;
    }
    return true;
  });

  if (routes.length === 0) return;

  let fromName = channelId;
  try {
    const chat = await client.getEntity(message.peerId);
    fromName = chat.username
      ? `@${chat.username}`
      : chat.title || chat.firstName || channelId;
  } catch (err) {
    // Ignore entity fetch error
  }

  logger.info(
    `[Handler] 📨 Incoming message ${message.id} from ${fromName} — matched ${routes.length} route(s)`,
  );

  const mediaType = getMediaType(message.media);

  // Process each matching route independently
  for (const route of routes) {
    try {
      logger.info(
        `[Handler] Processing route "${route.id}" (${route.name || "unnamed"})`,
      );

      let processedText = null; // null = use original text

      if (route.processing?.enabled && route.processing?.url) {
        const result = await processMessage(route, message);

        // API requested to skip this message entirely
        if (result.skip) {
          logger.info(
            `[Handler] Route "${route.id}" — message skipped by processor`,
          );
          continue;
        }

        if (result.error) {
          // Processing failed — apply skipOnError policy
          if (route.processing.skipOnError === false) {
            logger.warn(
              `[Handler] Route "${route.id}" — processing failed and skipOnError=false, dropping message`,
            );
            continue;
          } else {
            // skipOnError=true (default) — forward original
            logger.warn(
              `[Handler] Route "${route.id}" — processing failed, forwarding original message`,
            );
            processedText = null; // use original
          }
        } else {
          processedText = result.message;
        }
      }

      const counts = await forwardMessage(
        client,
        route,
        message,
        processedText,
        mediaType,
      );
      // Persist forwarding stats
      stats.recordForward(route.id, route.name || route.id, counts);
    } catch (err) {
      logger.error(
        `[Handler] Unhandled error in route "${route.id}" for message ${message.id}: ${err.message}`,
      );
    }
  }
}

/**
 * Registers the NewMessage event listener on the Telegram client.
 * @param {TelegramClient} client
 * @param {Map} sourceMap - Source channel ID -> routes lookup map
 */
function registerHandler(client, sourceMap) {
  client.addEventHandler(
    (event) => handleMessageWithMap(client, sourceMap, event),
    new NewMessage({}),
  );

  logger.info(
    `[Handler] ✅ Message handler registered — listening for new messages`,
  );
}

module.exports = { registerHandler, handleMessageWithMap };
