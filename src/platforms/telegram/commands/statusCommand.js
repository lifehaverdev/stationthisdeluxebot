/**
 * Status Command Handler for Telegram
 * 
 * Handles the /status command which displays application runtime information.
 * Uses the internal status API for consistent information across platforms.
 */

const internalApiClient = require('../utils/internalApiClient'); // Import the new API client

/**
 * Create status command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createStatusCommandHandler(dependencies) {
  const { 
    bot,
    services, // Keep services for non-Noema service calls like internal.status
    logger = console
  } = dependencies;
  
  /**
   * Handle the status command
   * @param {Object} message - Telegram message
   * @returns {Promise<void>}
   */
  return async function handleStatusCommand(message) {
    const telegramUserId = message.from.id;
    let masterAccountId;
    let sessionId;
    const platformIdStr = telegramUserId.toString();
    const platform = 'telegram';

    try {
      // 1. Get masterAccountId via Internal API
      logger.debug(`[statusCommand] Getting masterAccountId for platformId: ${platformIdStr}...`);
      const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
        platform: platform,
        platformId: platformIdStr,
        platformContext: { // Optional: Pass some context if needed by the API
          firstName: message.from.first_name,
          username: message.from.username
        }
      });
      
      masterAccountId = findOrCreateResponse.data.masterAccountId;
      const isNewUser = findOrCreateResponse.data.isNewUser;
      logger.info(`[statusCommand] Got masterAccountId: ${masterAccountId}. New user: ${isNewUser}`);

      // 2. Find or Create Session via Internal API
      logger.debug(`[statusCommand] Checking for active session for masterAccountId: ${masterAccountId}...`);
      const activeSessionsResponse = await internalApiClient.get(`/users/${masterAccountId}/sessions/active?platform=${platform}`);
      
      if (activeSessionsResponse.data && activeSessionsResponse.data.length > 0) {
        sessionId = activeSessionsResponse.data[0]._id; // Use the first active session
        logger.debug(`[statusCommand] Found active session: ${sessionId}`);
        if (activeSessionsResponse.data.length > 1) {
            logger.warn(`[statusCommand] Multiple active Telegram sessions found for masterAccountId: ${masterAccountId}. Using session: ${sessionId}`);
        }
      } else {
        logger.debug(`[statusCommand] No active session found. Creating new session for masterAccountId: ${masterAccountId}...`);
        const newSessionResponse = await internalApiClient.post('/sessions', {
          masterAccountId: masterAccountId,
          platform: platform,
          userAgent: 'Telegram Bot Command' // Example user agent
        });
        sessionId = newSessionResponse.data._id;
        logger.info(`[statusCommand] New session created: ${sessionId} for masterAccountId: ${masterAccountId}`);
        
        // Log session_started event via Internal API
        try {
          logger.debug(`[statusCommand] Logging session_started event for sessionId: ${sessionId}...`);
          await internalApiClient.post('/events', {
            masterAccountId: masterAccountId,
            sessionId: sessionId,
            eventType: 'session_started',
            sourcePlatform: platform,
            eventData: { 
              platform: platform,
              startMethod: 'command_interaction'
            }
          });
          logger.info(`[statusCommand] session_started event logged for sessionId: ${sessionId}`);
        } catch (eventError) {
          // Log the error but don't block the status command
          logger.error(`[statusCommand] Failed to log session_started event via API for sessionId: ${sessionId}. API Error: ${eventError.message}`);
        }
      }

      // 3. Update Last Activity via Internal API
      if (sessionId) {
        logger.debug(`[statusCommand] Updating activity for session: ${sessionId}...`);
        try {
          await internalApiClient.put(`/sessions/${sessionId}/activity`, {});
          logger.debug(`[statusCommand] Activity updated for session: ${sessionId}`);
        } catch (activityError) {
          // Log the error but don't block the status command
           logger.error(`[statusCommand] Failed to update activity via API for sessionId: ${sessionId}. API Error: ${activityError.message}`);
        }
      }

      // 4. Get Status Info (Using the existing local service method)
      logger.debug('[statusCommand] Getting application status...');
      // Check if the internal status service is available
      if (!services || !services.internal || !services.internal.status || typeof services.internal.status.getStatus !== 'function') {
          logger.error('[statusCommand] Internal status service (services.internal.status.getStatus) is not available!');
          throw new Error('Internal status service unavailable.');
      }
      const statusInfo = services.internal.status.getStatus();
      
      // 5. Send Response
      logger.debug('[statusCommand] Sending status response to user...');
      await bot.sendMessage(
        message.chat.id,
        `🟢 StationThis Bot Status\n\n` +
        `🕒 Uptime: ${statusInfo.uptime.formatted}\n` +
        `🚀 Started: ${statusInfo.startTime.replace('T', ' ').slice(0, 19)}\n` +
        `📊 Version: ${statusInfo.version}`,
        { reply_to_message_id: message.message_id }
      );
      logger.info(`[statusCommand] Successfully processed /status for masterAccountId: ${masterAccountId}, sessionId: ${sessionId}`);

    } catch (error) {
      logger.error(`[statusCommand] Error processing /status for telegramUserId ${platformIdStr}:`, error.response ? error.response.data : error.message);
      // Send a generic error message to the user
      try {
        await bot.sendMessage(
          message.chat.id,
          'Sorry, an error occurred while processing the status command. Please try again later.',
          { reply_to_message_id: message.message_id }
        );
      } catch (sendError) {
         logger.error(`[statusCommand] Failed to send error message to chat ${message.chat.id}:`, sendError);
      }
    }
  };
}

module.exports = createStatusCommandHandler; 