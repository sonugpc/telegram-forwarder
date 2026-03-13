const axios = require('axios');
const logger = require('./utils/logger');

/**
 * Builds a standard Telegram-style update payload to send to the processing microservice.
 * Mimics the shape of a Telegram Bot API "channel_post" update.
 */
function buildUpdatePayload(message) {
    // Reconstruct a Telegram Bot API-compatible update object from the GramJS message
    const updateId = message.id;

    const channelPost = {
        message_id: message.id,
        date: message.date,
        chat: {
            id: message.peerId?.channelId
                ? -100 * parseInt(String(message.peerId.channelId), 10) // normalize to Bot API format
                : null,
            type: 'channel',
        },
        // Text content
        ...(message.message ? { text: message.message } : {}),

        // Entities (links, bold, etc.)
        ...(message.entities && message.entities.length > 0
            ? { entities: message.entities.map(serializeEntity) }
            : {}),

        // Media attachments
        ...(message.media ? { ...serializeMedia(message.media) } : {}),
    };

    return {
        update_id: updateId,
        channel_post: channelPost,
    };
}

/**
 * Serializes a GramJS MessageEntity to Bot API entity format.
 */
function serializeEntity(entity) {
    const base = { offset: entity.offset, length: entity.length };
    const className = entity.className || entity.constructor?.name || '';

    const typeMap = {
        MessageEntityBold: 'bold',
        MessageEntityItalic: 'italic',
        MessageEntityCode: 'code',
        MessageEntityPre: 'pre',
        MessageEntityUrl: 'url',
        MessageEntityTextUrl: 'text_link',
        MessageEntityMentionName: 'text_mention',
        MessageEntityMention: 'mention',
        MessageEntityHashtag: 'hashtag',
        MessageEntityCashtag: 'cashtag',
        MessageEntityBotCommand: 'bot_command',
        MessageEntityPhone: 'phone_number',
        MessageEntityStrike: 'strikethrough',
        MessageEntityUnderline: 'underline',
        MessageEntitySpoiler: 'spoiler',
    };

    const type = typeMap[className] || 'unknown';
    const result = { ...base, type };

    if (entity.url) result.url = entity.url;
    if (entity.language) result.language = entity.language;

    return result;
}

/**
 * Serializes GramJS media to Bot API-compatible fields.
 */
function serializeMedia(media) {
    const className = media.className || media.constructor?.name || '';

    if (className === 'MessageMediaPhoto' && media.photo) {
        // Pick the largest size for file_id (Telegram stores multiple sizes)
        const sizes = media.photo.sizes || [];
        const largest = sizes
            .filter((s) => s.type !== 'i' && s.type !== 'p') // exclude stripped/path types
            .sort((a, b) => (b.w || 0) - (a.w || 0))[0];

        return {
            photo: sizes.map((s) => ({
                file_id: String(media.photo.id),
                file_unique_id: String(media.photo.accessHash || media.photo.id),
                width: s.w || 0,
                height: s.h || 0,
                file_size: s.size || 0,
            })),
            _media_type: 'photo',
            _proxy_url: `https://media.bigtricks.in/file/${media.photo.id}`,
        };
    }

    if (className === 'MessageMediaDocument' && media.document) {
        const attrs = media.document.attributes || [];
        const videoAttr = attrs.find((a) => a.className === 'DocumentAttributeVideo');
        const audioAttr = attrs.find((a) => a.className === 'DocumentAttributeAudio');
        const filenameAttr = attrs.find((a) => a.className === 'DocumentAttributeFilename');
        const stickerAttr = attrs.find((a) => a.className === 'DocumentAttributeSticker');
        const animAttr = attrs.find((a) => a.className === 'DocumentAttributeAnimated');

        const fileId = String(media.document.id);
        const base = {
            file_id: fileId,
            file_unique_id: String(media.document.accessHash || media.document.id),
            file_size: media.document.size || 0,
            mime_type: media.document.mimeType || '',
            _proxy_url: `https://media.bigtricks.in/file/${fileId}`,
        };

        if (stickerAttr) return { sticker: { ...base, emoji: stickerAttr.alt || '' }, _media_type: 'sticker' };
        if (animAttr) return { animation: base, _media_type: 'animation' };
        if (videoAttr) return { video: { ...base, duration: videoAttr.duration || 0, width: videoAttr.w || 0, height: videoAttr.h || 0 }, _media_type: 'video' };
        if (audioAttr) return { audio: { ...base, duration: audioAttr.duration || 0, title: audioAttr.title || '', performer: audioAttr.performer || '' }, _media_type: 'audio' };

        return {
            document: { ...base, file_name: filenameAttr?.fileName || 'file' },
            _media_type: 'document',
        };
    }

    return {};
}

/**
 * Determines the media type string from a GramJS media object.
 */
function getMediaType(media) {
    if (!media) return null;
    const className = media.className || media.constructor?.name || '';
    if (className === 'MessageMediaPhoto') return 'photo';
    if (className === 'MessageMediaDocument') {
        const attrs = media.document?.attributes || [];
        if (attrs.find((a) => a.className === 'DocumentAttributeVideo')) return 'video';
        if (attrs.find((a) => a.className === 'DocumentAttributeAudio')) return 'audio';
        if (attrs.find((a) => a.className === 'DocumentAttributeSticker')) return 'sticker';
        if (attrs.find((a) => a.className === 'DocumentAttributeAnimated')) return 'animation';
        return 'document';
    }
    return null;
}

/**
 * Sends the Telegram update payload to the processing microservice.
 * Returns { message, skip } based on the API response.
 *
 * Expected API response:
 * { "success": true, "message": "converted text", "skip": false }
 */
async function processMessage(route, gramjsMessage) {
    const payload = buildUpdatePayload(gramjsMessage);

    try {
        logger.debug(`[Processor] Calling ${route.processing.url} for message ${gramjsMessage.id}`);

        const headers = { 'Content-Type': 'application/json' };
        if (process.env.PROCESSING_AUTH_TOKEN) {
            headers['authX'] = process.env.PROCESSING_AUTH_TOKEN;
        }

        const response = await axios.post(route.processing.url, payload, {
            timeout: route.processing.timeoutMs || 50000,
            headers,
        });

        const data = response.data;

        if (!data.success) {
            logger.warn(`[Processor] API returned success=false for route "${route.id}", msg ${gramjsMessage.id}`);
            return { message: null, skip: false, error: 'API returned success=false' };
        }

        if (data.skip === true) {
            logger.info(`[Processor] API requested skip for route "${route.id}", msg ${gramjsMessage.id}`);
            return { message: null, skip: true };
        }

        return { message: data.message || gramjsMessage.message, skip: false };
    } catch (err) {
        logger.error(`[Processor] API call failed for route "${route.id}", msg ${gramjsMessage.id}: ${err.message}`);
        return { message: null, skip: false, error: err.message };
    }
}

module.exports = { processMessage, buildUpdatePayload, getMediaType, serializeMedia };
