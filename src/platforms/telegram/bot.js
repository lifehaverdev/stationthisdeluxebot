/**
 * Telegram Platform Adapter
 * 
 * Main entry point for the Telegram bot implementation.
 * This file sets up the bot, initializes the dispatchers, and registers all feature handlers.
 *
 * Canonical Dependency Injection Pattern:
 * - All handlers and managers receive the full `dependencies` object.
 * - All internal API calls must use `dependencies.services.internal.client`.
 * - There should be no top-level `internalApiClient` in dependencies.
 */

const TelegramBot = require('node-telegram-bot-api');

// --- Refactored Imports ---
const { CallbackQueryDispatcher, MessageReplyDispatcher, CommandDispatcher, DynamicCommandDispatcher } = require('./dispatcher');
const replyContextManager = require('./utils/replyContextManager.js');
const { ensureCleanKeyboard } = require('./utils/keyboardContextManager');

// Import all feature managers
const settingsMenuManager = require('./components/settingsMenuManager');
const modsMenuManager = require('./components/modsMenuManager');
const spellMenuManager = require('./components/spellMenuManager');
const trainingMenuManager = require('./components/trainingMenuManager');
const collectionMenuManager = require('./components/collectionMenuManager');
const adminManager = require('./components/adminManager');
const dashboardMenuManager = require('./components/dashboardMenuManager');
const walletManager = require('./components/walletManager');
const buyPointsManager = require('./components/buyPointsManager');
const toolsMenuManager = require('./components/toolsMenuManager');
// Delivery Menu Managers
const globalMenuManager = require('./components/deliveryMenu/globalMenuManager');
const infoManager = require('./components/deliveryMenu/infoManager');
const rateManager = require('./components/deliveryMenu/rateManager');
const rerunManager = require('./components/deliveryMenu/rerunManager');
const tweakManager = require('./components/deliveryMenu/tweakManager');
// Simple Command Handlers
const createStatusCommandHandler = require('./commands/statusCommand');

