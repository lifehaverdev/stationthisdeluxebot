/**
 * Telegram Delivery Adapter
 * 
 * Platform-specific implementation for delivering media content to Telegram users.
 * Provides methods to send images, animations, videos, and error messages to users.
 */

const { DeliveryAdapter } = require('../../../core/delivery/DeliveryAdapter');
const { AppError, ERROR_SEVERITY } = require('../../../core/shared/errors');

/**
 * TelegramDeliveryAdapter class
 * Implements DeliveryAdapter interface for Telegram
 */
class TelegramDeliveryAdapter extends DeliveryAdapter {
  /**
   * Create a new TelegramDeliveryAdapter
   * @param {Object} options - Adapter options
   * @param {Object} options.bot - Telegram bot instance
   * @param {Object} [options.analyticsService] - Optional analytics service
   */
  constructor(options = {}) {
    super({ platform: 'telegram' });
    
    if (!options.bot) {
      throw new Error('Telegram bot instance is required for TelegramDeliveryAdapter');
    }
    
    this.bot = options.bot;
    this.analyticsService = options.analyticsService;
  }
  
  /**
   * Deliver media content to a Telegram user
   * @param {Object} options - Delivery options
   * @param {Object} options.platformContext - Telegram-specific context
   * @param {string|number} options.platformContext.chatId - Telegram chat ID
   * @param {string|number} [options.platformContext.threadId] - Optional thread ID for forum/group threads
   * @param {string|number} [options.platformContext.messageId] - Optional message ID to reply to
   * @param {Object} options.mediaPayload - Media content to deliver
   * @param {string} options.mediaPayload.url - Media URL
   * @param {string} options.mediaPayload.type - Media type ('image', 'gif', 'video', etc.)
   * @param {string} [options.mediaPayload.caption] - Optional caption for the media
   * @param {Object} [options.mediaPayload.metadata] - Additional metadata
   * @param {Object} [options.user] - User information
   * @param {string} options.user.id - User ID
   * @param {Object} [options.taskInfo] - Generation task information
   * @returns {Promise<Object>} Delivery result with Telegram message info
   * @throws {AppError} If delivery fails
   */
  async deliverMedia({ platformContext, mediaPayload, user, taskInfo }) {
    try {
      const { chatId, threadId, messageId } = platformContext;
      const { url, type, caption, metadata = {} } = mediaPayload;
      
      if (!chatId) {
        throw new Error('Chat ID is required for Telegram media delivery');
      }
      
      if (!url) {
        throw new Error('Media URL is required for delivery');
      }
      
      // Track attempt in analytics if available
      this._trackEvent('telegram:delivery:attempt', {
        userId: user?.id,
        chatId,
        mediaType: type,
        taskId: taskInfo?.taskId
      });
      
      // Define message options common to all media types
      const options = {
        caption: caption || '',
        message_thread_id: threadId,
        reply_to_message_id: messageId,
        parse_mode: 'HTML',
        disable_notification: false
      };
      
      // Add message footer with generation info if available
      if (taskInfo?.prompt) {
        options.caption += options.caption ? '\n\n' : '';
        options.caption += `<i>Prompt: "${this._escapeHtml(taskInfo.prompt)}"</i>`;
      }
      
      // Send different media types based on the payload type
      let result;
      
      switch (type.toLowerCase()) {
        case 'image':
          result = await this.bot.sendPhoto(chatId, url, options);
          break;
          
        case 'gif':
        case 'animation':
          result = await this.bot.sendAnimation(chatId, url, options);
          break;
          
        case 'video':
          result = await this.bot.sendVideo(chatId, url, options);
          break;
          
        case 'document':
          result = await this.bot.sendDocument(chatId, url, options);
          break;
          
        default:
          // Default to sending photo
          result = await this.bot.sendPhoto(chatId, url, options);
      }
      
      // Track successful delivery
      this.emit('media:delivered', {
        platform: this.platform,
        userId: user?.id,
        chatId,
        mediaType: type,
        url,
        taskId: taskInfo?.taskId,
        messageId: result.message_id,
        timestamp: Date.now()
      });
      
      this._trackEvent('telegram:delivery:success', {
        userId: user?.id,
        chatId,
        mediaType: type,
        taskId: taskInfo?.taskId,
        messageId: result.message_id
      });
      
      return {
        success: true,
        platform: this.platform,
        mediaType: type,
        messageId: result.message_id,
        result
      };
    } catch (error) {
      // Log and track error
      console.error('Telegram media delivery error:', error);
      
      this.emit('media:error', {
        platform: this.platform,
        userId: user?.id,
        chatId: platformContext.chatId,
        error: error.message,
        mediaType: mediaPayload.type,
        url: mediaPayload.url,
        taskId: taskInfo?.taskId,
        timestamp: Date.now()
      });
      
      this._trackEvent('telegram:delivery:error', {
        userId: user?.id,
        chatId: platformContext.chatId,
        mediaType: mediaPayload.type,
        error: error.message,
        taskId: taskInfo?.taskId
      });
      
      // Rethrow as AppError
      throw new AppError(`Failed to deliver media to Telegram: ${error.message}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'TELEGRAM_DELIVERY_FAILED',
        cause: error
      });
    }
  }
  
  /**
   * Deliver an error message to a Telegram user
   * @param {Object} options - Delivery options
   * @param {Object} options.platformContext - Telegram-specific context
   * @param {string|number} options.platformContext.chatId - Telegram chat ID
   * @param {string|number} [options.platformContext.threadId] - Optional thread ID
   * @param {string|number} [options.platformContext.messageId] - Optional message ID to reply to
   * @param {Error|string} options.error - Error object or message
   * @param {Object} [options.user] - User information
   * @param {Object} [options.taskInfo] - Task information
   * @returns {Promise<Object>} Delivery result
   */
  async deliverErrorMessage({ platformContext, error, user, taskInfo }) {
    try {
      const { chatId, threadId, messageId } = platformContext;
      
      if (!chatId) {
        throw new Error('Chat ID is required for Telegram error delivery');
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Format error message
      const formattedMessage = `❌ <b>Error</b>\n\n${this._escapeHtml(errorMessage)}`;
      
      // Send message
      const result = await this.bot.sendMessage(chatId, formattedMessage, {
        parse_mode: 'HTML',
        message_thread_id: threadId,
        reply_to_message_id: messageId
      });
      
      // Track successful delivery
      this.emit('error:delivered', {
        platform: this.platform,
        userId: user?.id,
        chatId,
        error: errorMessage,
        taskId: taskInfo?.taskId,
        messageId: result.message_id,
        timestamp: Date.now()
      });
      
      this._trackEvent('telegram:error:delivered', {
        userId: user?.id,
        chatId,
        taskId: taskInfo?.taskId,
        messageId: result.message_id
      });
      
      return {
        success: true,
        platform: this.platform,
        messageId: result.message_id,
        result
      };
    } catch (deliveryError) {
      console.error('Telegram error delivery failed:', deliveryError);
      
      // Log but don't throw again since this is already error handling
      this.emit('error:delivery:failed', {
        platform: this.platform,
        userId: user?.id,
        chatId: platformContext.chatId,
        originalError: error instanceof Error ? error.message : String(error),
        deliveryError: deliveryError.message,
        taskId: taskInfo?.taskId,
        timestamp: Date.now()
      });
      
      return {
        success: false,
        platform: this.platform,
        error: deliveryError.message
      };
    }
  }
  
  /**
   * Deliver a status update to a Telegram user
   * @param {Object} options - Delivery options
   * @param {Object} options.platformContext - Telegram-specific context
   * @param {string|number} options.platformContext.chatId - Telegram chat ID
   * @param {string|number} [options.platformContext.threadId] - Optional thread ID
   * @param {string|number} [options.platformContext.messageId] - Optional message ID to edit
   * @param {string} options.status - Status message
   * @param {number} [options.progress] - Progress percentage (0-100)
   * @param {Object} [options.user] - User information
   * @param {Object} [options.taskInfo] - Task information
   * @returns {Promise<Object>} Delivery result
   */
  async deliverStatusUpdate({ platformContext, status, progress, user, taskInfo }) {
    try {
      const { chatId, threadId, messageId } = platformContext;
      
      if (!chatId) {
        throw new Error('Chat ID is required for Telegram status update');
      }
      
      // Format status message with progress bar if progress is provided
      let formattedMessage = `<b>Status:</b> ${this._escapeHtml(status)}`;
      
      if (typeof progress === 'number' && progress >= 0) {
        const progressBar = this._generateProgressBar(progress);
        formattedMessage += `\n\n${progressBar} ${Math.floor(progress)}%`;
      }
      
      let result;
      
      // If messageId is provided, try to edit that message
      if (messageId) {
        try {
          result = await this.bot.editMessageText(formattedMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
        } catch (editError) {
          // If edit fails (e.g., message is too old), fall back to sending new message
          console.warn('Could not edit message, sending new one instead:', editError.message);
          result = await this.bot.sendMessage(chatId, formattedMessage, {
            parse_mode: 'HTML',
            message_thread_id: threadId,
            disable_web_page_preview: true
          });
        }
      } else {
        // Send a new message if no messageId is provided
        result = await this.bot.sendMessage(chatId, formattedMessage, {
          parse_mode: 'HTML',
          message_thread_id: threadId,
          disable_web_page_preview: true
        });
      }
      
      // Track successful status update
      this.emit('status:delivered', {
        platform: this.platform,
        userId: user?.id,
        chatId,
        status,
        progress,
        taskId: taskInfo?.taskId,
        messageId: result.message_id,
        timestamp: Date.now()
      });
      
      return {
        success: true,
        platform: this.platform,
        messageId: result.message_id,
        result
      };
    } catch (error) {
      console.error('Telegram status update failed:', error);
      
      // Log but don't throw since status updates are non-critical
      this.emit('status:delivery:failed', {
        platform: this.platform,
        userId: user?.id,
        chatId: platformContext.chatId,
        status,
        progress,
        error: error.message,
        taskId: taskInfo?.taskId,
        timestamp: Date.now()
      });
      
      return {
        success: false,
        platform: this.platform,
        error: error.message
      };
    }
  }
  
  /**
   * Track an event using the analytics service if available
   * @private
   * @param {string} eventName - Name of the event
   * @param {Object} properties - Event properties
   */
  _trackEvent(eventName, properties) {
    if (this.analyticsService && typeof this.analyticsService.trackEvent === 'function') {
      this.analyticsService.trackEvent(eventName, {
        ...properties,
        platform: this.platform,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Generate a visual progress bar using Unicode characters
   * @private
   * @param {number} percent - Progress percentage (0-100)
   * @returns {string} Visual progress bar
   */
  _generateProgressBar(percent) {
    const totalBlocks = 10;
    const filledBlocks = Math.floor((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    
    const filled = '█'.repeat(filledBlocks);
    const empty = '░'.repeat(emptyBlocks);
    
    return `${filled}${empty}`;
  }
  
  /**
   * Escape HTML special characters to prevent XSS in Telegram HTML parsing
   * @private
   * @param {string} text - Text to escape
   * @returns {string} HTML-escaped text
   */
  _escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

/**
 * Create a new TelegramDeliveryAdapter
 * @param {Object} options - Adapter options
 * @returns {TelegramDeliveryAdapter} The created adapter
 */
function createTelegramDeliveryAdapter(options = {}) {
  return new TelegramDeliveryAdapter(options);
}

module.exports = {
  TelegramDeliveryAdapter,
  createTelegramDeliveryAdapter
}; 