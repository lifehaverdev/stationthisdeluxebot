/**
 * Telegram Command Adapter
 * 
 * Adapts the command system to work with Telegram Bot API.
 * Handles converting Telegram messages to command format and back.
 */

const { AppError, ERROR_SEVERITY } = require('../../shared/errors');
const { AbstractCommandAdapter } = require('./abstractAdapter');

/**
 * Telegram Command Adapter
 * @extends AbstractCommandAdapter
 */
class TelegramCommandAdapter extends AbstractCommandAdapter {
  /**
   * Convert Telegram message to command format
   * @param {Object} message - Telegram message object
   * @returns {Object} Command execution request
   */
  convertRequest(message) {
    if (!message || typeof message !== 'object') {
      throw new AppError('Invalid Telegram message', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_TELEGRAM_MESSAGE'
      });
    }

    // Extract command from message text
    let commandText = '';
    let parameters = {};

    if (message.text) {
      // Handle /command format
      const textParts = message.text.split(' ');
      commandText = textParts[0];

      // Remove leading slash if present
      if (commandText.startsWith('/')) {
        commandText = commandText.substring(1);
      }

      // Parse parameters
      if (textParts.length > 1) {
        const paramText = textParts.slice(1).join(' ');
        
        // Try to parse as JSON if it starts with { or [
        if ((paramText.startsWith('{') && paramText.endsWith('}')) || 
            (paramText.startsWith('[') && paramText.endsWith(']'))) {
          try {
            parameters = JSON.parse(paramText);
          } catch (e) {
            // If parsing fails, treat as text
            parameters = { text: paramText };
          }
        } else {
          // Simple text parameter
          parameters = { text: paramText };
        }
      }
    } else if (message.caption) {
      // Handle media messages with captions
      const captionParts = message.caption.split(' ');
      commandText = captionParts[0];
      
      if (commandText.startsWith('/')) {
        commandText = commandText.substring(1);
      }
      
      if (captionParts.length > 1) {
        parameters = { text: captionParts.slice(1).join(' ') };
      }
      
      // Add media information
      if (message.photo) {
        parameters.media = {
          type: 'photo',
          items: message.photo
        };
      } else if (message.document) {
        parameters.media = {
          type: 'document',
          item: message.document
        };
      }
    } else if (message.callback_query) {
      // Handle callback queries
      try {
        const callbackData = JSON.parse(message.callback_query.data);
        commandText = callbackData.command;
        parameters = callbackData.params || {};
      } catch (e) {
        // If parsing fails, use raw string
        commandText = message.callback_query.data;
      }
    }

    // Build context object
    const context = {
      userId: message.from.id.toString(),
      chatId: message.chat ? message.chat.id : (message.from ? message.from.id : null),
      messageId: message.message_id,
      parameters,
      telegram: {
        raw: message,
        isCallback: !!message.callback_query,
        isAdmin: message.from.id.toString() === process.env.DEV_DMS,
        userName: message.from.username,
        firstName: message.from.first_name,
        lastName: message.from.last_name
      }
    };

    return {
      command: commandText,
      context
    };
  }

  /**
   * Convert command response to Telegram format
   * @param {Object} response - Command execution response
   * @param {Object} originalMessage - Original Telegram message
   * @returns {Object} Telegram-formatted response
   */
  convertResponse(response, originalMessage) {
    // Default chat ID from original message
    const chatId = originalMessage.chat ? 
      originalMessage.chat.id : 
      (originalMessage.from ? originalMessage.from.id : null);

    // If response is already in Telegram format
    if (response && response.chatId !== undefined && response.text !== undefined) {
      return response;
    }

    // Build default response format
    const telegramResponse = {
      chatId,
      text: '',
      options: {}
    };

    if (!response) {
      telegramResponse.text = 'Command executed successfully';
      return telegramResponse;
    }

    // Handle string responses
    if (typeof response === 'string') {
      telegramResponse.text = response;
      return telegramResponse;
    }

    // Handle object responses
    if (typeof response === 'object') {
      // Extract text content
      if (response.text) {
        telegramResponse.text = response.text;
      } else if (response.message) {
        telegramResponse.text = response.message;
      } else if (response.content) {
        telegramResponse.text = response.content;
      } else {
        // Try to stringify the object
        try {
          telegramResponse.text = JSON.stringify(response, null, 2);
        } catch (e) {
          telegramResponse.text = 'Command executed successfully';
        }
      }

      // Extract options
      if (response.options) {
        telegramResponse.options = { ...response.options };
      }

      // Handle inline keyboard
      if (response.keyboard) {
        telegramResponse.options.reply_markup = {
          inline_keyboard: response.keyboard
        };
      }

      // Handle parse mode
      if (response.format) {
        const format = response.format.toLowerCase();
        if (format === 'markdown' || format === 'md') {
          telegramResponse.options.parse_mode = 'Markdown';
        } else if (format === 'html') {
          telegramResponse.options.parse_mode = 'HTML';
        }
      }
    }

    return telegramResponse;
  }

  /**
   * Convert error to Telegram format
   * @param {Error} error - Error object
   * @param {Object} originalMessage - Original Telegram message
   * @returns {Object} Telegram-formatted error response
   */
  convertError(error, originalMessage) {
    const chatId = originalMessage.chat ? 
      originalMessage.chat.id : 
      (originalMessage.from ? originalMessage.from.id : null);
    
    let errorMessage = 'An error occurred';
    
    if (error instanceof AppError) {
      errorMessage = error.userMessage || error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      chatId,
      text: `❌ Error: ${errorMessage}`,
      options: {
        parse_mode: 'Markdown'
      }
    };
  }
}

module.exports = {
  TelegramCommandAdapter
}; 