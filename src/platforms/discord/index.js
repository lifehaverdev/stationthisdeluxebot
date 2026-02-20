/**
 * Discord Platform
 * 
 * Entry point for initializing the Discord platform adapter.
 * Connects the bot to core services and starts the bot.
 */

const createDiscordBot = require('./bot');
const { CommandRegistry } = require('./dynamicCommands');

/**
 * Initialize the Discord platform
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized bot instance
 */
function initializeDiscordPlatform(services, options = {}) {
  const {
    comfyUI, // Services object uses comfyUI (not comfyuiService)
    comfyuiService, // Also check for comfyuiService (backward compatibility)
    pointsService,
    session, // Services object uses session (not sessionService)
    sessionService, // Also check for sessionService (backward compatibility)
    userSettingsService, // This is what dynamicCommands.js actually needs
    workflows, // Services object uses workflows (not workflowsService)
    workflowsService, // Also check for workflowsService (backward compatibility)
    mediaService,
    openaiService, // For dynamic commands
    loraResolutionService, // For dynamic commands
    internal, // Internal API services
    toolRegistry, // Tool registry for dynamic commands and settings
    // commandRegistry removed - we create our own platform-specific instance
    logger = console
  } = services;
  
  // Create a platform-specific CommandRegistry for Discord
  // This prevents conflicts with Telegram's command registry
  const discordCommandRegistry = new CommandRegistry(logger);
  
  const token = process.env.DISCORD_TOKEN || options.token;
  
  if (!token) {
    throw new Error('Discord bot token is required. Set DISCORD_TOKEN environment variable.');
  }
  
  // Initialize the bot with all required services
  // Use the actual service names from the services object
  const bot = createDiscordBot(
    {
      comfyuiService: comfyuiService || comfyUI, // Use comfyuiService if available, fallback to comfyUI
      pointsService,
      sessionService: sessionService || session, // Use sessionService if available, fallback to session
      userSettingsService: userSettingsService || sessionService || session, // For dynamic commands
      workflowsService: workflowsService || workflows, // Use workflowsService if available, fallback to workflows
      mediaService,
      openaiService, // Pass for dynamic commands
      loraResolutionService, // Pass for dynamic commands
      internal, // Pass internal API services
      toolRegistry, // Pass tool registry
      commandRegistry: discordCommandRegistry, // Pass platform-specific command registry
      logger
    },
    token,
    options
  );
  
  logger.debug('Discord platform initialized');
  
  // Return bot object with client for notifier registration
  // bot is already an object with { client, bot } from createDiscordBot
  return bot;
}

module.exports = { initializeDiscordPlatform }; 