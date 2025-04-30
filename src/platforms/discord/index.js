/**
 * Discord Platform
 * 
 * Entry point for initializing the Discord platform adapter.
 * Connects the bot to core services and starts the bot.
 */

const createDiscordBot = require('./bot');

/**
 * Initialize the Discord platform
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized bot instance
 */
function initializeDiscordPlatform(services, options = {}) {
  const {
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    logger = console
  } = services;
  
  const token = process.env.DISCORD_TOKEN || options.token;
  
  if (!token) {
    throw new Error('Discord bot token is required. Set DISCORD_TOKEN environment variable.');
  }
  
  // Initialize the bot with all required services
  const bot = createDiscordBot(
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
  
  logger.info('Discord platform initialized');
  
  return bot;
}

module.exports = { initializeDiscordPlatform }; 