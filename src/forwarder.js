const { Api } = require('teleproto');
const logger = require('./utils/logger');
const whatsapp = require('./whatsapp');

/**
 * Sends a text message to a destination channel.
 */
async function sendText(client, destination, text) {
    await client.sendMessage(destination, {
        message: text,
        parseMode: 'md',
        linkPreview: false,
    });
}

/**
 * Sends a media message (photo, video, document, etc.) to a destination channel.
 * Re-uses the original InputMessageID to forward the actual file from Telegram's CDN.
 */
async function sendMedia(client, destination, originalMessage, captionText) {
    try {
        // Re-forward using Telegram's native copy — this transfers the media file_id
        // from the source to destination without re-uploading.
        await client.sendFile(destination, {
            file: originalMessage.media,
            caption: captionText || '',
            parseMode: 'md',
            forceDocument: false,
        });
    } catch (err) {
        logger.warn(`[Forwarder] sendFile failed, falling back to text-only for dest ${destination}: ${err.message}`);
        if (captionText) {
            await sendText(client, destination, captionText);
        }
    }
}

/**
 * Checks if a media type is allowed by the route filter config.
 */
function isMediaAllowed(route, mediaType) {
    if (!route.filters?.allowMedia) return false;
    const allowed = route.filters?.allowedMediaTypes;
    if (!allowed || allowed.length === 0) return true; // allow all if not specified
    return allowed.includes(mediaType);
}

/**
 * Core forwarding function.
 *
 * @param {TelegramClient} client - Authenticated GramJS client
 * @param {Object} route - Route config object
 * @param {Object} originalMessage - Original GramJS message object
 * @param {string|null} processedText - Converted text from processor (null = use original)
 * @param {string|null} mediaType - Detected media type (null = text-only message)
 */
async function forwardMessage(client, route, originalMessage, processedText, mediaType) {
    let textToSend = processedText !== null ? processedText : (originalMessage.message || '');

    // Append global tagline if configured
    if (process.env.GLOBAL_TAGLINE && textToSend.trim()) {
        textToSend = `${textToSend}\n\n${process.env.GLOBAL_TAGLINE}`;
    }

    const destinations = route.destinations || [];
    const waDestinations = route.waDestinations || [];

    if (destinations.length === 0 && waDestinations.length === 0) {
        logger.warn(`[Forwarder] Route "${route.id}" has no destinations configured`);
        return;
    }

    const hasMedia = !!originalMessage.media && mediaType !== null;
    const hasText = !!textToSend.trim();

    // 1. Forward to Telegram destinations
    for (const destination of destinations) {
        let destName = destination;
        try {
            const destEntity = await client.getEntity(destination);
            destName = destEntity.username ? `@${destEntity.username}` : (destEntity.title || destEntity.firstName || destination);
        } catch (err) {
            // Unresolved entity, keep as is
        }

        try {
            if (hasMedia && isMediaAllowed(route, mediaType)) {
                // Caption = processed/original text
                logger.info(
                    `[Forwarder] → Sending ${mediaType} to ${destName} (route: ${route.id})`
                );
                await sendMedia(client, destination, originalMessage, textToSend);
            } else if (hasMedia && !isMediaAllowed(route, mediaType)) {
                // Media filtered out — send text caption only (if any)
                logger.info(
                    `[Forwarder] Media type "${mediaType}" filtered for route "${route.id}", sending text only`
                );
                if (hasText && route.filters?.allowText !== false) {
                    await sendText(client, destination, textToSend);
                }
            } else if (hasText && route.filters?.allowText !== false) {
                // Pure text message
                logger.info(
                    `[Forwarder] → Sending text message to ${destName} (route: ${route.id})`
                );
                await sendText(client, destination, textToSend);
            } else {
                logger.info(
                    `[Forwarder] Message filtered out for route "${route.id}" to ${destName} — no text or allowed media`
                );
            }
        } catch (err) {
            logger.error(
                `[Forwarder] Failed to send to ${destName} (route: ${route.id}): ${err.message}`
            );
        }
    }

    // 2. Forward to WhatsApp destinations
    for (const waDest of waDestinations) {
        try {
            if (hasMedia && mediaType === 'photo' && isMediaAllowed(route, mediaType)) {
                // Determine proxy URL for the photo
                let photoUrl = '';
                if (originalMessage.media.photo) {
                    photoUrl = `https://media.bigtricks.in/file/${originalMessage.media.photo.id}`;
                }
                if (photoUrl) {
                    logger.info(`[Forwarder] → Sending WhatsApp image to ${waDest} (route: ${route.id})`);
                    await whatsapp.sendImageMessage(photoUrl, textToSend, waDest);
                } else if (hasText && route.filters?.allowText !== false) {
                    // Fallback to text if no photo ID
                    logger.info(`[Forwarder] → Sending WhatsApp text message to ${waDest} (route: ${route.id})`);
                    await whatsapp.sendTextMessage(textToSend, waDest);
                }
            } else if (hasText && route.filters?.allowText !== false) {
                logger.info(`[Forwarder] → Sending WhatsApp text message to ${waDest} (route: ${route.id})`);
                await whatsapp.sendTextMessage(textToSend, waDest);
            }
        } catch (err) {
            logger.error(
                `[Forwarder] Failed to send to WhatsApp ${waDest} (route: ${route.id}): ${err.message}`
            );
        }
    }
}

module.exports = { forwardMessage, isMediaAllowed };
