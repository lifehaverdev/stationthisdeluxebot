/**
 * Status Command Handler for Telegram
 * 
 * Handles the /status command which displays application runtime information.
 * Uses the internal status API for consistent information across platforms.
 */

/**
 * Helper to format numbers with commas.
 * @param {number} num - The number to format.
 * @returns {string} Formatted number string.
 */
function formatNumberWithCommas(num) {
  if (num === null || num === undefined) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Time window constant: 5 minutes in milliseconds
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Filters live tasks according to Telegram /status criteria.
 *
 * Criteria:
 *  - status === "processing"
 *  - updatedAt OR startedAt is within the last 5 minutes relative to currentTime
 *  - sourcePlatform === "telegram"
 *  - (optional) masterAccountId matches if the field is present on the task object
 *
 * @param {Array<Object>} tasks - Raw tasks array from the status-report endpoint.
 * @param {Object} options
 * @param {string} options.masterAccountId - Master account id of the requesting user.
 * @param {number} [options.currentTime=Date.now()] - Overrideable current timestamp (ms) for testing.
 * @returns {Array<Object>} Filtered tasks array.
 */
function filterLiveTasks(tasks, { masterAccountId, currentTime = Date.now() } = {}) {
  if (!Array.isArray(tasks)) return [];

  return tasks.filter((task) => {
    if (!task) return false;

    const statusLower = (task.status || '').toString().toLowerCase();
    const deliveryLower = (task.deliveryStatus || '').toString().toLowerCase();

    // Exclude tasks already delivered or explicitly failed
    if (deliveryLower === 'delivered' || statusLower === 'failed') return false;

    // We want anything still in flight: processing, running, queued, pending, or completed-but-not-delivered
    const liveLikeStatuses = ['processing', 'running', 'queued', 'pending', 'completed'];
    if (!liveLikeStatuses.includes(statusLower)) return false;

    // 2. sourcePlatform must be telegram (default to include only telegram tasks)
    if (task.sourcePlatform !== 'telegram') return false;

    // 3. masterAccountId match (if task object carries it)
    if (task.masterAccountId && masterAccountId && task.masterAccountId !== masterAccountId) return false;

    // 4. updatedAt/startedAt within last 5 minutes
    const tsStr = task.updatedAt || task.startedAt;
    if (!tsStr) return false;
    const ts = new Date(tsStr).getTime();
    if (isNaN(ts)) return false;
    return currentTime - ts <= FIVE_MINUTES_MS;
  });
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
    logger = console,
  } = dependencies;
  
  /**
   * Handle the status command
   * @param {Object} message - Telegram message
   * @returns {Promise<void>}
   */
  return async function handleStatusCommand(bot, message, dependencies, match) {
    const telegramUserId = message.from.id;
    let masterAccountId;
    // sessions were deprecated; no session tracking needed
    const platformIdStr = telegramUserId.toString();
    const platform = 'telegram';

    try {
      // 1. Get masterAccountId via UserService
      logger.debug(`[statusCommand] Getting masterAccountId for platformId: ${platformIdStr}...`);
      const { masterAccountId: resolvedId, isNewUser } = await dependencies.userService.findOrCreate({
        platform,
        platformId: platformIdStr,
        platformContext: {
          firstName: message.from.first_name,
          username: message.from.username
        }
      });
      masterAccountId = resolvedId;
      logger.debug(`[statusCommand] Got masterAccountId: ${masterAccountId}. New user: ${isNewUser}`);

      // NOTE: Session management removed as per deprecation.

      // 4. Get Enhanced Status Info via UserService
      logger.debug(`[statusCommand] Getting enhanced status report for masterAccountId: ${masterAccountId}...`);
      const statusData = await dependencies.userService.getStatusReport(masterAccountId);

      // 5. Format and Send Response
      let messageText = '\n\n';
      if (statusData.walletAddress) {
        let abbreviatedWallet = statusData.walletAddress.slice(0, 6) + '...' + statusData.walletAddress.slice(-4);
        messageText += `🔗 Wallet: ${abbreviatedWallet}\n`;
      } else {
        messageText += '🔗 Wallet: Not set\n';
      }
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
      messageText += `✨\n`
      messageText += `${expProgressBar}\n\n`;
      


      

      const filteredTasks = filterLiveTasks(statusData.liveTasks, { masterAccountId });

      if (filteredTasks.length === 0) {
        messageText += '\nStationthis is Standing by.\n';
      } else {
        messageText += '\n📡 Active Tasks:\n';
        const tasksToShow = filteredTasks.slice(0, 10);
        tasksToShow.forEach((task) => {
          // Future enhancement: include progress %, ETA, and cost once UI finalized (see ADR-???)
          // const progressInfo = task.progress !== null && task.progress !== undefined ? ` (${task.progress}%)` : '';
          // const etaPart = ''; // calculated ETA placeholder

          messageText += `• ${task.idHash} – ${task.status}\n`;
        });

        if (filteredTasks.length > tasksToShow.length) {
          const remaining = filteredTasks.length - tasksToShow.length;
          messageText += `…and ${remaining} more\n`;
        }
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
      logger.debug(`[statusCommand] Successfully processed /status for masterAccountId: ${masterAccountId}`);

    } catch (error) {
      logger.error(`[statusCommand] Error processing /status for telegramUserId ${platformIdStr}: ${error.response ? JSON.stringify(error.response.data) : error.message} ${error.stack}`);
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

// Expose the helper for unit testing purposes without altering default export semantics
createStatusCommandHandler.filterLiveTasks = filterLiveTasks;

module.exports = createStatusCommandHandler; 