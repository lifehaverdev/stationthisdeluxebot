/**
 * Telegram Platform
 * 
 * Entry point for initializing the Telegram platform adapter.
 * Connects the bot to core services and starts the bot.
 */

const createTelegramBot = require('./bot');
const { setupDynamicCommands } = require('./dynamicCommands');
const WorkflowCacheManager = require('../../core/services/comfydeploy/workflowCacheManager');

// Feature toggles for Telegram commands/menus. Toggle to true to disable a feature.
const DISABLED_FEATURES = {
  train: true,   // Disables the /train command & training menu
  cook: true,    // Disables the /cook dynamic command
  spells: true   // Disables the /spells menu
};

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
  const bot = createTelegramBot({ ...dependencies, disabledFeatures: DISABLED_FEATURES }, token, { polling: true, ...options });
  
  logger.info('Telegram platform initialized');
  
  // Return an object with the bot and a setup function for dynamic commands
  return {
    bot,
    async setupCommands() {
      try {
        // Ensure WorkflowCacheManager has fully initialized (populating ToolRegistry) before registering commands.
        const cacheManager = WorkflowCacheManager.getInstance();
        const timeoutMs = 30000; // 30-second safety cap

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`WorkflowCacheManager initialization timed out after ${timeoutMs}ms`)), timeoutMs)
        );

        let initialized = false;
        try {
          await Promise.race([cacheManager.initialize(), timeoutPromise]);
          initialized = true;
        } catch (initErr) {
          logger.warn(`[Telegram] WorkflowCacheManager did not fully initialize: ${initErr.message}`);
        }

        // Poll ToolRegistry for readiness (non-zero tools) up to same timeout
        const start = Date.now();
        const registry = dependencies.toolRegistry;
        while ((registry?.getAllTools()?.length || 0) === 0 && Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, 200));
        }

        logger.info(`[Telegram] ToolRegistry ready? ${initialized}. Tools count: ${registry?.getAllTools()?.length || 0}.`);

        // Pass the commandRegistry instance from dependencies to the setup function.
        // It will return a list of commands to be registered with the Telegram API.
        const commandsToRegister = await setupDynamicCommands(dependencies.commandRegistry, { ...dependencies, disabledFeatures: DISABLED_FEATURES });
        
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