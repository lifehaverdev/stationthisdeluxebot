/**
 * Discord Platform Adapter
 * 
 * Implements the PlatformAdapter interface using discord.js.
 * Maps platform-agnostic operations to Discord-specific APIs.
 */

const PlatformAdapter = require('../common/PlatformAdapter');
const { 
  AttachmentBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  REST,
  Routes
} = require('discord.js');

/**
 * Convert platform-agnostic buttons to Discord message components
 * @param {Array<Array<ButtonDefinition>>} buttons - Button layout
 * @returns {Array<ActionRowBuilder>} Discord action rows
 */
function convertButtonsToDiscordComponents(buttons) {
  if (!buttons || buttons.length === 0) {
    return [];
  }

  // Discord limit: 5 action rows, 5 buttons per row
  const maxRows = 5;
  const maxButtonsPerRow = 5;
  
  const rows = [];
  for (let i = 0; i < Math.min(buttons.length, maxRows); i++) {
    const row = buttons[i];
    const actionRow = new ActionRowBuilder();
    
    for (let j = 0; j < Math.min(row.length, maxButtonsPerRow); j++) {
      const button = row[j];
      const discordButton = new ButtonBuilder()
        .setLabel(button.text)
        .setCustomId(button.action);

      // Set button style
      if (button.style) {
        const styleMap = {
          'primary': ButtonStyle.Primary,
          'secondary': ButtonStyle.Secondary,
          'success': ButtonStyle.Success,
          'danger': ButtonStyle.Danger,
          'link': ButtonStyle.Link
        };
        discordButton.setStyle(styleMap[button.style] || ButtonStyle.Primary);
      } else {
        discordButton.setStyle(ButtonStyle.Primary);
      }

      // Handle URL buttons
      if (button.url) {
        discordButton.setStyle(ButtonStyle.Link).setURL(button.url);
        // Note: URL buttons don't use custom_id
        discordButton.setCustomId(null);
      }

      actionRow.addComponents(discordButton);
    }
    
    rows.push(actionRow);
  }

  return rows;
}

/**
 * Convert platform-agnostic parse mode to Discord markdown
 * Note: Discord uses standard markdown, not MarkdownV2
 * @param {string} parseMode - Platform-agnostic parse mode
 * @returns {boolean} Whether to parse markdown (Discord always parses markdown)
 */
function shouldParseMarkdown(parseMode) {
  // Discord always parses markdown, but we can control it via content format
  return parseMode !== 'none';
}

/**
 * Convert Telegram MarkdownV2 to Discord markdown
 * @param {string} text - Text in MarkdownV2 format
 * @returns {string} Text in Discord markdown format
 */
function convertMarkdownV2ToDiscord(text) {
  // Basic conversion - Telegram MarkdownV2 uses *bold* and _italic_
  // Discord uses **bold** and *italic*
  return text
    .replace(/\*([^*]+)\*/g, '**$1**') // Bold: *text* -> **text**
    .replace(/_([^_]+)_/g, '*$1*');    // Italic: _text_ -> *text*
}

class DiscordAdapter extends PlatformAdapter {
  /**
   * @param {Object} client - Discord client instance (discord.js Client)
   * @param {Object} options - Adapter options
   * @param {Object} options.logger - Logger instance
   * @param {string} [options.token] - Discord bot token (for REST API operations)
   */
  constructor(client, options = {}) {
    super({ ...options, platform: 'discord' });
    
    if (!client) {
      throw new Error('Discord client instance is required');
    }
    
    this.client = client;
    this.token = options.token || process.env.DISCORD_TOKEN;
    
    // Store pending interactions for deferred responses
    this.pendingInteractions = new Map();
  }

