/**
 * Platform Adapter Base Class
 * 
 * Abstract interface that all platform adapters must implement.
 * Provides a common API for platform-agnostic operations.
 * 
 * @abstract
 */
class PlatformAdapter {
  /**
   * @param {Object} options - Adapter configuration
   * @param {Object} options.logger - Logger instance
   * @param {string} options.platform - Platform identifier ('telegram' | 'discord')
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.platform = options.platform || 'unknown';
    
    if (this.constructor === PlatformAdapter) {
      throw new Error('PlatformAdapter is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Send a text message to a channel/chat
   * @param {string} channelId - Channel/chat ID
   * @param {string} text - Message text
   * @param {SendMessageOptions} [options] - Message options
   * @returns {Promise<Object>} Sent message object
   * @abstract
   */
  async sendMessage(channelId, text, options = {}) {
    throw new Error('sendMessage must be implemented by platform adapter');
  }

  /**
   * Edit an existing message's text
   * @param {string} channelId - Channel/chat ID
   * @param {string} messageId - Message ID to edit
   * @param {string} text - New message text
   * @param {SendMessageOptions} [options] - Edit options
   * @returns {Promise<Object|boolean>} Edited message or success boolean
   * @abstract
   */
  async editMessage(channelId, messageId, text, options = {}) {
    throw new Error('editMessage must be implemented by platform adapter');
  }

  /**
   * Delete a message
   * @param {string} channelId - Channel/chat ID
   * @param {string} messageId - Message ID to delete
   * @returns {Promise<boolean>} Success status
   * @abstract
   */
  async deleteMessage(channelId, messageId) {
    throw new Error('deleteMessage must be implemented by platform adapter');
  }

  /**
   * Send a photo/image
   * @param {string} channelId - Channel/chat ID
   * @param {Buffer|string} photo - Photo buffer or file ID/URL
   * @param {MediaOptions} [options] - Media options
   * @returns {Promise<Object>} Sent message object
   * @abstract
   */
  async sendPhoto(channelId, photo, options = {}) {
    throw new Error('sendPhoto must be implemented by platform adapter');
  }

  /**
   * Send a video
   * @param {string} channelId - Channel/chat ID
   * @param {Buffer|string} video - Video buffer or file ID/URL
   * @param {MediaOptions} [options] - Media options
   * @returns {Promise<Object>} Sent message object
   * @abstract
   */
  async sendVideo(channelId, video, options = {}) {
    throw new Error('sendVideo must be implemented by platform adapter');
  }

  /**
   * Send a document/file
   * @param {string} channelId - Channel/chat ID
   * @param {Buffer|string} document - Document buffer or file ID/URL
   * @param {MediaOptions} [options] - Media options
   * @returns {Promise<Object>} Sent message object
   * @abstract
   */
  async sendDocument(channelId, document, options = {}) {
    throw new Error('sendDocument must be implemented by platform adapter');
  }

  /**
   * Send a menu/interactive message with buttons
   * @param {string} channelId - Channel/chat ID
   * @param {string} text - Menu text
   * @param {Array<Array<ButtonDefinition>>} buttons - Button layout (rows of buttons)
   * @param {SendMessageOptions} [options] - Additional options
   * @returns {Promise<Object>} Sent message object
   * @abstract
   */
  async sendMenu(channelId, text, buttons, options = {}) {
    throw new Error('sendMenu must be implemented by platform adapter');
  }

  /**
   * Edit a message's menu/buttons
   * @param {string} channelId - Channel/chat ID
   * @param {string} messageId - Message ID to edit
   * @param {string} [text] - Optional new text (if provided)
   * @param {Array<Array<ButtonDefinition>>} [buttons] - New button layout
   * @param {SendMessageOptions} [options] - Additional options
   * @returns {Promise<Object|boolean>} Edited message or success boolean
   * @abstract
   */
  async editMenu(channelId, messageId, text, buttons, options = {}) {
    throw new Error('editMenu must be implemented by platform adapter');
  }

  /**
   * Answer a callback query/interaction
   * @param {string} interactionId - Interaction/callback ID
   * @param {Object} [options] - Response options
   * @param {string} [options.text] - Response text
   * @param {boolean} [options.showAlert] - Show as alert (Telegram) or ephemeral (Discord)
   * @returns {Promise<boolean>} Success status
   * @abstract
   */
  async answerCallback(interactionId, options = {}) {
    throw new Error('answerCallback must be implemented by platform adapter');
  }

  /**
   * Set a reaction on a message
   * @param {string} channelId - Channel/chat ID
   * @param {string} messageId - Message ID
   * @param {string} emoji - Emoji to react with
   * @returns {Promise<boolean>} Success status
   * @abstract
   */
  async setReaction(channelId, messageId, emoji) {
    throw new Error('setReaction must be implemented by platform adapter');
  }

  /**
   * Get file URL from file ID
   * @param {string} fileId - Platform-specific file ID
   * @returns {Promise<string|null>} File URL or null if unavailable
   * @abstract
   */
  async getFileUrl(fileId) {
    throw new Error('getFileUrl must be implemented by platform adapter');
  }

  /**
   * Get information about a chat/channel
   * @param {string} channelId - Channel/chat ID
   * @returns {Promise<ChatInfo>} Chat information
   * @abstract
   */
  async getChatInfo(channelId) {
    throw new Error('getChatInfo must be implemented by platform adapter');
  }

  /**
   * Get information about a chat member/user
   * @param {string} channelId - Channel/chat ID
   * @param {string} userId - User ID
   * @returns {Promise<MemberInfo>} Member information
   * @abstract
   */
  async getChatMember(channelId, userId) {
    throw new Error('getChatMember must be implemented by platform adapter');
  }

  /**
   * Check if a user is an administrator
   * @param {string} channelId - Channel/chat ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if user is admin
   * @abstract
   */
  async isAdmin(channelId, userId) {
    throw new Error('isAdmin must be implemented by platform adapter');
  }

  /**
   * Register bot commands
   * @param {Array<CommandDefinition>} commands - Commands to register
   * @param {Object} [options] - Registration options
   * @param {string} [options.scope] - Command scope ('global' | 'guild')
   * @returns {Promise<boolean>} Success status
   * @abstract
   */
  async registerCommands(commands, options = {}) {
    throw new Error('registerCommands must be implemented by platform adapter');
  }

  /**
   * Delete bot commands
   * @param {Object} [options] - Deletion options
   * @param {string} [options.scope] - Scope to delete from
   * @returns {Promise<boolean>} Success status
   * @abstract
   */
  async deleteCommands(options = {}) {
    throw new Error('deleteCommands must be implemented by platform adapter');
  }

  /**
   * Get the platform identifier
   * @returns {Platform} Platform name
   */
  getPlatform() {
    return this.platform;
  }

  /**
   * Get the underlying platform client/bot instance
   * (For advanced use cases that need platform-specific features)
   * @returns {Object} Platform-specific client instance
   * @abstract
   */
  getClient() {
    throw new Error('getClient must be implemented by platform adapter');
  }
}

module.exports = PlatformAdapter;

