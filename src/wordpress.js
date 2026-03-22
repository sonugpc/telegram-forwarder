"use strict";
const axios = require("axios");
const logger = require("./utils/logger");

/**
 * Posts a deal message to a WordPress endpoint.
 *
 * Auth: Bearer <PROCESSING_AUTH_TOKEN>  (same token as the processing microservice)
 * Payload: { message: <original raw text>, siteurl: <configured site URL> }
 *
 * @param {string} endpoint  Full POST URL provided per-destination in the route config
 * @param {string} siteurl   WordPress site URL configured during route setup
 * @param {string} originalText  Raw message text BEFORE any affiliate conversion
 * @returns {{ success: boolean, data?: any, error?: string }}
 */
async function postToWordPress(endpoint, siteurl, originalText) {
  const token = (process.env.PROCESSING_AUTH_TOKEN || "").trim();

  if (!token) {
    logger.warn(
      "[WordPress] PROCESSING_AUTH_TOKEN is not configured — skipping WP post",
    );
    return { success: false, error: "PROCESSING_AUTH_TOKEN missing" };
  }

  if (!endpoint) {
    logger.warn("[WordPress] No endpoint configured for this WP destination");
    return { success: false, error: "endpoint missing" };
  }

  try {
    logger.info(`[WordPress] → Posting to ${endpoint} (siteurl: ${siteurl})`);

    const response = await axios.post(
      endpoint,
      { message: originalText, siteurl },
      {
        headers: {
          "Content-Type": "application/json",
          AuthAuthorization: `Bearer ${token}`,
        },
        timeout: 15000,
      },
    );

    logger.info(
      `[WordPress] ✅ Success — ${endpoint} responded ${response.status}: ${JSON.stringify(response.data)}`,
    );
    return { success: true, data: response.data };
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    logger.error(`[WordPress] ❌ Failed to post to ${endpoint}: ${detail}`);
    return { success: false, error: detail };
  }
}

module.exports = { postToWordPress };
