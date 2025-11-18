/**
 * Status Command Handler for Discord
 * 
 * Handles the /status command which displays application runtime information.
 * Matches Telegram's status command functionality for platform parity.
 */

const { EmbedBuilder } = require('discord.js');

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
 * Filters live tasks according to Discord /status criteria.
 *
 * Criteria:
 *  - status === "processing"
 *  - updatedAt OR startedAt is within the last 5 minutes relative to currentTime
 *  - sourcePlatform === "discord"
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

    // 2. sourcePlatform must be discord (default to include only discord tasks)
    if (task.sourcePlatform !== 'discord') return false;

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
 * Create status command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createStatusCommandHandler(dependencies) {
  const { 
    client,
    services,
    logger = console
  } = dependencies;
  
  /**
   * Handle the status command
   * @param {Object} client - Discord client instance
   * @param {Object} interaction - Discord interaction
   * @param {Object} dependencies - Dependencies object
   * @returns {Promise<void>}
   */
  return async function handleStatusCommand(client, interaction, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
      throw new Error('[statusCommand] internalApiClient dependency missing');
    }
    
    const discordUserId = interaction.user.id;
    let masterAccountId;
    const platformIdStr = discordUserId.toString();
    const platform = 'discord';

    try {
      logger.info(`[Status Command] Processing /status for Discord user ${platformIdStr}...`);
      
      // Validate interaction object
      if (!interaction || typeof interaction.deferReply !== 'function') {
        logger.error('[Status Command] Invalid interaction object received');
        throw new Error('Invalid interaction object');
      }
      
      // Acknowledge the interaction immediately (Discord requires response within 3 seconds)
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
        logger.info('Interaction deferred for status command');
      }
      
      // 1. Get masterAccountId via Internal API
      logger.debug(`[statusCommand] Getting masterAccountId for platformId: ${platformIdStr}...`);
      const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
        platform: platform,
        platformId: platformIdStr,
        platformContext: {
          username: interaction.user.username,
          discriminator: interaction.user.discriminator,
          globalName: interaction.user.globalName,
        }
      });
      
      masterAccountId = findOrCreateResponse.data.masterAccountId;
      const isNewUser = findOrCreateResponse.data.isNewUser;
      logger.info(`[statusCommand] Got masterAccountId: ${masterAccountId}. New user: ${isNewUser}`);

      // 2. Get Enhanced Status Info via new Internal API Endpoint
      logger.debug(`[statusCommand] Getting enhanced status report for masterAccountId: ${masterAccountId}...`);
      const statusReportResponse = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/status-report`);
      const statusData = statusReportResponse.data;

      // 3. Format response data
      let walletText = 'Not set';
      if (statusData.walletAddress) {
        const abbreviatedWallet = statusData.walletAddress.slice(0, 6) + '...' + statusData.walletAddress.slice(-4);
        walletText = abbreviatedWallet;
      }
      
      const pointsText = formatNumberWithCommas(statusData.points);
      
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

      // Filter live tasks
      const filteredTasks = filterLiveTasks(statusData.liveTasks, { masterAccountId });
      
      // 4. Build Discord embed
      const statusEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🟢 StationThis Status')
        .addFields(
          { name: '🔗 Wallet', value: walletText, inline: true },
          { name: '💰 Points', value: pointsText, inline: true },
          { name: '🌟 Level', value: level.toString(), inline: true },
          { name: '✨ EXP', value: expProgressBar, inline: false }
        )
        .setFooter({ text: 'StationThis Discord Bot' })
        .setTimestamp();

      // Add active tasks section
      if (filteredTasks.length === 0) {
        statusEmbed.addFields({ name: '📡 Status', value: 'Stationthis is Standing by.', inline: false });
      } else {
        const tasksToShow = filteredTasks.slice(0, 10);
        let tasksText = '';
        tasksToShow.forEach((task) => {
          tasksText += `• ${task.idHash} – ${task.status}\n`;
        });

        if (filteredTasks.length > tasksToShow.length) {
          const remaining = filteredTasks.length - tasksToShow.length;
          tasksText += `…and ${remaining} more\n`;
        }

        statusEmbed.addFields({ name: '📡 Active Tasks', value: tasksText, inline: false });
      }
      
      // 5. Send the embed as a reply
      logger.info('Sending enhanced status embed response');
      await interaction.editReply({ embeds: [statusEmbed] });
      logger.info(`[statusCommand] Successfully processed /status for masterAccountId: ${masterAccountId}`);
      
    } catch (error) {
      logger.error(`[statusCommand] Error processing /status for discordUserId ${platformIdStr}: ${error.response ? JSON.stringify(error.response.data) : error.message} ${error.stack}`);
      
      // Handle errors gracefully
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ 
            content: 'Sorry, an error occurred while processing the status command. Please try again later.',
            embeds: []
          });
        } else {
          await interaction.reply({ 
            content: 'Sorry, an error occurred while processing the status command. Please try again later.',
            flags: 64 // MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        logger.error('Failed to send error response:', replyError);
      }
    }
  };
}

// Expose the helper for unit testing purposes without altering default export semantics
createStatusCommandHandler.filterLiveTasks = filterLiveTasks;

module.exports = createStatusCommandHandler; 