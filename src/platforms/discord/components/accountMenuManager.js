/**
 * Account Menu Manager for Discord
 * 
 * Handles account menu interactions and platform linking for Discord.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Utility: resolve canonical internalApiClient for this module
function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}

/**
 * Builds the main account menu embed and components.
 * @param {string} masterAccountId - The user's master account ID
 * @param {object} interaction - Discord interaction (for user info)
 * @param {object} dependencies - The canonical dependencies object
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildAccountMenu(masterAccountId, interaction, dependencies) {
    const { logger = console } = dependencies || {};
    const apiClient = getApiClient(dependencies);
    
    if (!apiClient) {
        logger.error('[AccountMenu] buildAccountMenu: apiClient missing');
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Account service unavailable. Please try again later.')
            .setColor(0xFF0000);
        return { embeds: [errorEmbed], components: [] };
    }
    
    try {
        // Fetch user data
        const userRes = await apiClient.get(`/internal/v1/data/users/${masterAccountId}`);
        const user = userRes.data;
        
        // Fetch economy data (may not exist for new users)
        let economy = { usdCredit: 0 };
        try {
            const economyRes = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/economy`);
            economy = economyRes.data || { usdCredit: 0 };
        } catch (economyError) {
            // Economy record not found is expected for new users
            if (economyError.response?.status === 404) {
                logger.info(`[AccountMenu] Economy record not found for user ${masterAccountId}, using defaults`);
            } else {
                logger.warn(`[AccountMenu] Failed to fetch economy data: ${economyError.message}`);
            }
            // Use default economy object
            economy = { usdCredit: 0 };
        }

        // Get wallet status
        let walletStatus = 'Not Connected';
        let walletAddr = null;
        const primaryWallet = user.wallets?.find(w => w.isPrimary);
        if (primaryWallet) {
            walletAddr = primaryWallet.address;
            walletStatus = `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}`;
        } else if (user.wallets?.length > 0) {
            walletAddr = user.wallets[0].address;
            walletStatus = `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}`;
        }

        // Get points balance
        let pointsBalance = '0.0000';
        try {
            if (walletAddr) {
                const pointsRes = await apiClient.get(`/internal/v1/data/ledger/points/by-wallet/${walletAddr}`);
                const pointsValue = pointsRes.data?.points ?? pointsRes.data?.pointsBalance ?? 0;
                pointsBalance = parseFloat(pointsValue).toFixed(4);
            } else {
                pointsBalance = parseFloat(economy.usdCredit?.$numberDecimal || economy.usdCredit || 0).toFixed(4);
            }
        } catch (pointsErr) {
            logger.warn(`[AccountMenu] Failed to fetch points: ${pointsErr.message}`);
            pointsBalance = parseFloat(economy.usdCredit?.$numberDecimal || economy.usdCredit || 0).toFixed(4);
        }

        // Get linked platforms
        const platformIdentities = user.platformIdentities || {};
        const linkedPlatforms = Object.keys(platformIdentities);
        const platformInfo = linkedPlatforms.length > 0 ? ` (${linkedPlatforms.length} linked)` : '';

        // Create embed
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`👤 ${interaction.user.globalName || interaction.user.username}'s Account`)
            .addFields(
                { name: '💼 Wallet', value: walletStatus, inline: true },
                { name: '💰 Points', value: pointsBalance, inline: true },
                { name: '🔗 Platforms', value: linkedPlatforms.length > 0 ? linkedPlatforms.join(', ') : 'None', inline: true }
            )
            .setFooter({ text: 'StationThis Discord Bot' })
            .setTimestamp();

        // Create buttons
        const actionLabel = walletAddr ? 'Buy Points' : 'Connect Wallet';
        const actionId = walletAddr ? 'account:buy' : 'account:connect';

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(actionId)
                    .setLabel(actionLabel)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('account:history')
                    .setLabel('History')
                    .setStyle(ButtonStyle.Secondary)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('account:link')
                    .setLabel(`🔗 Link Platform${platformInfo}`)
                    .setStyle(ButtonStyle.Secondary)
            );

        return { embeds: [embed], components: [row1, row2] };
    } catch (error) {
        logger.error('[AccountMenu] Error building account menu:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Failed to load account information. Please try again.')
            .setColor(0xFF0000);
        return { embeds: [errorEmbed], components: [] };
    }
}

/**
 * Handles account menu button interactions
 * @param {Object} client - Discord client instance
 * @param {Object} interaction - Discord button interaction
 * @param {string} masterAccountId - User's master account ID
 * @param {Object} dependencies - Dependencies object
 */
