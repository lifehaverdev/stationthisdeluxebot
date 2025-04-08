/**
 * Application Bootstrap
 * 
 * This module initializes all new systems and integrates them
 * with the legacy code. Include this in app.js to activate
 * the new architecture components.
 */

const telegramIntegration = require('./integrations/telegram');
const featureFlags = require('./config/featureFlags');

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
  
  // Initialize Telegram integration
  const telegram = telegramIntegration.initialize({
    bot: botInstance,
    commandRegistry: cmdRegistry
  });
  
  console.log('Bootstrap complete. New architecture components are ready.');
  
  // Return references to initialized components
  return {
    sessionManager: telegram.sessionManager,
    featureFlags
  };
}

// If this file is required directly, attempt to bootstrap
if (require.main !== module && bot && commandRegistry) {
  console.log('Auto-bootstrapping new architecture components...');
  bootstrap();
}

module.exports = {
  bootstrap,
  featureFlags
}; 