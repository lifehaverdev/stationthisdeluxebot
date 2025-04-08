/**
 * Telegram Integration
 * 
 * This module centralizes all Telegram-specific integrations
 * and provides a clean interface for the main application
 */

const { integrateStatusCommand } = require('./statusCommandIntegration');
const { SessionManager } = require('../../services/sessionManager');

// Initialize SessionManager and expose it globally
// so other components can use it
const sessionManager = global.sessionManager = new SessionManager();

/**
 * Initialize all Telegram integrations
 * 
 * @param {Object} options - Initialization options
 * @param {Object} options.bot - Telegram bot instance
 * @param {Object} options.commandRegistry - Command registry object
 * @returns {Object} References to created adapters and services
 */
function initialize(options = {}) {
  const { bot, commandRegistry } = options;
  
  if (!bot) {
    throw new Error('Telegram bot instance is required');
  }
  
  if (!commandRegistry) {
    throw new Error('Command registry is required');
  }
  
  console.log('Initializing Telegram integrations...');
  
  // Integrate status command
  integrateStatusCommand(commandRegistry);
  
  // Add more command integrations here
  
  return {
    sessionManager
  };
}

module.exports = {
  initialize,
  sessionManager
}; 