/**
 * @file Handles platform linking commands and interactions for Discord.
 * Supports approval-based platform linking via wallet address.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Abbreviates a wallet address for display.
 */
function abbreviate(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/**
 * Creates the link command handler for Discord slash commands.
 */
function createLinkCommandHandler(dependencies) {
  return async function linkCommandHandler(client, interaction, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    const { logger = console } = dependencies;

    if (!apiClient) {
      await interaction.reply({
        content: '❌ Link command unavailable. (Service unavailable)',
        flags: 64 // Ephemeral
      });
      return;
    }

    try {
      await interaction.deferReply({ flags: 64 }); // Ephemeral

      // Get wallet address from command options
      const walletAddress = interaction.options?.getString('wallet');

      if (!walletAddress) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('🔗 Platform Linking')
          .setDescription(
            '**Usage:** `/link <walletAddress>`\n\n' +
            '**Example:** `/link 0x1234567890abcdef1234567890abcdef12345678`\n\n' +
            'This will request to link your Discord account to an account with that wallet address.'
          );

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Validate wallet address format
      if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
        await interaction.editReply({
          content: '❌ Invalid wallet address format. Please provide a valid Ethereum address (0x followed by 40 hex characters).'
        });
        return;
      }

      // Get or create user
      const resp = await apiClient.post('/internal/v1/data/users/find-or-create', {
        platform: 'discord',
        platformId: interaction.user.id.toString(),
        platformContext: {
          username: interaction.user.username,
          discriminator: interaction.user.discriminator,
          globalName: interaction.user.globalName
        }
      });
      const masterAccountId = resp.data.masterAccountId;

      // Show linking method options
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('🔗 How would you like to verify account ownership?')
        .setDescription(`Wallet: \`${abbreviate(walletAddress)}\`\n\n` +
          `• **Request Approval**: Send approval request to the account owner\n` +
          `• **Magic Amount**: Send exact ETH amount to verify ownership`);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`link:request:${walletAddress}`)
            .setLabel('🔗 Request Approval')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`link:magic:${walletAddress}`)
            .setLabel('💰 Magic Amount')
            .setStyle(ButtonStyle.Secondary)
        );

      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });

    } catch (error) {
      logger.error('[LinkManager] Error in link command:', error);
      await interaction.editReply({
        content: '❌ An error occurred while processing your request.'
      });
    }
  };
}

/**
 * Creates the callback handler for link operations.
 */
