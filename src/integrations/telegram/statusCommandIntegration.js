/**
 * Status Command Integration
 * 
 * This module connects our new status command implementation
 * with the legacy Telegram bot
 */

// Import feature flags system
const featureFlags = require('../../config/featureFlags');

// Import our adapter
const telegramAdapter = require('./adapters/commandAdapter');

// Core dependencies from the legacy system required for integration
const { sendMessage } = require('../../../utils/bot/utils');

/**
 * Replacement handler for the /status command
 * 
 * @param {Object} message - Telegram message object
 * @returns {Promise<void>}
 */
async function handleStatus(message) {
  console.log(`Handling /status command for user ${message.from.id}`);
  
  try {
    if (featureFlags.isEnabled('useNewSessionManager')) {
      console.log('Using new SessionManager for status command');
      
      // Execute the command through our adapter
      const response = await telegramAdapter.executeCommand('status', message);
      
      // Send the response using the legacy mechanism
      await sendMessage(message, response.text, response.options);
      
      console.log('Status command successfully handled with new implementation');
    } else {
      console.log('Using legacy implementation for status command');
      
      // Import and call the legacy handler directly
      // Note: We do this inside the function to avoid circular dependencies
      const { handleStatus: legacyHandler } = require('../../../utils/bot/handlers/iWork');
      await legacyHandler(message);
    }
  } catch (error) {
    console.error('Error handling status command:', error);
    await sendMessage(message, '❌ An error occurred while retrieving status information');
  }
}

/**
 * Integrates the new status command with the legacy command registry
 * 
 * @param {Object} commandRegistry - The legacy command registry
 */
function integrateStatusCommand(commandRegistry) {
  // Replace the /status command handler with our new implementation
  commandRegistry['/status'] = {
    handler: handleStatus,
    description: 'Show bot status and session information'
  };
  
  console.log('Status command integrated with new implementation');
}

module.exports = {
  handleStatus,
  integrateStatusCommand
}; 