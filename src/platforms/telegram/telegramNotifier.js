// src/platforms/telegram/telegramNotifier.js

const { sendEscapedMessage, sendPhotoWithEscapedCaption } = require('./utils/messaging');

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
    const { chatId, replyToMessageId } = notificationContext;

    if (!chatId) {
      this.logger.error('[TelegramNotifier] Attempted to send notification but chatId is missing in notificationContext.', notificationContext);
      throw new Error('Missing chatId in notificationContext for Telegram notification.');
    }

    this.logger.info(`[TelegramNotifier] Sending notification to chatId: ${chatId}, replyToMessageId: ${replyToMessageId || 'N/A'}.`);

    const options = {};
    if (replyToMessageId) {
      options.reply_to_message_id = replyToMessageId;
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
            { text: '-', callback_data: 'hide_menu'},
            { text: 'ℹ︎', callback_data: `view_gen_info:${generationId}` },
            { text: '✎', callback_data: `tweak_gen:${generationId}` },
            { text: (generationRecord.metadata?.rerunCount || 0) > 0 ? `↻${generationRecord.metadata.rerunCount}` : '↻', callback_data: `rerun_gen:${generationId}` }
          ]
        ]
      };

      let finalMessageText = messageContent; // Default to the generic success message from dispatcher
      let imageUrl = null;
      let animationUrl = null;
      let specificTextOutput = null;

      if (generationRecord.responsePayload && generationRecord.responsePayload.length > 0) {
        const firstOutput = generationRecord.responsePayload[0];
        if (firstOutput.data) {
          if (firstOutput.data.text) {
            specificTextOutput = firstOutput.data.text;
          } else if (Array.isArray(firstOutput.data.tags) && firstOutput.data.tags.length > 0) {
            specificTextOutput = `Tags: ${firstOutput.data.tags.join(', ')}`;
          }

          if (firstOutput.data.images && firstOutput.data.images.length > 0 && firstOutput.data.images[0].url) {
            imageUrl = firstOutput.data.images[0].url;
          } else if (firstOutput.data.animations && firstOutput.data.animations.length > 0 && firstOutput.data.animations[0].url) {
            animationUrl = firstOutput.data.animations[0].url;
          } else if (firstOutput.data.videos && firstOutput.data.videos.length > 0 && firstOutput.data.videos[0].url) {
            animationUrl = firstOutput.data.videos[0].url; // Treat general video as animation
          }
        }
        // Fallback for direct URLs in payload if no structured data path matches
        if (!imageUrl && !animationUrl && firstOutput.url) {
            if (firstOutput.url.endsWith('.gif') || firstOutput.url.endsWith('.mp4')) {
                animationUrl = firstOutput.url;
            } else if (firstOutput.url.endsWith('.png') || firstOutput.url.endsWith('.jpg') || firstOutput.url.endsWith('.jpeg') || firstOutput.url.endsWith('.webp')) {
                imageUrl = firstOutput.url;
            }
        }
      }

      try {
        if (imageUrl) {
          const caption = specificTextOutput ? specificTextOutput : ''; // Use specific text if available, else empty
          this.logger.info(`[TelegramNotifier] Sending photo to ${chatId}: ${imageUrl} with caption: "${caption.substring(0,30)}..."`);
          await sendPhotoWithEscapedCaption(this.bot, chatId, imageUrl, options, caption);
        } else if (animationUrl) {
          const caption = specificTextOutput ? specificTextOutput : '';
          this.logger.info(`[TelegramNotifier] Sending animation to ${chatId}: ${animationUrl} with caption: "${caption.substring(0,30)}..."`);
          // sendPhotoWithEscapedCaption does not support animations, so fallback to bot.sendAnimation with manual escaping
          // For now, escape caption manually
          const { escapeMarkdownV2 } = require('../../../utils/stringUtils');
          await this.bot.sendAnimation(chatId, animationUrl, { caption: escapeMarkdownV2(caption), parse_mode: 'MarkdownV2', ...options });
        } else {
          // No visual media, send textual output or fallback generic message
          finalMessageText = specificTextOutput ? specificTextOutput : finalMessageText; 
          this.logger.info(`[TelegramNotifier] Sending text message (no media found or primary) to ${chatId}: "${finalMessageText.substring(0,50)}..."`);
          await sendEscapedMessage(this.bot, chatId, finalMessageText, options);
        }
        this.logger.info(`[TelegramNotifier] Successfully sent COMPLETED notification with keyboard to chatId: ${chatId}.`);
      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send COMPLETED notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        try {
          this.logger.warn(`[TelegramNotifier] Attempting to send fallback text message to ${chatId} after media send failure.`);
          // Send the original generic success message as fallback if media sending fails
          await sendEscapedMessage(this.bot, chatId, messageContent, options);
        } catch (fallbackError) {
          this.logger.error(`[TelegramNotifier] Fallback text message also failed for ${chatId}: ${fallbackError.message}`);
        }
        throw error; 
      }
    } else {
      // For FAILED messages or other types (non-completed jobs)
      try {
        await sendEscapedMessage(this.bot, chatId, messageContent, options);
        this.logger.info(`[TelegramNotifier] Successfully sent basic (non-completed) notification to chatId: ${chatId}.`);
      } catch (error) {
        this.logger.error(`[TelegramNotifier] Failed to send basic (non-completed) notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
        throw error; 
      }
    }
  }
}

module.exports = TelegramNotifier; 