/**
 * Telegram Platform
 * 
 * Entry point for initializing the Telegram platform adapter.
 * Connects the bot to core services and starts the bot.
 */

const createTelegramBot = require('./bot');
const { setupDynamicCommands } = require('./dynamicCommands');

/**
 * Initialize the Telegram platform
 * @param {Object} dependencies - The canonical dependencies object.
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized bot instance and command setup utility.
 */
function initializeTelegramPlatform(dependencies, options = {}) {
  const { logger = console } = dependencies;

  const token = process.env.TELEGRAM_TOKEN || options.token;
  
  if (!token) {
    logger.error('Telegram bot token is required. Set TELEGRAM_TOKEN environment variable.');
    throw new Error('Telegram bot token is required. Set TELEGRAM_TOKEN environment variable.');
  }
  
  // Initialize the bot with the canonical dependencies object
  const bot = createTelegramBot(dependencies, token, { polling: true, ...options });
  
  logger.info('Telegram platform initialized');
  
  // Return an object with the bot and a setup function for dynamic commands
  return {
    bot,
    async setupCommands() {
      try {
        // Pass the commandRegistry instance from dependencies to the setup function.
        // It will return a list of commands to be registered with the Telegram API.
        const commandsToRegister = await setupDynamicCommands(dependencies.commandRegistry, dependencies);
        
        if (commandsToRegister && commandsToRegister.length > 0) {
            await bot.setMyCommands(commandsToRegister);
            logger.info(`Telegram bot dynamic commands configured: ${commandsToRegister.length} commands registered.`);
        } else {
            logger.info('No dynamic commands were registered.');
        }

      } catch (error) {
        logger.error('Failed to setup dynamic commands (via setupCommands method):', error);
      }
    }
  };
}

module.exports = {
  initializeTelegramPlatform
}; 