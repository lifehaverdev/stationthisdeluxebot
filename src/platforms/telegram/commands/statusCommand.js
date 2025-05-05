/**
 * Status Command Handler for Telegram
 * 
 * Handles the /status command which displays application runtime information.
 * Uses the internal status API for consistent information across platforms.
 */

/**
 * Create status command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createStatusCommandHandler(dependencies) {
  const { 
    bot,
    services,
    logger = console
  } = dependencies;
  
  /**
   * Handle the status command
   * @param {Object} message - Telegram message
   * @returns {Promise<void>}
   */
  return async function handleStatusCommand(message) {
    try {
      // Debug log to verify internal services
      logger.info('DEBUG: Status command (Telegram) - Internal services:',
        services ? 'services exist' : 'services missing',
        services?.internal ? 'internal exists' : 'internal missing',
        services?.internal?.status ? 'status service exists' : 'status service missing');
      
      // Get status information from internal API
      const statusInfo = services.internal.status.getStatus();
      
      await bot.sendMessage(
        message.chat.id,
        `🟢 StationThis Bot Status\n\n` +
        `🕒 Uptime: ${statusInfo.uptime.formatted}\n` +
        `🚀 Started: ${statusInfo.startTime.replace('T', ' ').slice(0, 19)}\n` +
        `📊 Version: ${statusInfo.version}`,
        { reply_to_message_id: message.message_id }
      );
    } catch (error) {
      logger.error('Error in status command:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while fetching application status.',
        { reply_to_message_id: message.message_id }
      );
    }
  };
}

module.exports = createStatusCommandHandler; 