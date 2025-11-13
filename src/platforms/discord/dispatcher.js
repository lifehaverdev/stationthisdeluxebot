/**
 * @file src/platforms/discord/dispatcher.js
 * @description Provides dispatcher classes for routing Discord interactions.
 *
 * This file implements the Dispatcher/Router pattern similar to Telegram's dispatcher.
 * It allows feature managers to register their own handlers for specific
 * interaction types (button clicks, select menus, slash commands), decoupling them from the
 * main bot.js logic.
 */

/**
 * Dispatcher for Discord button interactions (equivalent to Telegram callback queries)
 */
class ButtonInteractionDispatcher {
  /**
   * @param {object} logger - The logger instance.
   */
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Registers a handler for a specific button interaction prefix.
   * @param {string} prefix - The prefix to match (e.g., 'settings:').
   * @param {Function} handler - The function to execute when the prefix matches.
   */
  register(prefix, handler) {
    if (this.handlers.has(prefix)) {
      this.logger.warn(`[ButtonInteractionDispatcher] Overwriting handler for prefix: ${prefix}`);
    }
    this.logger.info(`[ButtonInteractionDispatcher] Registering handler for prefix: ${prefix}`);
    this.handlers.set(prefix, handler);
  }

  /**
   * Finds the appropriate handler for the given button customId.
   * @param {string} customId - The `customId` from the button interaction.
   * @returns {Function|null} The matched handler function or null if no match is found.
   */
  findHandler(customId) {
    if (!customId) {
      return null;
    }
    let matchedHandler = null;
    let longestMatchLength = -1;
    for (const [prefix, handler] of this.handlers.entries()) {
      if (customId.startsWith(prefix) && prefix.length > longestMatchLength) {
        longestMatchLength = prefix.length;
        matchedHandler = handler;
      }
    }
    return matchedHandler;
  }

  /**
   * Handle a button interaction
   * @param {object} client - Discord client instance
   * @param {object} interaction - Discord button interaction
   * @param {object} dependencies - Dependencies object
   * @returns {Promise<boolean>} True if handled, false otherwise
   */
  async handle(client, interaction, dependencies) {
    const { customId, user } = interaction;
    const matchedHandler = this.findHandler(customId);
    
    if (!matchedHandler) {
      this.logger.warn(`[ButtonInteractionDispatcher] No handler found for customId: ${customId}`);
      return false;
    }

    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
      throw new Error('[ButtonInteractionDispatcher] internalApiClient dependency missing');
    }

    // Find or create user to get masterAccountId
    const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
      platform: 'discord',
      platformId: user.id.toString(),
      platformContext: {
        username: user.username,
        discriminator: user.discriminator,
        globalName: user.globalName
      }
    });
    const masterAccountId = findOrCreateResponse.data.masterAccountId;

    await matchedHandler(client, interaction, masterAccountId, dependencies);
    return true;
  }
}

/**
 * Dispatcher for Discord select menu interactions
 */
class SelectMenuInteractionDispatcher {
  /**
   * @param {object} logger - The logger instance.
   */
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Registers a handler for a specific select menu prefix.
   * @param {string} prefix - The prefix to match (e.g., 'settings:').
   * @param {Function} handler - The function to execute when the prefix matches.
   */
  register(prefix, handler) {
    if (this.handlers.has(prefix)) {
      this.logger.warn(`[SelectMenuInteractionDispatcher] Overwriting handler for prefix: ${prefix}`);
    }
    this.logger.info(`[SelectMenuInteractionDispatcher] Registering handler for prefix: ${prefix}`);
    this.handlers.set(prefix, handler);
  }

  /**
   * Finds the appropriate handler for the given select menu customId.
   * @param {string} customId - The `customId` from the select menu interaction.
   * @returns {Function|null} The matched handler function or null if no match is found.
   */
  findHandler(customId) {
    if (!customId) {
      return null;
    }
    let matchedHandler = null;
    let longestMatchLength = -1;
    for (const [prefix, handler] of this.handlers.entries()) {
      if (customId.startsWith(prefix) && prefix.length > longestMatchLength) {
        longestMatchLength = prefix.length;
        matchedHandler = handler;
      }
    }
    return matchedHandler;
  }

  /**
   * Handle a select menu interaction
   * @param {object} client - Discord client instance
   * @param {object} interaction - Discord select menu interaction
   * @param {object} dependencies - Dependencies object
   * @returns {Promise<boolean>} True if handled, false otherwise
   */
  async handle(client, interaction, dependencies) {
    const { customId, user } = interaction;
    const matchedHandler = this.findHandler(customId);
    
    if (!matchedHandler) {
      this.logger.warn(`[SelectMenuInteractionDispatcher] No handler found for customId: ${customId}`);
      return false;
    }

    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
      throw new Error('[SelectMenuInteractionDispatcher] internalApiClient dependency missing');
    }

