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
 * @param {Object} dependencies - The canonical dependencies object.
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized platform adapters
 */
function initializePlatforms(dependencies, options = {}) {
  const platforms = {};
  const logger = dependencies.logger || console;
  
  // Debug log for internal services
  const internalStatus = dependencies.internal ? 'exists' : 'missing';
  const statusServiceStatus = dependencies.internal?.status ? 'status service exists' : 'status service missing';
  logger.info(`DEBUG: Platforms - Internal services: ${internalStatus}, ${statusServiceStatus}`);
  
  // Initialize platforms based on configuration
  if (options.enableTelegram !== false) {
    try {
      platforms.telegram = initializeTelegramPlatform(dependencies, options.telegram);
      logger.info('Telegram platform successfully initialized');
    } catch (error) {
      logger.error('Failed to initialize Telegram platform:', error);
    }
  }
  
  // Initialize Discord platform if enabled
  if (options.enableDiscord) {
    try {
      platforms.discord = initializeDiscordPlatform(dependencies, options.discord);
      logger.info('Discord platform successfully initialized');
    } catch (error) {
      logger.error('Failed to initialize Discord platform:', error);
    }
  }
  
  // Initialize Web platform if enabled
  if (options.enableWeb) {
    try {
      platforms.web = initializeWebPlatform(dependencies, options.web);
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