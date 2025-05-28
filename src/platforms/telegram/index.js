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
  // const initialLoggerForDepCheck = services.logger || console; // Use logger from services if available
  // initialLoggerForDepCheck.info('[Telegram Index] initializeTelegramPlatform called. Inspecting INCOMING services object:');
  // initialLoggerForDepCheck.info(`[Telegram Index] Keys in incoming services: ${JSON.stringify(Object.keys(services))}`);
  // initialLoggerForDepCheck.info(`[Telegram Index] typeof services.comfyui: ${typeof services.comfyui}`);
  // initialLoggerForDepCheck.info(`[Telegram Index] typeof services.comfyui?.submitRequest: ${typeof services.comfyui?.submitRequest}`);
  // initialLoggerForDepCheck.info(`[Telegram Index] typeof services.workflows: ${typeof services.workflows}`);
  // initialLoggerForDepCheck.info(`[Telegram Index] typeof services.workflows?.getToolById: ${typeof services.workflows?.getToolById}`);

  const {
    comfyui: comfyuiService,         // Renamed for local clarity
    points: pointsService,           // Renamed for local clarity
    session: sessionService,         // Renamed for local clarity
    workflows: actualWorkflowsInstance, // Get the instance from services.workflows
    media: mediaService,             // Renamed for local clarity
    internal,
    db,
    logger = console,
    appStartTime,
    toolRegistry,
    userSettingsService
  } = services;
  
  const token = process.env.TELEGRAM_TOKEN || options.token;
  
  if (!token) {
    throw new Error('Telegram bot token is required. Set TELEGRAM_TOKEN environment variable.');
  }
  
  const botDeps = {
    comfyuiService,      // This is services.comfyui
    pointsService,       // This is services.points
    sessionService,      // This is services.session
    workflowsService: actualWorkflowsInstance, // Assign the instance to the key createTelegramBot expects
    mediaService,        // This is services.media
    internal,
    db,
    logger,
    appStartTime,
    toolRegistry,
    userSettingsService
  };
  
  // initialLoggerForDepCheck.info(`[Telegram Index] typeof botDeps.workflowsService?.getToolById: ${typeof botDeps.workflowsService?.getToolById}`);

  // Initialize the bot with all required services
  const bot = createTelegramBot(botDeps, token, { polling: true, ...options });
  
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