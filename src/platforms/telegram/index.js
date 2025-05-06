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
      logger
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
        // Get workflows from the ComfyUI service instead
        const workflows = await services.comfyui.getWorkflows();
        
        // Setup dynamic commands with the workflows
        await setupDynamicCommands(bot, workflows);
        
        console.log('Telegram bot dynamic commands configured');
      } catch (error) {
        console.error('Failed to setup dynamic commands:', error);
      }
    }
  };
}

module.exports = {
  initializeTelegramPlatform
}; 