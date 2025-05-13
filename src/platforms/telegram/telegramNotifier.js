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

    const options = {};
    if (messageId) {
      options.reply_to_message_id = messageId;
    }

    try {
      // Assuming this.bot has a sendMessage method compatible with node-telegram-bot-api
      // Or, if using utils.js, it might be: `await sendMessageUtils(mockMsg, messageContent, options);`
      // We need to clarify how `sendMessage` from utils.js is accessed or if this.bot is the direct API.
      // For now, directly using this.bot.sendMessage as is common.
      await this.bot.sendMessage(chatId, messageContent, options);
      this.logger.info(`[TelegramNotifier] Successfully sent notification to chatId: ${chatId}.`);
    } catch (error) {
      this.logger.error(`[TelegramNotifier] Failed to send notification to chatId: ${chatId}. Error: ${error.message}`, error.stack);
      // Re-throw the error so NotificationDispatcher can handle retry logic and DB updates
      throw error; 
    }
  }
}

module.exports = TelegramNotifier; 