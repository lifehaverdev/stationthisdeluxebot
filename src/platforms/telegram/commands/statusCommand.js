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
    const telegramUserId = message.from.id;
    let masterAccountId;
    let sessionId;

    // DIAGNOSTIC LOGGING REMOVED

    try {
      // 1. Get masterAccountId
      // Assuming userCoreDb.js has a method like findOrCreateByPlatformId
      // or a similar method to get/create a masterAccount and return its ID.
      // For now, we'll assume services.db.noema.userCore.findOrCreateByPlatformId exists.
      const userCore = services.db.noema.userCore;
      const userRecord = await userCore.findOrCreateByPlatformId('telegram', telegramUserId.toString());
      if (!userRecord || !userRecord._id) {
        logger.error(`[statusCommand] Could not find or create userCore record for telegramUserId: ${telegramUserId}`);
        await bot.sendMessage(message.chat.id, 'Sorry, there was an issue accessing your user profile. Please try again later.', { reply_to_message_id: message.message_id });
        return;
      }
      masterAccountId = userRecord._id;

      // 2. Find or Create Session
      const userSessionsDb = services.db.noema.userSessions;
      let activeSessions = await userSessionsDb.findActiveSessionsByUserAndPlatform(masterAccountId, 'telegram');
      
      if (activeSessions && activeSessions.length > 0) {
        sessionId = activeSessions[0]._id; // Use the first active session
        // Optionally, if multiple active sessions are not expected, log a warning or handle as an anomaly.
        if (activeSessions.length > 1) {
            logger.warn(`[statusCommand] Multiple active Telegram sessions found for masterAccountId: ${masterAccountId}. Using session: ${sessionId}`);
        }
      } else {
        const newSession = await userSessionsDb.createSession({
          masterAccountId: masterAccountId,
          platform: 'telegram',
          platformUserId: telegramUserId.toString(), // Storing for potential direct queries on session
          isActive: true,
          // sessionData: { userAgent: message.meta?.userAgent } // Example: if available
        });
        if (!newSession || !newSession._id) {
            logger.error(`[statusCommand] Could not create session for masterAccountId: ${masterAccountId}`);
            await bot.sendMessage(message.chat.id, 'Sorry, there was an issue starting a new session. Please try again.', { reply_to_message_id: message.message_id });
            return;
        }
        sessionId = newSession._id;
        logger.info(`[statusCommand] New session created: ${sessionId} for masterAccountId: ${masterAccountId}`);
        
        // Log session_started event
        const userEventsDb = services.db.noema.userEvents;
        if (userEventsDb) { // Ensure the service is available
          try {
            await userEventsDb.logEvent({
              masterAccountId: masterAccountId,
              sessionId: sessionId,
              eventType: 'session_started',
              sourcePlatform: 'telegram', // As per ADR-002 userEvents schema
              eventData: { 
                platform: 'telegram', // As per NOEMA_EVENT_CATALOG for session_started
                startMethod: 'command_interaction' // Example start method
              }
            });
            logger.info(`[statusCommand] session_started event logged for sessionId: ${sessionId}`);
          } catch (eventError) {
            logger.error(`[statusCommand] Failed to log session_started event for sessionId: ${sessionId}`, eventError);
            // Decide if this failure is critical enough to halt or notify user
            // For now, just logging the error and continuing.
          }
        } else {
            logger.warn('[statusCommand] UserEventsDB service not available, cannot log session_started event.');
        }
      }

      // 3. Update Last Activity
      if (sessionId) {
        await userSessionsDb.updateLastActivity(sessionId);
      }

      // Original status command logic
      logger.info('DEBUG: Status command (Telegram) - Internal services:',
        services ? 'services exist' : 'services missing',
        services?.internal ? 'internal exists' : 'internal missing',
        services?.internal?.status ? 'status service exists' : 'status service missing');
      
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
      logger.error(`[statusCommand] Error processing /status for telegramUserId ${telegramUserId}:`, error);
      // Avoid sending another message if one was already sent due to user/session creation failure
      if (!masterAccountId || !sessionId) { // Check if error happened before core logic could have sent a message
        // If masterAccountId or sessionId is not set, it means the error likely happened during their retrieval/creation.
        // The specific error messages for those failures are handled above.
        // If an error occurs after these are set (e.g. in getStatus or sendMessage), then send a generic error.
      } else {
         await bot.sendMessage(
          message.chat.id,
          'Sorry, an error occurred while fetching application status or managing your session.',
          { reply_to_message_id: message.message_id }
        );
      }
    }
  };
}

module.exports = createStatusCommandHandler; 