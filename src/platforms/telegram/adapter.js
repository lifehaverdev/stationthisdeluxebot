/**
 * Telegram Platform Adapter
 * 
 * Wraps the Telegram bot API to implement the PlatformAdapter interface.
 * This allows Telegram-specific code to work with the platform-agnostic abstraction.
 */

const PlatformAdapter = require('../common/PlatformAdapter');
const { 
  sendEscapedMessage, 
  editEscapedMessageText,
  sendPhotoWithEscapedCaption,
  sendVideoWithEscapedCaption,
  sendDocumentWithEscapedCaption
} = require('./utils/messaging');
const { setReaction, getTelegramFileUrl } = require('./utils/telegramUtils');

/**
 * Convert platform-agnostic buttons to Telegram inline keyboard format
 * @param {Array<Array<ButtonDefinition>>} buttons - Button layout
 * @returns {Object} Telegram inline_keyboard format
 */
function convertButtonsToTelegramKeyboard(buttons) {
  if (!buttons || buttons.length === 0) {
    return { inline_keyboard: [] };
  }

  const inline_keyboard = buttons.map(row => 
    row.map(button => {
      const telegramButton = {
        text: button.text
      };

      if (button.url) {
        telegramButton.url = button.url;
      } else {
        telegramButton.callback_data = button.action;
      }

      return telegramButton;
    })
  );

  return { inline_keyboard };
}

/**
 * Convert platform-agnostic parse mode to Telegram parse mode
 * @param {string} parseMode - Platform-agnostic parse mode
 * @returns {string} Telegram parse mode
 */
function convertParseMode(parseMode) {
  // Telegram uses MarkdownV2, but we'll handle conversion in messaging utils
  // For now, default to MarkdownV2
  if (parseMode === 'markdown' || parseMode === 'MarkdownV2') {
    return 'MarkdownV2';
  }
  if (parseMode === 'html' || parseMode === 'HTML') {
    return 'HTML';
  }
  return 'MarkdownV2'; // Default
}

class TelegramAdapter extends PlatformAdapter {
  /**
   * @param {Object} bot - Telegram bot instance (node-telegram-bot-api)
   * @param {Object} options - Adapter options
   * @param {Object} options.logger - Logger instance
   */
  constructor(bot, options = {}) {
    super({ ...options, platform: 'telegram' });
    
    if (!bot) {
      throw new Error('Telegram bot instance is required');
    }
    
    this.bot = bot;
  }

  /**
   * Send a text message
   * @param {string} channelId - Telegram chat ID
   * @param {string} text - Message text
   * @param {SendMessageOptions} options - Message options
   * @returns {Promise<Object>} Sent message
   */
  async sendMessage(channelId, text, options = {}) {
    const telegramOptions = {
      parse_mode: convertParseMode(options.parseMode)
    };

    if (options.replyToMessageId) {
      telegramOptions.reply_to_message_id = options.replyToMessageId;
    }

    if (options.buttons && options.buttons.length > 0) {
      telegramOptions.reply_markup = convertButtonsToTelegramKeyboard(options.buttons);
    }

    // Merge any platform-specific options
    if (options.platformSpecific) {
      Object.assign(telegramOptions, options.platformSpecific);
    }

    return await sendEscapedMessage(this.bot, channelId, text, telegramOptions);
  }

  /**
   * Edit a message's text
   * @param {string} channelId - Telegram chat ID
   * @param {string} messageId - Message ID
   * @param {string} text - New text
   * @param {SendMessageOptions} options - Edit options
   * @returns {Promise<Object|boolean>} Edited message or success
   */
  async editMessage(channelId, messageId, text, options = {}) {
    const telegramOptions = {
      chat_id: channelId,
      message_id: messageId,
      parse_mode: convertParseMode(options.parseMode)
    };

    if (options.buttons && options.buttons.length > 0) {
      telegramOptions.reply_markup = convertButtonsToTelegramKeyboard(options.buttons);
    }

    if (options.platformSpecific) {
      Object.assign(telegramOptions, options.platformSpecific);
    }

    return await editEscapedMessageText(this.bot, text, telegramOptions);
  }

