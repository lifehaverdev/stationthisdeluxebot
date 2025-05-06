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
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized bot instance
 */
function initializeTelegramPlatform(services, options = {}) {
  const {
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    internal,
    logger = console
  } = services;
  
  const token = process.env.TELEGRAM_TOKEN || options.token;
  
  if (!token) {
    throw new Error('Telegram bot token is required. Set TELEGRAM_TOKEN environment variable.');
  }
  
  // Initialize the bot with all required services
  const bot = createTelegramBot(
    {
      comfyuiService,
      pointsService,
      sessionService,
      workflowsService,
      mediaService,
      internal,
      logger,
      appStartTime: services.appStartTime
    },
    token,
    { polling: true, ...options } // Enable polling by default
  );
  
  logger.info('Telegram platform initialized');
  
  // Return an object with the bot and a setup function for dynamic commands
  return {
    bot,
    async setupCommands() {
      try {
        // Pass the 'services' object directly.
        // setupDynamicCommands will use services.workflows.getWorkflows() internally.
        await setupDynamicCommands(bot, services);
        
        // Use logger for consistency if available, otherwise console.log
        const logger = services.logger || console;
        logger.info('Telegram bot dynamic commands configured (via setupCommands method).');
      } catch (error) {
        const logger = services.logger || console;
        logger.error('Failed to setup dynamic commands (via setupCommands method):', error);
      }
    }
  };
}

module.exports = {
  initializeTelegramPlatform
}; 