function createLinkCallbackHandler(dependencies) {
  return async function linkCallbackHandler(client, interaction, masterAccountId, deps) {
    const apiClient = deps.internalApiClient || deps.internal?.client;
    const { logger = console } = deps;

    if (!apiClient) {
      await interaction.reply({
        content: '❌ Service unavailable',
        flags: 64 // Ephemeral
      });
      return;
    }

    const [prefix, action, ...rest] = interaction.customId.split(':');

    try {
      // Check if already deferred (bot.js defers before calling dispatcher)
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      // Handle link request (approval method)
      if (action === 'request') {
        const walletAddress = rest.join(':');

        try {
          // Create link request
          const response = await apiClient.post('/internal/v1/data/users/request-platform-link', {
            requestingPlatform: 'discord',
            requestingPlatformId: interaction.user.id.toString(),
            walletAddress: walletAddress,
            linkMethod: 'approval'
          });

          if (response.status === 201) {
            const { requestId, expiresAt, targetPlatform } = response.data;
            const expiresDate = new Date(expiresAt);
            const expiresHuman = expiresDate.toLocaleString();

            const embed = new EmbedBuilder()
              .setColor('#00FF00')
              .setTitle('✅ Link Request Sent!')
              .setDescription(
                `Waiting for approval from **${targetPlatform}** account.\n` +
                `Request expires: ${expiresHuman}\n\n` +
                `You will be notified when the request is approved or rejected.`
              );

            await interaction.editReply({
              embeds: [embed],
              components: []
            });
          } else {
            throw new Error(response.data?.error?.message || 'Failed to create link request');
          }
        } catch (error) {
          // Handle duplicate request error (409)
          if (error.response?.status === 409) {
            const errorData = error.response.data?.error;
            const existingRequestId = errorData?.requestId;
            
            const embed = new EmbedBuilder()
              .setColor('#FFA500')
              .setTitle('⚠️ Pending Request Already Exists')
              .setDescription(
                `You already have a pending link request for this wallet.\n\n` +
                (existingRequestId ? `Request ID: \`${existingRequestId}\`\n` : '') +
                `Please wait for the existing request to be approved or rejected, or cancel it in \`/account\` → Link Platform → Sent Requests.`
              );

            await interaction.editReply({
              embeds: [embed],
              components: []
            });
            // Mark as handled to prevent outer catch from processing
            error.handled = true;
            return;
          }

          // Handle rate limit error (429)
          if (error.response?.status === 429) {
            const errorData = error.response.data?.error;
            const pendingCount = errorData?.pendingCount || 0;
            const maxAllowed = errorData?.maxAllowed || 5;
            
            const embed = new EmbedBuilder()
              .setColor('#FF6B6B')
              .setTitle('⚠️ Too Many Pending Requests')
              .setDescription(
                `You have ${pendingCount} pending requests (max: ${maxAllowed}).\n\n` +
                `Please cancel some requests in \`/account\` → Link Platform → Sent Requests before creating new ones.`
              );

            await interaction.editReply({
              embeds: [embed],
              components: []
            });
            // Mark as handled to prevent outer catch from processing
            error.handled = true;
            return;
          }
          
          // Re-throw other errors to be handled by outer catch
          throw error;
        }
      }

      // Handle approval
      else if (action === 'approve') {
        const requestId = rest.join(':');

        const response = await apiClient.post(
          `/internal/v1/data/users/link-requests/${requestId}/approve`,
          { masterAccountId }
        );

        if (response.status === 200) {
          const { linkedPlatform } = response.data;

          const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Accounts Linked Successfully!')
            .setDescription(
              `Your **${linkedPlatform}** account is now linked.\n` +
              `Your balance and history are now shared across platforms.`
            );

          await interaction.editReply({
            embeds: [embed],
            components: []
          });
        } else {
          throw new Error(response.data?.error?.message || 'Failed to approve link request');
        }
      }

      // Handle rejection
      else if (action === 'reject') {
        const requestId = rest.join(':');

        const response = await apiClient.post(
          `/internal/v1/data/users/link-requests/${requestId}/reject`,
          { masterAccountId }
        );

        if (response.status === 200) {
          const embed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('❌ Link Request Rejected')
            .setDescription('The link request has been rejected.');

          await interaction.editReply({
            embeds: [embed],
            components: []
          });
        } else {
          throw new Error(response.data?.error?.message || 'Failed to reject link request');
        }
      }

      // Handle report
      else if (action === 'report') {
        const requestId = rest.join(':');

        try {
          const response = await apiClient.post(
            `/internal/v1/data/users/link-requests/${requestId}/report`,
            { 
              masterAccountId,
              reason: 'Suspicious link request - reported by user'
            }
          );

          if (response.status === 200) {
            const { reportedCount, autoBanned } = response.data;
            let description = 'The link request has been reported for review.';
            
            if (autoBanned) {
              description += `\n\n⚠️ The requester has been automatically banned after ${reportedCount} reports.`;
            } else {
              description += `\n\nThis is report #${reportedCount} for this user.`;
            }

            const embed = new EmbedBuilder()
              .setColor('#FFA500')
              .setTitle('🚨 Link Request Reported')
              .setDescription(description);

            await interaction.editReply({
              embeds: [embed],
              components: []
            });
          } else {
            throw new Error(response.data?.error?.message || 'Failed to report link request');
          }
        } catch (error) {
          const errorMsg = error.response?.data?.error?.message || error.message || 'Failed to report request';
          
          const embed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('❌ Error')
            .setDescription(errorMsg.substring(0, 2000));

          await interaction.editReply({
            embeds: [embed],
            components: []
          });
        }
      }

      // Handle cancel request
      else if (action === 'cancel') {
        const requestId = rest.join(':');

        try {
          const response = await apiClient.delete(
            `/internal/v1/data/users/link-requests/${requestId}/cancel`,
            { data: { masterAccountId } }
          );

          if (response.status === 200) {
            const embed = new EmbedBuilder()
              .setColor('#00FF00')
              .setTitle('✅ Request Cancelled')
              .setDescription('Your link request has been cancelled successfully.');

            await interaction.editReply({
              embeds: [embed],
              components: []
            });
          } else {
            throw new Error(response.data?.error?.message || 'Failed to cancel link request');
          }
        } catch (error) {
          const errorMsg = error.response?.data?.error?.message || error.message || 'Failed to cancel request';
          
          const embed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('❌ Error')
            .setDescription(errorMsg.substring(0, 2000));

          await interaction.editReply({
            embeds: [embed],
            components: []
          });
        }
      }

      // Handle cancel all requests
      else if (action === 'cancel-all') {
        try {
          const response = await apiClient.delete(
            `/internal/v1/data/users/link-requests/cancel-all`,
            { data: { masterAccountId } }
          );

          if (response.status === 200) {
            const { cancelledCount } = response.data;
            const embed = new EmbedBuilder()
              .setColor('#00FF00')
              .setTitle('✅ All Requests Cancelled')
              .setDescription(`Successfully cancelled ${cancelledCount} pending request(s).`);

            await interaction.editReply({
              embeds: [embed],
              components: []
            });
          } else {
            throw new Error(response.data?.error?.message || 'Failed to cancel requests');
          }
        } catch (error) {
          const errorMsg = error.response?.data?.error?.message || error.message || 'Failed to cancel requests';
          
          const embed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('❌ Error')
            .setDescription(errorMsg.substring(0, 2000));

          await interaction.editReply({
            embeds: [embed],
            components: []
          });
        }
      }

      // Handle magic amount method
      else if (action === 'magic') {
        await interaction.editReply({
          content: '💰 Magic amount linking is handled via the `/wallet` command. Please use `/wallet` to link via magic amount.',
          embeds: [],
          components: []
        });
      }

    } catch (error) {
      logger.error('[LinkManager] Error handling callback:', error);
      
      // Check if error was already handled (e.g., duplicate request)
      if (error.handled) {
        return;
      }
      
      const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error';

      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Error')
        .setDescription(errorMsg.substring(0, 2000));

      try {
        await interaction.editReply({
          embeds: [embed],
          components: []
        });
      } catch (replyError) {
        // If editReply fails, try followUp
        try {
          await interaction.followUp({
            embeds: [embed],
            flags: 64 // Ephemeral
          });
        } catch (followUpError) {
          logger.error('[LinkManager] Failed to send error message:', followUpError);
        }
      }
    }
  };
}

/**
 * Registers link command and callback handlers.
 */
function registerHandlers(dispatchers, dependencies) {
  const { commandDispatcher, buttonInteractionDispatcher } = dispatchers;

  // Register /link command
  const linkCommandHandler = createLinkCommandHandler(dependencies);
  commandDispatcher.register('link', linkCommandHandler);

  // Register link callback handler
  buttonInteractionDispatcher.register('link', createLinkCallbackHandler(dependencies));

  dependencies.logger.info('[LinkManager] Link handlers registered for Discord');
}

module.exports = {
  registerHandlers,
  createLinkCommandHandler,
  createLinkCallbackHandler
};