    // Find or create user to get masterAccountId
    const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
      platform: 'discord',
      platformId: user.id.toString(),
      platformContext: {
        username: user.username,
        discriminator: user.discriminator,
        globalName: user.globalName
      }
    });
    const masterAccountId = findOrCreateResponse.data.masterAccountId;

    await matchedHandler(client, interaction, masterAccountId, dependencies);
    return true;
  }
}

/**
 * Dispatcher for Discord slash commands
 */
class CommandDispatcher {
  /**
   * @param {object} logger - The logger instance.
   */
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Registers a slash command handler.
   * @param {string} commandName - The command name (e.g., 'status').
   * @param {Function} handler - The function to execute.
   */
  register(commandName, handler) {
    if (this.handlers.has(commandName)) {
      this.logger.warn(`[CommandDispatcher] Overwriting handler for command: ${commandName}`);
    }
    this.logger.info(`[CommandDispatcher] Registering command handler for: ${commandName}`);
    this.handlers.set(commandName, handler);
  }

  /**
   * Handle a slash command interaction
   * @param {object} client - Discord client instance
   * @param {object} interaction - Discord command interaction
   * @param {object} dependencies - Dependencies object
   * @returns {Promise<boolean>} True if handled, false otherwise
   */
  async handle(client, interaction, dependencies) {
    const { commandName } = interaction;
    const handler = this.handlers.get(commandName);
    
    if (!handler) {
      this.logger.warn(`[CommandDispatcher] No handler found for command: ${commandName}`);
      return false;
    }

    await handler(client, interaction, dependencies);
    return true;
  }
}

/**
 * Dispatcher for dynamic commands (from ToolRegistry)
 */
class DynamicCommandDispatcher {
  /**
   * @param {object} commandRegistry - Command registry instance
   * @param {object} logger - The logger instance.
   */
  constructor(commandRegistry, logger) {
    this.commandRegistry = commandRegistry;
    this.logger = logger || console;
  }

  /**
   * Handle a dynamic command (tool-based command)
   * @param {object} client - Discord client instance
   * @param {object} interaction - Discord command interaction
   * @param {object} dependencies - Dependencies object
   * @returns {Promise<boolean>} True if handled, false otherwise
   */
  async handle(client, interaction, dependencies) {
    if (!this.commandRegistry) {
      this.logger.warn('[DynamicCommandDispatcher] CommandRegistry is not available. Skipping.');
      return false;
    }

    const commandName = interaction.commandName;
    const result = this.commandRegistry.findHandler(commandName);

    if (result) {
      const { handler } = result;
      this.logger.info(`[DynamicCommandDispatcher] Found and executing dynamic command handler for: ${commandName}`);
      try {
        await handler(client, interaction, dependencies);
        return true;
      } catch (error) {
        this.logger.error('[DynamicCommandDispatcher] Error executing dynamic command handler:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "Sorry, an error occurred while processing that command.", ephemeral: true });
        } else {
          await interaction.reply({ content: "Sorry, an error occurred while processing that command.", ephemeral: true });
        }
        return true;
      }
    }
    
    return false;
  }
}

/**
 * Dispatcher for Discord message replies (for handling context-based replies)
 */
class MessageReplyDispatcher {
  /**
   * @param {object} logger - The logger instance.
   */
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Registers a handler for a specific reply context type.
   * @param {string} contextType - The context type to match (e.g., 'settings_param_edit').
   * @param {Function} handler - The function to execute when the context type matches.
   */
  register(contextType, handler) {
    if (this.handlers.has(contextType)) {
      this.logger.warn(`[MessageReplyDispatcher] Overwriting handler for context type: ${contextType}`);
    }
    this.logger.info(`[MessageReplyDispatcher] Registering handler for context type: ${contextType}`);
    this.handlers.set(contextType, handler);
  }

  /**
   * Handle a message reply with context
   * @param {object} client - Discord client instance
   * @param {object} message - Discord message object
   * @param {object} context - The context object stored for this reply
   * @param {object} dependencies - Dependencies object
   * @returns {Promise<boolean>} True if handled, false otherwise
   */
  async handle(client, message, context, dependencies) {
    const { type } = context;
    const handler = this.handlers.get(type);
    
    if (!handler) {
      this.logger.warn(`[MessageReplyDispatcher] No handler found for context type: ${type}`);
      return false;
    }

    try {
      await handler(client, message, context, dependencies);
      return true;
    } catch (error) {
      this.logger.error(`[MessageReplyDispatcher] Error in handler for context type ${type}:`, error);
      return false;
    }
  }
}

module.exports = {
  ButtonInteractionDispatcher,
  SelectMenuInteractionDispatcher,
  CommandDispatcher,
  DynamicCommandDispatcher,
  MessageReplyDispatcher,
};

