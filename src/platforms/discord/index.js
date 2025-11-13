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
    internal, // Internal API services
    toolRegistry, // Tool registry for dynamic commands and settings
    commandRegistry, // Command registry for dynamic commands
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
      internal, // Pass internal API services
      toolRegistry, // Pass tool registry
      commandRegistry, // Pass command registry
      logger
    },
    token,
    options
  );
  
  logger.info('Discord platform initialized');
  
  return bot;
}

module.exports = { initializeDiscordPlatform }; 