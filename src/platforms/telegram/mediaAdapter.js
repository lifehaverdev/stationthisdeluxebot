/**
 * Telegram Media Adapter
 * 
 * Provides Telegram-specific media handling functions to the MediaService.
 * This adapter connects the platform-agnostic MediaService with Telegram-specific functionality.
 */

/**
 * Creates a Telegram Media Adapter
 * @param {Object} bot - Telegram bot instance
 * @param {Object} options - Additional options
 * @returns {Object} - Telegram media adapter functions
 */
function createTelegramMediaAdapter(bot, options = {}) {
  /**
   * Get file URL from Telegram file ID
   * @param {string} fileId - Telegram file ID
   * @returns {Promise<string>} - File URL
   */
  async function getFileUrl(fileId) {
    try {
      const fileInfo = await bot.getFile(fileId);
      const botToken = process.env.TELEGRAM_TOKEN || options.botToken;
      return `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
    } catch (error) {
      console.error('Error getting Telegram file URL:', error);
      return null;
    }
  }

  /**
   * Send a photo to a Telegram chat
   * @param {Object} message - Telegram message context
   * @param {string} filePath - Path to the photo file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendPhoto(message, filePath, options = {}) {
    const chatId = message.chat.id;
    const messageOptions = {
      caption: options.caption,
      reply_to_message_id: message.message_id,
      reply_markup: options.reply_markup
    };
    
    // Handle thread ID if present
    if (message.chat.is_forum && message.message_thread_id) {
      messageOptions.message_thread_id = message.message_thread_id;
    }
    
    try {
      const sentMessage = await bot.sendPhoto(chatId, filePath, messageOptions);
      return sentMessage;
    } catch (error) {
      console.error('Error sending photo:', error);
      
      // Try without reply_to_message_id if that's causing issues
      if (messageOptions.reply_to_message_id) {
        delete messageOptions.reply_to_message_id;
        try {
          return await bot.sendPhoto(chatId, filePath, messageOptions);
        } catch (retryError) {
          console.error('Error sending photo (retry):', retryError);
          return null;
        }
      }
      
      return null;
    }
  }

  /**
   * Send a document to a Telegram chat
   * @param {Object} message - Telegram message context
   * @param {string} filePath - Path to the document file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendDocument(message, filePath, options = {}) {
    const chatId = message.chat.id;
    const messageOptions = {
      caption: options.caption,
      reply_to_message_id: message.message_id,
      reply_markup: options.reply_markup
    };
    
    // Handle thread ID if present
    if (message.chat.is_forum && message.message_thread_id) {
      messageOptions.message_thread_id = message.message_thread_id;
    }
    
    try {
      return await bot.sendDocument(chatId, filePath, messageOptions);
    } catch (error) {
      console.error('Error sending document:', error);
      return null;
    }
  }

  /**
   * Send an animation to a Telegram chat
   * @param {Object} message - Telegram message context
   * @param {string} filePath - Path to the animation file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendAnimation(message, filePath, options = {}) {
    const chatId = message.chat.id;
    const messageOptions = {
      caption: options.caption,
      reply_to_message_id: message.message_id,
      reply_markup: options.reply_markup
    };
    
    // Handle thread ID if present
    if (message.chat.is_forum && message.message_thread_id) {
      messageOptions.message_thread_id = message.message_thread_id;
    }
    
    try {
      return await bot.sendAnimation(chatId, filePath, messageOptions);
    } catch (error) {
      console.error('Error sending animation:', error);
      return null;
    }
  }

  /**
   * Send a video to a Telegram chat
   * @param {Object} message - Telegram message context
   * @param {string} filePath - Path to the video file
   * @param {Object} options - Send options
   * @returns {Promise<Object>} - Sent message
   */
  async function sendVideo(message, filePath, options = {}) {
    const chatId = message.chat.id;
    const messageOptions = {
      caption: options.caption,
      reply_to_message_id: message.message_id,
      reply_markup: options.reply_markup
    };
    
    // Handle thread ID if present
    if (message.chat.is_forum && message.message_thread_id) {
      messageOptions.message_thread_id = message.message_thread_id;
    }
    
    try {
      return await bot.sendVideo(chatId, filePath, messageOptions);
    } catch (error) {
      console.error('Error sending video:', error);
      return null;
    }
  }

  return {
    getFileUrl,
    sendPhoto,
    sendDocument,
    sendAnimation,
    sendVideo
  };
}

module.exports = createTelegramMediaAdapter; 