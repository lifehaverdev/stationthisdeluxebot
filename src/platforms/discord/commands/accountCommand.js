/**
 * Account Command Handler for Discord
 * 
 * Handles the /account command which displays user account information and management options.
 */

const { buildAccountMenu } = require('../components/accountMenuManager');

/**
 * Create account command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createAccountCommandHandler(dependencies) {
  const { 
    logger = console
  } = dependencies;
  
  /**
   * Handle the account command
   * @param {Object} client - Discord client instance
   * @param {Object} interaction - Discord interaction
   * @param {Object} dependencies - Dependencies object
   * @returns {Promise<void>}
   */
  return async function handleAccountCommand(client, interaction, dependencies) {
    try {
      logger.info('[Account Command] Received account command');
      
      // Validate interaction
      if (!interaction || typeof interaction.deferReply !== 'function') {
        logger.error('[Account Command] Invalid interaction object');
        throw new Error('Invalid interaction object');
      }
      
      // Defer reply
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 }); // Ephemeral
      }
      
      const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
      if (!apiClient) {
        throw new Error('Internal API client not available');
      }

      // Get or create user
      const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
        platform: 'discord',
        platformId: interaction.user.id.toString(),
        platformContext: {
          username: interaction.user.username,
          discriminator: interaction.user.discriminator,
          globalName: interaction.user.globalName
        }
      });
      const masterAccountId = findOrCreateResponse.data.masterAccountId;

      // Build account menu using shared function
      const accountMenu = await buildAccountMenu(masterAccountId, interaction, {
        ...dependencies,
        internalApiClient: apiClient
      });

      await interaction.editReply({
        embeds: accountMenu.embeds,
        components: accountMenu.components
      });

      logger.info('[Account Command] Account command executed successfully');

    } catch (error) {
      logger.error('[Account Command] Error:', error);
      
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ 
            content: '❌ Sorry, an error occurred while fetching your account information.',
            embeds: [],
            components: []
          });
        } else {
          await interaction.reply({ 
            content: '❌ Sorry, an error occurred while fetching your account information.',
            flags: 64 // Ephemeral
          });
        }
      } catch (replyError) {
        logger.error('[Account Command] Failed to send error response:', replyError);
      }
    }
  };
}

module.exports = createAccountCommandHandler;

