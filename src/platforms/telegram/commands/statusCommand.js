/**
 * Status Command Handler for Telegram
 * 
 * Handles the /status command which displays application runtime information.
 * Uses the internal status API for consistent information across platforms.
 */

const internalApiClient = require('../utils/internalApiClient'); // Import the new API client

/**
 * Helper to format numbers with commas.
 * @param {number} num - The number to format.
 * @returns {string} Formatted number string.
 */
function formatNumberWithCommas(num) {
  if (num === null || num === undefined) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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

      // 4. Get Enhanced Status Info via new Internal API Endpoint
      logger.debug(`[statusCommand] Getting enhanced status report for masterAccountId: ${masterAccountId}...`);
      const statusReportResponse = await internalApiClient.get(`/users/${masterAccountId}/status-report`);
      const statusData = statusReportResponse.data;

      // 5. Format and Send Response
      let messageText = '\n\n';
      messageText += `💰 Points: ${formatNumberWithCommas(statusData.points)}\n\n`;
      
      // Calculate Level and EXP Bar
      const currentExp = statusData.exp || 0;
      const level = Math.floor(Math.cbrt(currentExp));
      const currentLevelExp = Math.pow(level, 3);
      const nextLevelExp = Math.pow(level + 1, 3);
      
      let expProgressBar = '🟩'; // First segment always green
      const variableSegments = 6;
      let progressRatio = 0;

      if (nextLevelExp > currentLevelExp) { // Avoid division by zero if currentLvlExp === nextLvlExp (e.g. level 0)
        progressRatio = (currentExp - currentLevelExp) / (nextLevelExp - currentLevelExp);
      }
      // Ensure progressRatio is between 0 and 1
      progressRatio = Math.max(0, Math.min(1, progressRatio)); 

      const greenSegments = Math.floor(progressRatio * variableSegments);
      const whiteSegments = variableSegments - greenSegments;

      for (let i = 0; i < greenSegments; i++) expProgressBar += '🟩';
      for (let i = 0; i < whiteSegments; i++) expProgressBar += '⬜️';

      messageText += `🌟 Level: ${level}\n`;
      messageText += `✨ ${expProgressBar}\n\n`;
      
      if (statusData.walletAddress) {
        messageText += `🔗 Wallet: ${statusData.walletAddress}\n`;
      } else {
        messageText += '🔗 Wallet: Not set\n';
      }

      messageText += '\n📡 Active Tasks:\n';
      if (statusData.liveTasks && statusData.liveTasks.length > 0) {
        statusData.liveTasks.forEach(task => {
          const progressInfo = task.progress !== null ? ` (${task.progress}%)` : '';
          // Format costUsd to 2 decimal places, or show N/A if null
          const costDisplay = task.costUsd !== null ? `$${parseFloat(task.costUsd).toFixed(2)}` : '$N/A';
          messageText += `• ${task.idHash} – ${task.status}${progressInfo} – ${costDisplay}\n`;
        });
      } else {
        messageText += 'No active tasks at the moment.\n';
      }
      
      // Send the richer status message
      logger.debug('[statusCommand] Sending enhanced status response to user...');
      await bot.sendMessage(
        message.chat.id,
        messageText,
        { 
          reply_to_message_id: message.message_id,
          parse_mode: 'Markdown' // Optional: if you want to use Markdown for formatting (e.g. bolding titles)
        }
      );
      logger.info(`[statusCommand] Successfully processed /status with enhanced report for masterAccountId: ${masterAccountId}, sessionId: ${sessionId}`);

    } catch (error) {
      logger.error(`[statusCommand] Error processing /status for telegramUserId ${platformIdStr}:`, error.response ? JSON.stringify(error.response.data) : error.message, error.stack);
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