/**
 * Application Bootstrap
 * 
 * This module initializes all new systems and integrates them
 * with the legacy code. Include this in app.js to activate
 * the new architecture components.
 */

const { initializeTelegramIntegration } = require('./integrations/telegram');
const featureFlags = require('./config/featureFlags');
const { initializeAllServices } = require('./services/initializer');

// Import references to legacy global objects
let bot, commandRegistry;
try {
  const legacyBot = require('../utils/bot/bot');
  bot = legacyBot.getBotInstance && legacyBot.getBotInstance();
  commandRegistry = legacyBot.commandRegistry;
} catch (error) {
  console.warn('Failed to import legacy bot references:', error.message);
}

/**
 * Initialize all new system components
 * 
 * @param {Object} options - Initialization options
 * @param {Object} options.bot - Telegram bot instance
 * @param {Object} options.commandRegistry - Command registry
 * @returns {Object} References to initialized components
 */
function bootstrap(options = {}) {
  // Use provided references or fallback to globally imported ones
  const botInstance = options.bot || bot;
  const cmdRegistry = options.commandRegistry || commandRegistry;
  
  console.log('Bootstrapping new architecture components...');
  
  // Log feature flags
  console.log('Feature flags:', featureFlags.getAllFlags());
  
  // Skip features that can't be initialized due to missing dependencies
  const missingDependencies = {};
  
  if (featureFlags.isEnabled('useNewAccountPoints') && !options.workflowManager) {
    console.warn('⚠️ [BOOTSTRAP] Workflow manager missing, disabling account points workflow');
    missingDependencies.accountPoints = true;
  }
  
  if (featureFlags.isEnabled('useNewAccountPoints') && !options.sessionManager) {
    console.warn('⚠️ [BOOTSTRAP] Session manager missing, disabling account points workflow');
    missingDependencies.accountPoints = true;
  }
  
  if (featureFlags.isEnabled('useNewAccountPoints') && !options.accountPointsService) {
    console.warn('⚠️ [BOOTSTRAP] Account points service missing, disabling account points workflow');
    missingDependencies.accountPoints = true;
  }
  
  // Initialize services if enabled
  let services = {};
  if (featureFlags.isEnabled('useServices')) {
    console.log('🌟 Initializing services...');
    try {
      services = initializeAllServices({
        comfyDeploy: {
          workflowRefreshInterval: options.workflowRefreshInterval || 3600000, // 1 hour
          config: {
            apiKey: process.env.COMFY_DEPLOY_API_KEY,
            baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
            webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL
          }
        }
      });
      console.log(`  ✓ Services initialized - found ${services.registry.getServiceNames().length} services`);
    } catch (error) {
      console.error('  ❌ Error initializing services:', error);
      console.warn('    Continuing bootstrap without services');
    }
  }
  
  // Initialize Telegram integration with dependency-aware flags
  const telegramOptions = {
    bot: botInstance,
    commandRegistry: cmdRegistry,
    sessionManager: options.sessionManager || null,
    workflowManager: options.workflowManager || null,
    accountPointsService: options.accountPointsService || null,
    logger: options.logger || console,
    // Override flags based on available dependencies
    featureOverrides: {
      useNewAccountPoints: featureFlags.isEnabled('useNewAccountPoints') && !missingDependencies.accountPoints,
      useNewAccountCommands: featureFlags.isEnabled('useNewAccountCommands') && !missingDependencies.accountPoints,
      useServices: featureFlags.isEnabled('useServices')
    }
  };
  
  try {
    initializeTelegramIntegration(telegramOptions);
    
    // Mark commands as initialized on the bot instance to avoid duplication
    if (botInstance && featureFlags.isEnabled('useNewAccountCommands')) {
      botInstance.initedAccountCommands = true;
    }
    
    console.log('Bootstrap complete. New architecture components are ready.');
  } catch (error) {
    console.error('❌ Error initializing Telegram integration:', error);
    console.log('Bootstrap failed. New architecture components may not be available.');
  }
  
  // Return references
  return {
    featureFlags,
    services
  };
}

// If this file is required directly, attempt to bootstrap
// Disabled for now to avoid conflicts with stationthisbot.js
/*
if (require.main !== module && bot && commandRegistry) {
  console.log('Auto-bootstrapping new architecture components...');
  bootstrap();
}
*/

module.exports = {
  bootstrap,
  featureFlags
}; 