  /**
   * Delete a message
   * @param {string} channelId - Telegram chat ID
   * @param {string} messageId - Message ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteMessage(channelId, messageId) {
    try {
      await this.bot.deleteMessage(channelId, messageId);
      return true;
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error deleting message: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a photo
   * @param {string} channelId - Telegram chat ID
   * @param {Buffer|string} photo - Photo buffer or file ID/URL
   * @param {MediaOptions} options - Media options
   * @returns {Promise<Object>} Sent message
   */
  async sendPhoto(channelId, photo, options = {}) {
    const telegramOptions = {
      parse_mode: convertParseMode(options.parseMode)
    };

    if (options.replyToMessageId) {
      telegramOptions.reply_to_message_id = options.replyToMessageId;
    }

    if (options.buttons && options.buttons.length > 0) {
      telegramOptions.reply_markup = convertButtonsToTelegramKeyboard(options.buttons);
    }

    if (options.platformSpecific) {
      Object.assign(telegramOptions, options.platformSpecific);
    }

    const caption = options.caption || '';
    return await sendPhotoWithEscapedCaption(this.bot, channelId, photo, telegramOptions, caption);
  }

  /**
   * Send a video
   * @param {string} channelId - Telegram chat ID
   * @param {Buffer|string} video - Video buffer or file ID/URL
   * @param {MediaOptions} options - Media options
   * @returns {Promise<Object>} Sent message
   */
  async sendVideo(channelId, video, options = {}) {
    const telegramOptions = {
      parse_mode: convertParseMode(options.parseMode)
    };

    if (options.replyToMessageId) {
      telegramOptions.reply_to_message_id = options.replyToMessageId;
    }

    if (options.buttons && options.buttons.length > 0) {
      telegramOptions.reply_markup = convertButtonsToTelegramKeyboard(options.buttons);
    }

    if (options.platformSpecific) {
      Object.assign(telegramOptions, options.platformSpecific);
    }

    const caption = options.caption || '';
    return await sendVideoWithEscapedCaption(this.bot, channelId, video, telegramOptions, caption);
  }

  /**
   * Send a document
   * @param {string} channelId - Telegram chat ID
   * @param {Buffer|string} document - Document buffer or file ID/URL
   * @param {MediaOptions} options - Media options
   * @returns {Promise<Object>} Sent message
   */
  async sendDocument(channelId, document, options = {}) {
    const telegramOptions = {
      parse_mode: convertParseMode(options.parseMode)
    };

    if (options.replyToMessageId) {
      telegramOptions.reply_to_message_id = options.replyToMessageId;
    }

    if (options.buttons && options.buttons.length > 0) {
      telegramOptions.reply_markup = convertButtonsToTelegramKeyboard(options.buttons);
    }

    if (options.platformSpecific) {
      Object.assign(telegramOptions, options.platformSpecific);
    }

    const caption = options.caption || '';
    const filename = options.filename || 'file';
    
    return await sendDocumentWithEscapedCaption(
      this.bot, 
      channelId, 
      document, 
      filename, 
      telegramOptions, 
      caption
    );
  }

  /**
   * Send a menu with buttons
   * @param {string} channelId - Telegram chat ID
   * @param {string} text - Menu text
   * @param {Array<Array<ButtonDefinition>>} buttons - Button layout
   * @param {SendMessageOptions} options - Additional options
   * @returns {Promise<Object>} Sent message
   */
  async sendMenu(channelId, text, buttons, options = {}) {
    return await this.sendMessage(channelId, text, {
      ...options,
      buttons
    });
  }

  /**
   * Edit a message's menu/buttons
   * @param {string} channelId - Telegram chat ID
   * @param {string} messageId - Message ID
   * @param {string} text - Optional new text
   * @param {Array<Array<ButtonDefinition>>} buttons - New button layout
   * @param {SendMessageOptions} options - Additional options
   * @returns {Promise<Object|boolean>} Edited message or success
   */
  async editMenu(channelId, messageId, text, buttons, options = {}) {
    if (text) {
      return await this.editMessage(channelId, messageId, text, {
        ...options,
        buttons
      });
    } else {
      // Edit only the keyboard
      const replyMarkup = convertButtonsToTelegramKeyboard(buttons);
      try {
        await this.bot.editMessageReplyMarkup(replyMarkup, {
          chat_id: channelId,
          message_id: messageId
        });
        return true;
      } catch (error) {
        this.logger.error(`[TelegramAdapter] Error editing menu: ${error.message}`);
        return false;
      }
    }
  }

