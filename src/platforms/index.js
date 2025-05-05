/**
 * Platforms Layer
 * 
 * Entry point for initializing all platform adapters.
 * Connects platform-specific adapters to platform-agnostic workflows.
 */

const { initializeTelegramPlatform } = require('./telegram');
const { initializeDiscordPlatform } = require('./discord');
const { initializeWebPlatform } = require('./web');

/**
 * Initialize all platform adapters
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized platform adapters
 */
function initializePlatforms(services, options = {}) {
  const platforms = {};
  const logger = services.logger || console;
  
  // Debug log for internal services
  logger.info('DEBUG: Platforms - Internal services:', 
    services.internal ? 'exists' : 'missing',
    services.internal?.status ? 'status service exists' : 'status service missing');
  
  // Initialize platforms based on configuration
  if (options.enableTelegram !== false) {
    try {
      platforms.telegram = initializeTelegramPlatform(services, options.telegram);
      logger.info('Telegram platform successfully initialized');
    } catch (error) {
      logger.error('Failed to initialize Telegram platform:', error);
    }
  }
  
  // Initialize Discord platform if enabled
  if (options.enableDiscord) {
    try {
      platforms.discord = initializeDiscordPlatform(services, options.discord);
      logger.info('Discord platform successfully initialized');
    } catch (error) {
      logger.error('Failed to initialize Discord platform:', error);
    }
  }
  
  // Initialize Web platform if enabled
  if (options.enableWeb) {
    try {
      platforms.web = initializeWebPlatform(services, options.web);
      logger.info('Web platform successfully initialized');
    } catch (error) {
      logger.error('Failed to initialize Web platform:', error);
    }
  }
  
  return platforms;
}

module.exports = {
  initializePlatforms
}; 