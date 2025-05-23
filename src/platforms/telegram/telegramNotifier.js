// src/platforms/telegram/telegramNotifier.js

// Placeholder for actual Telegram message sending utilities
// These might come from a central bot service or utils like '../../utils/utils.js'
// For now, we assume sendMessage is a function available or passed via a bot instance.

class TelegramNotifier {
  constructor(bot, logger) {
    if (!bot) {
      throw new Error('[TelegramNotifier] Telegram bot instance is required.');
    }
    if (!logger) {
      throw new Error('[TelegramNotifier] Logger is required.');
    }
    this.bot = bot;
    this.logger = logger;
    this.logger.info('[TelegramNotifier] Initialized.');
  }

  /**
   * Sends a notification to Telegram.
   * @param {Object} notificationContext - Context for the notification.
   * @param {string} notificationContext.chatId - The Telegram chat ID to send to.
   * @param {string} [notificationContext.userId] - The Telegram user ID (optional, for logging or context).
   * @param {string} [notificationContext.messageId] - The original message ID to reply to (optional).
   * @param {string} messageContent - The text message to send.
   * @param {Object} generationRecord - The full generation record for additional context (optional).
   * @returns {Promise<void>} 
   */
  async sendNotification(notificationContext, messageContent, generationRecord) {
    const { chatId, messageId } = notificationContext;

    if (!chatId) {
      this.logger.error('[TelegramNotifier] Attempted to send notification but chatId is missing in notificationContext.', notificationContext);
      throw new Error('Missing chatId in notificationContext for Telegram notification.');
    }

    this.logger.info(`[TelegramNotifier] Sending notification to chatId: ${chatId}, messageId: ${messageId || 'N/A'}. Content: ${messageContent.substring(0, 50)}...`);

    const options = { parse_mode: 'Markdown' }; // Default parse_mode for captions/messages
    if (messageId) {
      options.reply_to_message_id = messageId;
    }

    if (generationRecord && generationRecord.status === 'completed') {
      const generationId = generationRecord._id || generationRecord.id;
      options.reply_markup = {
        inline_keyboard: [
          [
            { text: '😻', callback_data: `rate_gen:${generationId}:beautiful` },
            { text: '😹', callback_data: `rate_gen:${generationId}:funny` },
            { text: '😿', callback_data: `rate_gen:${generationId}:negative` }
          ],
          [
            { text: 'ℹ️ Info', callback_data: `view_gen_info:${generationId}` }, // Updated text for clarity
            { text: '⚙️ Tweak', callback_data: `tweak_gen:${generationId}` }    // Updated text for clarity
          ]
        ]
      };

      // Attempt to find media URLs from the generationRecord
      let imageUrl = null;
      let animationUrl = null;
      // Prioritize specific paths if known, then check general structure
      if (generationRecord.responsePayload && generationRecord.responsePayload.length > 0) {
        const firstOutput = generationRecord.responsePayload[0];
        if (firstOutput.data && firstOutput.data.images && firstOutput.data.images.length > 0 && firstOutput.data.images[0].url) {
          imageUrl = firstOutput.data.images[0].url;
        } else if (firstOutput.data && firstOutput.data.animations && firstOutput.data.animations.length > 0 && firstOutput.data.animations[0].url) {
          animationUrl = firstOutput.data.animations[0].url;
        } else if (firstOutput.data && firstOutput.data.videos && firstOutput.data.videos.length > 0 && firstOutput.data.videos[0].url) {
          animationUrl = firstOutput.data.videos[0].url; // Treat general video as animation for now
        } else if (firstOutput.url && (firstOutput.url.endsWith('.gif') || firstOutput.url.endsWith('.mp4'))) { // Fallback check for direct URL
            animationUrl = firstOutput.url;
        } else if (firstOutput.url && (firstOutput.url.endsWith('.png') || firstOutput.url.endsWith('.jpg') || firstOutput.url.endsWith('.jpeg') || firstOutput.url.endsWith('.webp'))) {
            imageUrl = firstOutput.url;
        }
      }

      try {
        if (imageUrl) {
          this.logger.info(`[TelegramNotifier] Sending photo to ${chatId}: ${imageUrl}`);
          await this.bot.sendPhoto(chatId, imageUrl, {
            caption: messageContent,
            ...options // Includes reply_markup and reply_to_message_id
          });
        } else if (animationUrl) {
          this.logger.info(`[TelegramNotifier] Sending animation to ${chatId}: ${animationUrl}`);
          await this.bot.sendAnimation(chatId, animationUrl, {
            caption: messageContent,
            ...options // Includes reply_markup and reply_to_message_id
          });
        } else {
          this.logger.info(`[TelegramNotifier] Sending text message (no media found) to ${chatId}`);
          await this.bot.sendMessage(chatId, messageContent, options);
        }
        this.logger.info(`[TelegramNotifier] Successfully sent COMPLETED notification with keyboard to chatId: ${chatId}.`);
      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send COMPLETED notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        // Attempt to send a fallback text message if media sending failed
        try {
            this.logger.warn(`[TelegramNotifier] Attempting to send fallback text message to ${chatId} after media send failure.`);
            await this.bot.sendMessage(chatId, `${messageContent}\n(Media could not be displayed directly)`, options);
        } catch (fallbackError) {
            this.logger.error(`[TelegramNotifier] Fallback text message also failed for ${chatId}: ${fallbackError.message}`);
        }
        throw error; // Re-throw original error for dispatcher to handle
      }
    } else {
      // For FAILED messages or other types, send as regular message
      try {
        await this.bot.sendMessage(chatId, messageContent, options);
        this.logger.info(`[TelegramNotifier] Successfully sent basic (non-completed) notification to chatId: ${chatId}.`);
      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send basic (non-completed) notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        throw error;
      }
    }
  }
}

module.exports = TelegramNotifier; 