/**
 * Create and configure the Telegram bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Telegram bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createTelegramBot(dependencies, token, options = {}) {
  const { logger = console, commandRegistry } = dependencies;

  const bot = new TelegramBot(token, {
    polling: options.polling !== false,
    ...options
  });

  // Track bot startup time to filter old messages
  const botStartupTime = Date.now();
  const MESSAGE_AGE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

  // --- Initialize Dispatchers ---
  const callbackQueryDispatcher = new CallbackQueryDispatcher(logger);
  const messageReplyDispatcher = new MessageReplyDispatcher(logger);
  const commandDispatcher = new CommandDispatcher(logger);
  const dynamicCommandDispatcher = new DynamicCommandDispatcher(commandRegistry, logger);

  // --- Register All Handlers ---
  function registerAllHandlers() {
    const dispatcherInstances = { callbackQueryDispatcher, messageReplyDispatcher, commandDispatcher, dynamicCommandDispatcher };
    const allDependencies = { ...dependencies, bot, replyContextManager };

    const { disabledFeatures = {} } = dependencies;

    // Register component managers conditionally based on feature toggles
    settingsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    modsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    toolsMenuManager.registerHandlers(dispatcherInstances, allDependencies);

    if (!disabledFeatures.spells) {
      spellMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    }
    if (!disabledFeatures.train) {
      trainingMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    }

    collectionMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    adminManager.registerHandlers(dispatcherInstances, allDependencies);
    dashboardMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    walletManager.registerHandlers(dispatcherInstances, allDependencies);
    buyPointsManager.registerHandlers(dispatcherInstances, allDependencies);

    // Register delivery menu managers
    globalMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    infoManager.registerHandlers(dispatcherInstances, allDependencies);
    rateManager.registerHandlers(dispatcherInstances, allDependencies);
    rerunManager.registerHandlers(dispatcherInstances, allDependencies);
    tweakManager.registerHandlers(dispatcherInstances, allDependencies);

    // Register simple, stateless command handlers
    const handleStatusCommand = createStatusCommandHandler(allDependencies);
    commandDispatcher.register(/^\/status(?:@\w+)?/i, handleStatusCommand);

    logger.info('[Bot] All feature handlers registered with dispatchers.');
  }

  registerAllHandlers();

  const canonicalCommands = [
    { command: 'account', description: 'Manage your account' },
    { command: 'status', description: 'View your status' },
    { command: 'settings', description: 'Configure preferences' },
    { command: 'tools', description: 'Utilities & extras' }
  ];
  bot.setMyCommands(canonicalCommands, { scope: { type: 'all_private_chats' } }).catch(console.error);

  // --- Refactored Event Handlers ---

  bot.on('callback_query', async (callbackQuery) => {
    try {
      await callbackQueryDispatcher.handle(bot, callbackQuery, { ...dependencies, replyContextManager });
    } catch (error) {
      logger.error(`Unhandled error in callback_query dispatcher: ${error.stack}`);
      if (!callbackQuery.answered) {
        try { await bot.answerCallbackQuery(callbackQuery.id, { text: "Sorry, a critical error occurred.", show_alert: true }); }
        catch (e) { logger.error("[Bot CB] Critical: Failed to answer callback query in error path:", e.stack); }
      }
    }
  });

  bot.on('photo', async (message) => {
    try {
      if (!message.caption) return;

      // Filter out old messages (older than 2 minutes from bot startup)
      const messageTime = message.date * 1000; // Convert Telegram timestamp to milliseconds
      const messageAge = Date.now() - messageTime;
      
      if (messageAge > MESSAGE_AGE_LIMIT_MS) {
        logger.debug(`[Bot] Ignoring old photo message (age: ${Math.round(messageAge / 1000)}s, limit: ${MESSAGE_AGE_LIMIT_MS / 1000}s)`);
        return;
      }

      const fullDependencies = { ...dependencies, replyContextManager };

      // CLEAN KEYBOARD FOR PHOTOS
      await ensureCleanKeyboard(bot, message, fullDependencies);

      // Check for replies with a specific context first
      if (message.reply_to_message) {
        const context = replyContextManager.getContext(message.reply_to_message);
        if (context) {
            const handled = await messageReplyDispatcher.handle(bot, message, context, fullDependencies);
            if (handled) {
                replyContextManager.removeContext(message.reply_to_message);
                return;
            }
        }
      }

      // Check for explicit commands (e.g. /status)
      if (message.caption.startsWith('/')) {
        const handled = await commandDispatcher.handle(bot, message, fullDependencies);
        if (handled) return;
      }

      // If no other handler has returned, treat as a potential dynamic command
      const dynamicHandled = await dynamicCommandDispatcher.handle(bot, message, fullDependencies);
      if (dynamicHandled) return;

    } catch (error) {
        logger.error(`[Bot] Error processing message: ${error.stack}`);
        await bot.sendMessage(message.chat.id, "Sorry, an unexpected error occurred.", { reply_to_message_id: message.message_id });
    }
  });

  bot.on('message', async (message) => {
    try {
      if (!message.text) return;

      // Filter out old messages (older than 2 minutes from bot startup)
      const messageTime = message.date * 1000; // Convert Telegram timestamp to milliseconds
      const messageAge = Date.now() - messageTime;
      
      if (messageAge > MESSAGE_AGE_LIMIT_MS) {
        logger.debug(`[Bot] Ignoring old message (age: ${Math.round(messageAge / 1000)}s, limit: ${MESSAGE_AGE_LIMIT_MS / 1000}s)`);
        return;
      }

      const fullDependencies = { ...dependencies, replyContextManager };

      // CLEAN KEYBOARD FOR TEXT MESSAGES
      await ensureCleanKeyboard(bot, message, fullDependencies);

      // Check for replies with a specific context first
      if (message.reply_to_message) {
        const context = replyContextManager.getContext(message.reply_to_message);
        if (context) {
            const handled = await messageReplyDispatcher.handle(bot, message, context, fullDependencies);
            if (handled) {
                replyContextManager.removeContext(message.reply_to_message);
                return;
            }
        }
      }

      // Check for explicit commands (e.g. /status)
      if (message.text.startsWith('/')) {
        const handled = await commandDispatcher.handle(bot, message, fullDependencies);
        if (handled) return;
      }

      // If no other handler has returned, treat as a potential dynamic command
      const dynamicHandled = await dynamicCommandDispatcher.handle(bot, message, fullDependencies);
      if (dynamicHandled) return;

    } catch (error) {
        logger.error(`[Bot] Error processing message: ${error.stack}`);
        await bot.sendMessage(message.chat.id, "Sorry, an unexpected error occurred.", { reply_to_message_id: message.message_id });
    }
  });

  bot.on('polling_error', (error) => logger.error('Telegram polling error:', error));

  logger.info('Telegram bot configured and ready with dispatcher architecture.');
  
  return bot;
}

module.exports = createTelegramBot;