async function handleAccountMenuInteraction(client, interaction, masterAccountId, dependencies) {
  const { logger = console } = dependencies;
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
  
  if (!interaction?.customId) {
    logger.error('[AccountMenu] Button interaction missing customId');
    return;
  }
  
  if (!masterAccountId) {
    logger.error('[AccountMenu] masterAccountId not provided by dispatcher');
    return;
  }
  
  // CRITICAL: Defer immediately (within 3 seconds)
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferUpdate();
    } catch (deferError) {
      logger.error('[AccountMenu] Failed to defer update:', deferError);
      return;
    }
  }
  
  const customId = interaction.customId;
  const parts = customId.split(':');
  const action = parts[0];
  const subAction = parts[1];

  try {
    switch (subAction) {
      case 'connect':
        // Redirect to wallet manager - build wallet menu
        const { buildWalletMenu } = require('./walletManager');
        const walletMenu = await buildWalletMenu(masterAccountId, dependencies);
        await interaction.editReply({
          embeds: walletMenu.embeds,
          components: walletMenu.components
        });
        break;

      case 'buy':
        // Redirect to buy points (if exists)
        await interaction.editReply({
          content: '💰 Buy Points feature coming soon!',
          embeds: [],
          components: []
        });
        break;

      case 'history':
        await interaction.editReply({
          content: '📊 History feature coming soon!',
          embeds: [],
          components: []
        });
        break;

      case 'link':
        // Check if there's a sub-action (e.g., account:link:new)
        const linkSubAction = interaction.customId.split(':')[2];
        if (linkSubAction) {
          await handleLinkPlatformSubAction(client, interaction, masterAccountId, dependencies, linkSubAction);
        } else {
          await displayLinkPlatformMenu(client, interaction, masterAccountId, dependencies);
        }
        break;

      case 'main':
        // Go back to main account menu
        const accountMenu = await buildAccountMenu(masterAccountId, interaction, dependencies);
        await interaction.editReply({
          embeds: accountMenu.embeds,
          components: accountMenu.components
        });
        break;

      default:
        logger.warn(`[AccountMenu] Unknown action: ${subAction}`);
        await interaction.editReply({
          content: '❌ Unknown action.',
          embeds: [],
          components: []
        });
    }
  } catch (error) {
    logger.error('[AccountMenu] Error handling interaction:', error);
    try {
      await interaction.editReply({
        content: '❌ An error occurred. Please try again.',
        embeds: [],
        components: []
      });
    } catch (e) {
      logger.error('[AccountMenu] Failed to send error:', e);
    }
  }
}

/**
 * Displays the platform linking menu
 */
