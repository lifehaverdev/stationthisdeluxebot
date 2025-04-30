/**
 * Telegram Platform
 * 
 * Entry point for initializing the Telegram platform adapter.
 * Connects the bot to core services and starts the bot.
 */

const createTelegramBot = require('./bot');

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
      logger
    },
    token,
    options
  );
  
  logger.info('Telegram platform initialized');
  
  return bot;
}

module.exports = {
  initializeTelegramPlatform
}; 