  /**
   * Answer a callback query
   * @param {string} interactionId - Callback query ID
   * @param {Object} options - Response options
   * @returns {Promise<boolean>} Success status
   */
  async answerCallback(interactionId, options = {}) {
    try {
      const telegramOptions = {};
      
      if (options.text) {
        telegramOptions.text = options.text;
      }
      
      if (options.showAlert) {
        telegramOptions.show_alert = true;
      }

      await this.bot.answerCallbackQuery(interactionId, telegramOptions);
      return true;
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error answering callback: ${error.message}`);
      return false;
    }
  }

  /**
   * Set a reaction on a message
   * @param {string} channelId - Telegram chat ID
   * @param {string} messageId - Message ID
   * @param {string} emoji - Emoji to react with
   * @returns {Promise<boolean>} Success status
   */
  async setReaction(channelId, messageId, emoji) {
    try {
      await setReaction(this.bot, channelId, messageId, emoji);
      return true;
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error setting reaction: ${error.message}`);
      return false;
    }
  }

  /**
   * Get file URL from file ID
   * @param {string} fileId - Telegram file ID
   * @returns {Promise<string|null>} File URL or null
   */
  async getFileUrl(fileId) {
    return await getTelegramFileUrl(this.bot, { document: { file_id: fileId } });
  }

  /**
   * Get chat information
   * @param {string} channelId - Telegram chat ID
   * @returns {Promise<ChatInfo>} Chat information
   */
  async getChatInfo(channelId) {
    try {
      const chat = await this.bot.getChat(channelId);
      return {
        id: chat.id.toString(),
        type: chat.type, // 'private', 'group', 'supergroup', 'channel'
        title: chat.title,
        username: chat.username
      };
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error getting chat info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get chat member information
   * @param {string} channelId - Telegram chat ID
   * @param {string} userId - User ID
   * @returns {Promise<MemberInfo>} Member information
   */
  async getChatMember(channelId, userId) {
    try {
      const member = await this.bot.getChatMember(channelId, userId);
      return {
        userId: member.user.id.toString(),
        username: member.user.username,
        displayName: member.user.first_name,
        isAdmin: member.status === 'administrator' || member.status === 'creator',
        permissions: { status: member.status }
      };
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error getting chat member: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if user is admin
   * @param {string} channelId - Telegram chat ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if admin
   */
  async isAdmin(channelId, userId) {
    try {
      const admins = await this.bot.getChatAdministrators(channelId);
      return admins.some(admin => admin.user.id.toString() === userId.toString());
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error checking admin status: ${error.message}`);
      return false;
    }
  }

  /**
   * Register bot commands
   * @param {Array<CommandDefinition>} commands - Commands to register
   * @param {Object} options - Registration options
   * @returns {Promise<boolean>} Success status
   */
  async registerCommands(commands, options = {}) {
    try {
      const telegramCommands = commands.map(cmd => ({
        command: cmd.name,
        description: cmd.description
      }));

      const scope = options.scope || { type: 'default' };
      await this.bot.setMyCommands(telegramCommands, { scope });
      return true;
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error registering commands: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete bot commands
   * @param {Object} options - Deletion options
   * @returns {Promise<boolean>} Success status
   */
  async deleteCommands(options = {}) {
    try {
      const scope = options.scope || { type: 'default' };
      await this.bot.deleteMyCommands({ scope });
      return true;
    } catch (error) {
      this.logger.error(`[TelegramAdapter] Error deleting commands: ${error.message}`);
      return false;
    }
  }

  /**
   * Get the Telegram bot instance
   * @returns {Object} Telegram bot instance
   */
  getClient() {
    return this.bot;
  }
}

module.exports = TelegramAdapter;