async function displayLinkPlatformMenu(client, interaction, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;

  try {
    // Fetch user data and link requests
    const [userRes, linkRequestsRes] = await Promise.all([
      apiClient.get(`/internal/v1/data/users/${masterAccountId}`),
      apiClient.get(`/internal/v1/data/users/${masterAccountId}/link-requests?status=pending`)
    ]);

    const user = userRes.data;
    const linkRequests = linkRequestsRes.data;

    const platformIdentities = user.platformIdentities || {};
    const linkedPlatforms = Object.keys(platformIdentities);
    const pendingSent = linkRequests.sent || [];
    const pendingReceived = linkRequests.received || [];

    // Build embed
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('🔗 Platform Linking');

    let description = '';

    if (linkedPlatforms.length > 0) {
      description += '**Linked Platforms:**\n';
      linkedPlatforms.forEach(platform => {
        const platformId = platformIdentities[platform];
        const displayId = platformId.length > 20 ? platformId.substring(0, 20) + '...' : platformId;
        description += `• ${platform}: \`${displayId}\`\n`;
      });
      description += '\n';
    } else {
      description += 'No platforms linked yet.\n\n';
    }

    if (pendingSent.length > 0 || pendingReceived.length > 0) {
      description += '**Pending Requests:**\n';
      if (pendingSent.length > 0) {
        description += `📤 Sent: ${pendingSent.length}\n`;
        // Show details of sent requests
        pendingSent.slice(0, 3).forEach((req, idx) => {
          const walletAbbr = req.targetWalletAddress.substring(0, 10) + '...';
          const expiresDate = new Date(req.expiresAt);
          const expiresHuman = expiresDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          description += `  ${idx + 1}. Wallet: \`${walletAbbr}\` (expires: ${expiresHuman})\n`;
        });
        if (pendingSent.length > 3) {
          description += `  ... and ${pendingSent.length - 3} more\n`;
        }
      }
      if (pendingReceived.length > 0) {
        description += `\n📥 Received: ${pendingReceived.length}\n`;
      }
      description += '\n';
    }

    description += 'Link your account to other platforms by providing a wallet address.';

    embed.setDescription(description);

    // Build buttons
    const row1 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('account:link:new')
          .setLabel('🔗 Link New Platform')
          .setStyle(ButtonStyle.Primary)
      );

    const rows = [row1];

    if (pendingSent.length > 0) {
      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('account:link:sent')
            .setLabel(`📤 Sent Requests (${pendingSent.length})`)
            .setStyle(ButtonStyle.Secondary)
        );
      rows.push(row2);
    }

    if (pendingReceived.length > 0) {
      const row3 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('account:link:requests')
            .setLabel(`📬 Received Requests (${pendingReceived.length})`)
            .setStyle(ButtonStyle.Secondary)
        );
      rows.push(row3);
    }

    if (linkedPlatforms.length > 0) {
      const row3 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('account:link:view')
            .setLabel('📋 View Linked Platforms')
            .setStyle(ButtonStyle.Secondary)
        );
      rows.push(row3);
    }

    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('account:main')
          .setLabel('← Back')
          .setStyle(ButtonStyle.Secondary)
      );
    rows.push(backRow);

    await interaction.editReply({
      embeds: [embed],
      components: rows
    });

  } catch (error) {
    logger.error('[AccountMenu] Error displaying link platform menu:', error);
    await interaction.editReply({
      content: '❌ Error loading platform linking menu.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Handles link platform sub-actions
 */
async function handleLinkPlatformSubAction(client, interaction, masterAccountId, dependencies, subAction) {
  const { logger } = dependencies;
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;

  switch (subAction) {
    case 'new':
      await interaction.editReply({
        content: '**Link New Platform**\n\n' +
          'Please use the `/link` command:\n' +
          '`/link <walletAddress>`\n\n' +
          'Example: `/link 0x1234567890abcdef1234567890abcdef12345678`',
        embeds: [],
        components: []
      });
      break;

    case 'requests':
      await displayPendingRequests(client, interaction, masterAccountId, dependencies);
      break;

    case 'sent':
      await displaySentRequests(client, interaction, masterAccountId, dependencies);
      break;

    case 'view':
      await displayLinkedPlatforms(client, interaction, masterAccountId, dependencies);
      break;

    default:
      logger.warn(`[AccountMenu] Unknown link sub-action: ${subAction}`);
  }
}

/**
 * Displays pending link requests
 */
async function displayPendingRequests(client, interaction, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;

  try {
    const linkRequestsRes = await apiClient.get(
      `/internal/v1/data/users/${masterAccountId}/link-requests?status=pending`
    );
    const linkRequests = linkRequestsRes.data;
    const received = linkRequests.received || [];

    if (received.length === 0) {
      await interaction.editReply({
        content: '✅ No pending requests.',
        embeds: [],
        components: []
      });
      return;
    }

    const request = received[0];
    const expiresDate = new Date(request.expiresAt);
    const expiresHuman = expiresDate.toLocaleString();

    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('📬 Link Request')
      .setDescription(
        `**${request.requestingPlatform}** user wants to link accounts.\n` +
        `Wallet: \`${request.targetWalletAddress.substring(0, 10)}...\`\n` +
        `Expires: ${expiresHuman}\n\n` +
        `This will merge accounts and share balance/history.`
      );

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`link:approve:${request.requestId}`)
          .setLabel('✅ Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`link:reject:${request.requestId}`)
          .setLabel('❌ Reject')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`link:report:${request.requestId}`)
          .setLabel('🚨 Report')
          .setStyle(ButtonStyle.Secondary)
      );

    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('account:link')
          .setLabel('← Back')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.editReply({
      embeds: [embed],
      components: [row, backRow]
    });

  } catch (error) {
    logger.error('[AccountMenu] Error displaying pending requests:', error);
    await interaction.editReply({
      content: '❌ Error loading requests.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Displays sent link requests with cancel option
 */
async function displaySentRequests(client, interaction, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;

  try {
    const linkRequestsRes = await apiClient.get(
      `/internal/v1/data/users/${masterAccountId}/link-requests?status=pending`
    );
    const linkRequests = linkRequestsRes.data;
    const sent = linkRequests.sent || [];

    if (sent.length === 0) {
      await interaction.editReply({
        content: '✅ No pending sent requests.',
        embeds: [],
        components: []
      });
      return;
    }

    // Show the first request with cancel option
    const request = sent[0];
    const expiresDate = new Date(request.expiresAt);
    const expiresHuman = expiresDate.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: 'numeric', 
      minute: '2-digit' 
    });
    const walletAbbr = request.targetWalletAddress.substring(0, 10) + '...';

    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('📤 Sent Link Request')
      .setDescription(
        `**Wallet:** \`${walletAbbr}\`\n` +
        `**Status:** Pending\n` +
        `**Expires:** ${expiresHuman}\n\n` +
        `Waiting for approval from the account owner.`
      );

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`link:cancel:${request.requestId}`)
          .setLabel('❌ Cancel This Request')
          .setStyle(ButtonStyle.Danger)
      );

    // Add "Cancel All" button if there are multiple requests
    const rows = [row];
    if (sent.length > 1) {
      const cancelAllRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('link:cancel-all')
            .setLabel(`🗑️ Cancel All (${sent.length})`)
            .setStyle(ButtonStyle.Danger)
        );
      rows.push(cancelAllRow);
    }

    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('account:link')
          .setLabel('← Back')
          .setStyle(ButtonStyle.Secondary)
      );
    rows.push(backRow);

    await interaction.editReply({
      embeds: [embed],
      components: [row, backRow]
    });

  } catch (error) {
    logger.error('[AccountMenu] Error displaying sent requests:', error);
    await interaction.editReply({
      content: '❌ Error loading sent requests.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Displays linked platforms
 */
async function displayLinkedPlatforms(client, interaction, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;

  try {
    const userRes = await apiClient.get(`/internal/v1/data/users/${masterAccountId}`);
    const user = userRes.data;
    const platformIdentities = user.platformIdentities || {};
    const linkedPlatforms = Object.keys(platformIdentities);

    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle('📋 Linked Platforms');

    let description = '';
    if (linkedPlatforms.length === 0) {
      description = 'No platforms linked.';
    } else {
      linkedPlatforms.forEach(platform => {
        const platformId = platformIdentities[platform];
        const displayId = platformId.length > 30 ? platformId.substring(0, 30) + '...' : platformId;
        description += `• **${platform}**: \`${displayId}\`\n`;
      });
    }

    embed.setDescription(description);

    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('account:link')
          .setLabel('← Back')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.editReply({
      embeds: [embed],
      components: [backRow]
    });

  } catch (error) {
    logger.error('[AccountMenu] Error displaying linked platforms:', error);
    await interaction.editReply({
      content: '❌ Error loading platforms.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Registers handlers for account menu
 */
function registerHandlers(dispatchers, dependencies) {
  const { buttonInteractionDispatcher } = dispatchers;

  // Register account menu button handler
  buttonInteractionDispatcher.register('account', handleAccountMenuInteraction);

  dependencies.logger.info('[AccountMenu] Account menu handlers registered');
}

module.exports = {
  registerHandlers,
  handleAccountMenuInteraction,
  displayLinkPlatformMenu,
  buildAccountMenu
};

