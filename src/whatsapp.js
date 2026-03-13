const axios = require("axios");
const logger = require("./utils/logger");

const sendTextMessage = async (text, chatId) => {
  if (!process.env.WAHA_BASE_URL || !process.env.WAHA_API_KEY) {
    logger.warn("[WhatsApp] WAHA credentials not configured in .env");
    return { success: false, error: "Credentials missing" };
  }

  try {
    const response = await axios.post(
      `${process.env.WAHA_BASE_URL}/api/whatsapp/send-text`,
      {
        to: chatId,
        message: text,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WAHA_API_KEY}`,
        },
      },
    );
    return { success: true, data: response.data };
  } catch (error) {
    logger.error(
      `[WhatsApp] Error sending text message to ${chatId}: ${error.message}`,
    );
    return { success: false, error: error.message };
  }
};

const sendImageMessage = async (imageUrl, caption = "", chatId) => {
  if (!process.env.WAHA_BASE_URL || !process.env.WAHA_API_KEY) {
    logger.warn("[WhatsApp] WAHA credentials not configured in .env");
    return { success: false, error: "Credentials missing" };
  }

  try {
    const response = await axios.post(
      `${process.env.WAHA_BASE_URL}/api/whatsapp/send-media`,
      {
        to: chatId,
        mediaUrl: imageUrl,
        caption: caption,
        filename: "image.jpg",
        mediaType: "image/jpeg",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.WAHA_API_KEY}`,
        },
      },
    );
    return { success: true, data: response.data };
  } catch (error) {
    logger.error(
      `[WhatsApp] Error sending image message to ${chatId}: ${error.message}`,
    );
    return { success: false, error: error.message };
  }
};

const getChats = async () => {
  if (!process.env.WAHA_BASE_URL || !process.env.WAHA_API_KEY)
    return { success: false, data: [] };
  try {
    const response = await axios.get(
      `${process.env.WAHA_BASE_URL}/api/whatsapp/chats`,
      {
        headers: { Authorization: `Bearer ${process.env.WAHA_API_KEY}` },
      },
    );
    return { success: true, data: response.data };
  } catch (error) {
    logger.error(`[WhatsApp] Error fetching chats: ${error.message}`);
    return { success: false, data: [] };
  }
};

const getChannels = async () => {
  if (!process.env.WAHA_BASE_URL || !process.env.WAHA_API_KEY)
    return { success: false, data: [] };
  try {
    const response = await axios.get(
      `${process.env.WAHA_BASE_URL}/api/whatsapp/channels`,
      {
        headers: { Authorization: `Bearer ${process.env.WAHA_API_KEY}` },
      },
    );
    return { success: true, data: response.data };
  } catch (error) {
    logger.error(`[WhatsApp] Error fetching channels: ${error.message}`);
    return { success: false, data: [] };
  }
};

module.exports = { sendTextMessage, sendImageMessage, getChats, getChannels };