  /**
   * Get a channel by ID
   * @private
   * @param {string} channelId - Channel ID
   * @returns {Promise<TextChannel>} Discord channel
   */
  async _getChannel(channelId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) {
        throw new Error(`Channel ${channelId} not found`);
      }
      if (!channel.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel`);
      }
      return channel;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error fetching channel: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a message by ID
   * @private
   * @param {string} channelId - Channel ID
   * @param {string} messageId - Message ID
   * @returns {Promise<Message>} Discord message
   */
  async _getMessage(channelId, messageId) {
    try {
      const channel = await this._getChannel(channelId);
      const message = await channel.messages.fetch(messageId);
      return message;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error fetching message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a text message
   * @param {string} channelId - Discord channel ID
   * @param {string} text - Message text
   * @param {SendMessageOptions} options - Message options
   * @returns {Promise<Object>} Sent message
   */
  async sendMessage(channelId, text, options = {}) {
    try {
      const channel = await this._getChannel(channelId);
      
      const messageOptions = {
        content: text
      };

      // Handle reply
      if (options.replyToMessageId) {
        messageOptions.reply = {
          messageReference: options.replyToMessageId,
          failIfNotExists: false
        };
      }

      // Handle buttons
      if (options.buttons && options.buttons.length > 0) {
        messageOptions.components = convertButtonsToDiscordComponents(options.buttons);
      }

      // Handle ephemeral (Discord-specific)
      if (options.ephemeral) {
        // Ephemeral is only valid for interaction replies, not regular messages
        // We'll log a warning but continue
        this.logger.warn('[DiscordAdapter] ephemeral option ignored for sendMessage (only valid for interactions)');
      }

      // Merge platform-specific options
      if (options.platformSpecific) {
        Object.assign(messageOptions, options.platformSpecific);
      }

      const message = await channel.send(messageOptions);
      
      // Return in a format similar to Telegram message
      return {
        message_id: message.id,
        chat: { id: channelId },
        text: message.content,
        date: Math.floor(message.createdTimestamp / 1000)
      };
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error sending message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Edit a message's text
   * @param {string} channelId - Discord channel ID
   * @param {string} messageId - Message ID
   * @param {string} text - New text
   * @param {SendMessageOptions} options - Edit options
   * @returns {Promise<Object|boolean>} Edited message or success
   */
  async editMessage(channelId, messageId, text, options = {}) {
    try {
      const message = await this._getMessage(channelId, messageId);
      
      const editOptions = {
        content: text
      };

      // Handle buttons update
      if (options.buttons !== undefined) {
        editOptions.components = convertButtonsToDiscordComponents(options.buttons);
      }

      if (options.platformSpecific) {
        Object.assign(editOptions, options.platformSpecific);
      }

      const editedMessage = await message.edit(editOptions);
      
      return {
        message_id: editedMessage.id,
        chat: { id: channelId },
        text: editedMessage.content
      };
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error editing message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a message
   * @param {string} channelId - Discord channel ID
   * @param {string} messageId - Message ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteMessage(channelId, messageId) {
    try {
      const message = await this._getMessage(channelId, messageId);
      await message.delete();
      return true;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error deleting message: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a photo
   * @param {string} channelId - Discord channel ID
   * @param {Buffer|string} photo - Photo buffer or URL
   * @param {MediaOptions} options - Media options
   * @returns {Promise<Object>} Sent message
   */
  async sendPhoto(channelId, photo, options = {}) {
    try {
      const channel = await this._getChannel(channelId);
      
      const attachment = photo instanceof Buffer
        ? new AttachmentBuilder(photo, { name: options.filename || 'image.png' })
        : photo; // If it's a URL, Discord can handle it directly

      const messageOptions = {
        files: [attachment]
      };

      if (options.caption) {
        messageOptions.content = options.caption;
      }

      if (options.replyToMessageId) {
        messageOptions.reply = {
          messageReference: options.replyToMessageId,
          failIfNotExists: false
        };
      }

      if (options.buttons && options.buttons.length > 0) {
        messageOptions.components = convertButtonsToDiscordComponents(options.buttons);
      }

      if (options.platformSpecific) {
        Object.assign(messageOptions, options.platformSpecific);
      }

      const message = await channel.send(messageOptions);
      
      return {
        message_id: message.id,
        chat: { id: channelId },
        date: Math.floor(message.createdTimestamp / 1000)
      };
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error sending photo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a video
   * @param {string} channelId - Discord channel ID
   * @param {Buffer|string} video - Video buffer or URL
   * @param {MediaOptions} options - Media options
   * @returns {Promise<Object>} Sent message
   */
  async sendVideo(channelId, video, options = {}) {
    // Discord handles video the same as any file
    return await this.sendPhoto(channelId, video, {
      ...options,
      filename: options.filename || 'video.mp4'
    });
  }

  /**
   * Send a document
   * @param {string} channelId - Discord channel ID
   * @param {Buffer|string} document - Document buffer or URL
   * @param {MediaOptions} options - Media options
   * @returns {Promise<Object>} Sent message
   */
  async sendDocument(channelId, document, options = {}) {
    // Discord handles documents the same as any file
    return await this.sendPhoto(channelId, document, {
      ...options,
      filename: options.filename || 'document.pdf'
    });
  }

  /**
   * Send a menu with buttons
   * @param {string} channelId - Discord channel ID
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
   * @param {string} channelId - Discord channel ID
   * @param {string} messageId - Message ID
   * @param {string} text - Optional new text
   * @param {Array<Array<ButtonDefinition>>} buttons - New button layout
   * @param {SendMessageOptions} options - Additional options
   * @returns {Promise<Object|boolean>} Edited message or success
   */
  async editMenu(channelId, messageId, text, buttons, options = {}) {
    const editOptions = {
      ...options,
      buttons: buttons || []
    };

    if (text) {
      editOptions.content = text;
    }

    return await this.editMessage(channelId, messageId, text || '', editOptions);
  }

  /**
   * Answer a callback query/interaction
   * Note: Discord interactions must be answered within 3 seconds
   * @param {string} interactionId - Interaction ID
   * @param {Object} options - Response options
   * @returns {Promise<boolean>} Success status
   */
  async answerCallback(interactionId, options = {}) {
    try {
      // Get the interaction from pending interactions or fetch it
      let interaction = this.pendingInteractions.get(interactionId);
      
      if (!interaction) {
        this.logger.warn(`[DiscordAdapter] Interaction ${interactionId} not found in pending interactions`);
        return false;
      }

      const responseOptions = {};

      if (options.text) {
        responseOptions.content = options.text;
      }

      if (options.showAlert || options.ephemeral) {
        responseOptions.ephemeral = true;
      }

      // Check if already replied
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(responseOptions);
      } else {
        await interaction.reply(responseOptions);
      }

      // Remove from pending
      this.pendingInteractions.delete(interactionId);
      
      return true;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error answering callback: ${error.message}`);
      return false;
    }
  }

  /**
   * Store an interaction for later response
   * This is needed because Discord interactions must be responded to within 3 seconds
   * @param {string} interactionId - Interaction ID
   * @param {Interaction} interaction - Discord interaction object
   */
  storeInteraction(interactionId, interaction) {
    this.pendingInteractions.set(interactionId, interaction);
    
    // Auto-cleanup after 3 minutes (Discord interactions expire after 15 minutes)
    setTimeout(() => {
      this.pendingInteractions.delete(interactionId);
    }, 3 * 60 * 1000);
  }

  /**
   * Set a reaction on a message
   * @param {string} channelId - Discord channel ID
   * @param {string} messageId - Message ID
   * @param {string} emoji - Emoji to react with
   * @returns {Promise<boolean>} Success status
   */
  async setReaction(channelId, messageId, emoji) {
    try {
      const message = await this._getMessage(channelId, messageId);
      await message.react(emoji);
      return true;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error setting reaction: ${error.message}`);
      return false;
    }
  }

  /**
   * Get file URL from attachment
   * Discord attachments have direct URLs, no API call needed
   * @param {string} fileId - This is actually an attachment URL or message ID + attachment index
   * @returns {Promise<string|null>} File URL
   */
  async getFileUrl(fileId) {
    // In Discord, fileId might be a URL directly, or we need to fetch from message
    // For now, if it's already a URL, return it
    if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
      return fileId;
    }
    
    // Otherwise, we'd need to fetch the message and get attachment URL
    // This is a simplified implementation
    this.logger.warn(`[DiscordAdapter] getFileUrl called with non-URL fileId: ${fileId}`);
    return null;
  }

  /**
   * Get channel/guild information
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<ChatInfo>} Chat information
   */
  async getChatInfo(channelId) {
    try {
      const channel = await this._getChannel(channelId);
      const guild = channel.guild;
      
      return {
        id: channelId,
        type: guild ? 'guild' : 'private',
        title: guild ? guild.name : channel.name,
        username: null // Discord channels don't have usernames
      };
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error getting chat info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get member information
   * @param {string} channelId - Discord channel ID
   * @param {string} userId - User ID
   * @returns {Promise<MemberInfo>} Member information
   */
  async getChatMember(channelId, userId) {
    try {
      const channel = await this._getChannel(channelId);
      const guild = channel.guild;
      
      if (!guild) {
        // DM channel - return basic user info
        const user = await this.client.users.fetch(userId);
        return {
          userId: userId,
          username: user.username,
          displayName: user.displayName || user.username,
          isAdmin: false,
          permissions: {}
        };
      }

      const member = await guild.members.fetch(userId);
      const isAdmin = member.permissions.has('Administrator') || 
                     member.permissions.has('ManageGuild');
      
      return {
        userId: userId,
        username: member.user.username,
        displayName: member.displayName || member.user.username,
        isAdmin: isAdmin,
        permissions: {
          has: (perm) => member.permissions.has(perm)
        }
      };
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error getting chat member: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if user is admin
   * @param {string} channelId - Discord channel ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if admin
   */
  async isAdmin(channelId, userId) {
    try {
      const memberInfo = await this.getChatMember(channelId, userId);
      return memberInfo.isAdmin;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error checking admin status: ${error.message}`);
      return false;
    }
  }

  /**
   * Register bot commands (slash commands)
   * @param {Array<CommandDefinition>} commands - Commands to register
   * @param {Object} options - Registration options
   * @returns {Promise<boolean>} Success status
   */
  async registerCommands(commands, options = {}) {
    try {
      if (!this.token) {
        throw new Error('Discord token required for command registration');
      }

      const rest = new REST({ version: '10' }).setToken(this.token);
      const clientId = this.client.user?.id;

      if (!clientId) {
        throw new Error('Client not ready. Wait for client to be ready before registering commands.');
      }

      // Convert platform-agnostic commands to Discord format
      const discordCommands = commands.map(cmd => {
        const discordCmd = {
          name: cmd.name,
          description: cmd.description || 'No description',
          type: 1 // CHAT_INPUT
        };

        if (cmd.options && cmd.options.length > 0) {
          // Map option types
          const typeMap = {
            'string': 3,
            'integer': 4,
            'boolean': 5,
            'user': 6,
            'channel': 7,
            'role': 8
          };

          discordCmd.options = cmd.options.map(opt => ({
            name: opt.name,
            description: opt.description || 'No description',
            type: typeMap[opt.type] || 3,
            required: opt.required || false,
            choices: opt.choices
          }));
        }

        return discordCmd;
      });

      const route = options.scope === 'guild' && options.guildId
        ? Routes.applicationGuildCommands(clientId, options.guildId)
        : Routes.applicationCommands(clientId);

      await rest.put(route, { body: discordCommands });
      
      this.logger.info(`[DiscordAdapter] Registered ${discordCommands.length} commands`);
      return true;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error registering commands: ${error.message}`);
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
      if (!this.token) {
        throw new Error('Discord token required for command deletion');
      }

      const rest = new REST({ version: '10' }).setToken(this.token);
      const clientId = this.client.user?.id;

      if (!clientId) {
        throw new Error('Client not ready');
      }

      const route = options.scope === 'guild' && options.guildId
        ? Routes.applicationGuildCommands(clientId, options.guildId)
        : Routes.applicationCommands(clientId);

      await rest.put(route, { body: [] });
      
      this.logger.info('[DiscordAdapter] Deleted all commands');
      return true;
    } catch (error) {
      this.logger.error(`[DiscordAdapter] Error deleting commands: ${error.message}`);
      return false;
    }
  }

  /**
   * Get the Discord client instance
   * @returns {Object} Discord client instance
   */
  getClient() {
    return this.client;
  }
}

module.exports = DiscordAdapter;

