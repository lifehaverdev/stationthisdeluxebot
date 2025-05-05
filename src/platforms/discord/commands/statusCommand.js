/**
 * Status Command Handler for Discord
 * 
 * Handles the /status command which displays application runtime information.
 * Uses the internal status API for consistent information across platforms.
 */

const { EmbedBuilder } = require('discord.js');

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
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<void>}
   */
  return async function handleStatusCommand(interaction) {
    try {
      logger.info('Status command received, preparing response...');
      
      // Debug log to verify internal services
      logger.info('DEBUG: Status command - Internal services:',
        services ? 'services exist' : 'services missing',
        services?.internal ? 'internal exists' : 'internal missing',
        services?.internal?.status ? 'status service exists' : 'status service missing');
      
      // Acknowledge the interaction immediately
      await interaction.deferReply();
      logger.info('Interaction deferred for status command');
      
      // Get status information from internal API
      const statusInfo = services.internal.status.getStatus();
      
      logger.info(`Preparing status embed with uptime: ${statusInfo.uptime.formatted}`);
      
      // Create an embed for better visual appearance
      const statusEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🟢 StationThis Bot Status')
        .addFields(
          { name: '🕒 Uptime', value: statusInfo.uptime.formatted, inline: true },
          { name: '🚀 Started', value: statusInfo.startTime.replace('T', ' ').slice(0, 19), inline: true },
          { name: '🤖 Bot User', value: client.user.tag, inline: true }
        )
        .setFooter({ text: 'StationThis Discord Bot' })
        .setTimestamp();
      
      // Send the embed as a reply
      logger.info('Sending status embed response');
      await interaction.editReply({ embeds: [statusEmbed] });
      logger.info('Status command executed successfully');
    } catch (error) {
      logger.error('Error in status command:', error);
      
      // Handle errors gracefully
      if (interaction.deferred) {
        await interaction.editReply('Sorry, an error occurred while fetching application status.');
      } else {
        await interaction.reply({ 
          content: 'Sorry, an error occurred while fetching application status.',
          ephemeral: true 
        });
      }
    }
  };
}

module.exports = createStatusCommandHandler; 