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
   * @param {Object} client - Discord client instance
   * @param {Object} interaction - Discord interaction
   * @param {Object} dependencies - Dependencies object
   * @returns {Promise<void>}
   */
  return async function handleStatusCommand(client, interaction, dependencies) {
    try {
      logger.info('Status command received, preparing response...');
      
      // Validate interaction object
      if (!interaction || typeof interaction.deferReply !== 'function') {
        logger.error('[Status Command] Invalid interaction object received');
        throw new Error('Invalid interaction object');
      }
      
      // Get services from dependencies (fallback to constructor dependencies for backward compatibility)
      const internalServices = dependencies?.internal || services?.internal;
      
      // Debug log to verify internal services
      logger.info('DEBUG: Status command - Internal services:',
        internalServices ? 'services exist' : 'services missing',
        internalServices?.status ? 'status service exists' : 'status service missing');
      
      // Acknowledge the interaction immediately (Discord requires response within 3 seconds)
      if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
      logger.info('Interaction deferred for status command');
      }
      
      // Get status information from internal API
      if (!internalServices?.status) {
        throw new Error('Status service not available');
      }
      
      const statusInfo = internalServices.status.getStatus();
      
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
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ 
            content: 'Sorry, an error occurred while fetching application status.',
            embeds: []
          });
      } else {
          // Use flags instead of deprecated ephemeral option
        await interaction.reply({ 
          content: 'Sorry, an error occurred while fetching application status.',
            flags: 64 // MessageFlags.Ephemeral
        });
        }
      } catch (replyError) {
        logger.error('Failed to send error response:', replyError);
      }
    }
  };
}

module.exports = createStatusCommandHandler; 