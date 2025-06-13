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
      this.logger.warn(`[MessageReplyDispatcher] Overwriting handler for context type: ${contextType}`);
    }
    this.logger.info(`[MessageReplyDispatcher] Registering handler for context type: ${contextType}`);
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
}

class CommandDispatcher {
    /**
     * @param {object} bot - The Telegram bot instance.
     * @param {object} logger - The logger instance.
     */
    constructor(bot, logger) {
        this.bot = bot;
        this.logger = logger;
    }

    /**
     * Registers a text command handler.
     * @param {RegExp} regex - The regex to match for the command.
     * @param {Function} handler - The function to execute. The handler will receive the message and the regex match result.
     */
    register(regex, handler) {
        this.logger.info(`[CommandDispatcher] Registering command handler for regex: ${regex}`);
        this.bot.onText(regex, handler);
    }
}


module.exports = {
  CallbackQueryDispatcher,
  MessageReplyDispatcher,
  CommandDispatcher,
}; 