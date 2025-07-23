/**
 * @file src/platforms/telegram/dispatcher.js
 * @description Provides dispatcher classes for routing Telegram events.
 *
 * This file implements the Dispatcher/Router pattern outlined in ADR-012.
 * It allows feature managers to register their own handlers for specific
 * event types (callback queries, message replies), decoupling them from the
 * main bot.js logic.
 */

class CallbackQueryDispatcher {
  /**
   * @param {object} logger - The logger instance.
   */
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Registers a handler for a specific callback query prefix.
   * @param {string} prefix - The prefix to match (e.g., 'lora:').
   * @param {Function} handler - The function to execute when the prefix matches.
   */
  register(prefix, handler) {
    if (this.handlers.has(prefix)) {
      this.logger.warn(`[CallbackQueryDispatcher] Overwriting handler for prefix: ${prefix}`);
    }
    this.logger.info(`[CallbackQueryDispatcher] Registering handler for prefix: ${prefix}`);
    this.handlers.set(prefix, handler);
  }

  /**
   * Finds the appropriate handler for the given callback query data.
   * @param {string} data - The `data` from the callback query.
   * @returns {Function|null} The matched handler function or null if no match is found.
   */
  findHandler(data) {
    if (!data) {
      return null;
    }
    for (const [prefix, handler] of this.handlers.entries()) {
      if (data.startsWith(prefix)) {
        return handler;
      }
    }
    return null;
  }

  async handle(bot, callbackQuery, dependencies) {
    const { data, from } = callbackQuery;
    for (const [prefix, handler] of this.handlers.entries()) {
      if (data.startsWith(prefix)) {
        const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
        if (!apiClient) {
          throw new Error('[CallbackQueryDispatcher] internalApiClient dependency missing');
        }
        const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
          platform: 'telegram',
          platformId: from.id.toString(),
          platformContext: { firstName: from.first_name, username: from.username }
        });
        const masterAccountId = findOrCreateResponse.data.masterAccountId;
        await handler(bot, callbackQuery, masterAccountId, dependencies);
        return true;
      }
    }
    this.logger.warn(`[CallbackQueryDispatcher] No handler found for callback data: ${data}`);
    return false;
  }
}

class MessageReplyDispatcher {
  /**
   * @param {object} logger - The logger instance.
   */
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Registers a handler for a specific message reply context type.
   * @param {string} contextType - The context type to match (e.g., 'lora_import_url').
   * @param {Function} handler - The function to execute for this context type.
   */
  register(contextType, handler) {
    if (this.handlers.has(contextType)) {
      this.logger.warn(`[MessageReplyDispatcher] Overwriting handler for context: ${contextType}`);
    }
    this.logger.info(`[MessageReplyDispatcher] Registering handler for context: ${contextType}`);
    this.handlers.set(contextType, handler);
  }

  /**
   * Gets the handler for the given context type.
   * @param {string} contextType - The type of the reply context.
   * @returns {Function|null} The handler function or null if not found.
   */
  getHandler(contextType) {
    return this.handlers.get(contextType) || null;
  }

  async handle(bot, message, context, dependencies) {
    const handler = this.handlers.get(context.type);
    if (handler) {
      await handler(bot, message, context, dependencies);
      return true;
    }
    this.logger.warn(`[MessageReplyDispatcher] No handler found for context type: ${context.type}`);
    return false;
  }
}

class CommandDispatcher {
    /**
     * @param {object} logger - The logger instance.
     */
    constructor(logger) {
        this.logger = logger;
        this.handlers = new Map();
    }

    /**
     * Registers a text command handler.
     * @param {RegExp} regex - The regex to match for the command.
     * @param {Function} handler - The function to execute.
     */
    register(regex, handler) {
        if (this.handlers.has(regex)) this.logger.warn(`[CommandDispatcher] Overwriting handler for regex: ${regex}`);
        this.logger.info(`[CommandDispatcher] Registering command handler for regex: ${regex}`);
        this.handlers.set(regex, handler);
    }

    async handle(bot, message, dependencies) {
        for (const [regex, handler] of this.handlers.entries()) {
            const match = message.text.match(regex);
            if (match) {
                // Pass the bot, message, and the stored dependencies to the handler.
                await handler(bot, message, dependencies, match);
                return true;
            }
        }
        return false;
    }
}

class DynamicCommandDispatcher {
    constructor(commandRegistry, logger) {
        this.commandRegistry = commandRegistry;
        this.logger = logger || console;
    }

    async handle(bot, message, dependencies) {
        if (!this.commandRegistry) {
            this.logger.warn('[DynamicCommandDispatcher] CommandRegistry is not available. Skipping.');
            return false;
        }

        const result = this.commandRegistry.findHandler(message.text || message.caption);

        if (result) {
            const { handler, match } = result;
            this.logger.info(`[DynamicCommandDispatcher] Found and executing dynamic command handler.`);
            try {
                await handler(bot, message, dependencies, match);
                return true;
            } catch (error) {
                this.logger.error('[DynamicCommandDispatcher] Error executing dynamic command handler:', error);
                await bot.sendMessage(message.chat.id, "Sorry, an error occurred while processing that command.", { reply_to_message_id: message.message_id });
                return true;
            }
        }
        
        return false;
    }
}

module.exports = {
  CallbackQueryDispatcher,
  MessageReplyDispatcher,
  CommandDispatcher,
  DynamicCommandDispatcher,
}; 