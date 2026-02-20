/**
 * Buy Points Manager for Discord
 * 
 * Handles the buy points flow, allowing users to purchase points via ETH contributions.
 * Matches Telegram's buyPointsManager functionality for platform parity.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ethers } = require('ethers');

// Utility: resolve canonical internalApiClient for this module
function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}


/**
 * Step 0 – entry point from /buypoints command or account button
 */
async function startFlow(interaction, masterAccountId, dependencies) {
    const { logger = console } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    if (!apiClient) {
        throw new Error('[BuyPoints] internalApiClient dependency missing');
    }

    try {
        const chainId = '1';
        // ETH zero address
        const ethAddress = '0x0000000000000000000000000000000000000000';
        const amountEth = '0.01';
        const amountWei = ethers.parseEther(amountEth).toString();

        const quote = (await apiClient.post('/internal/v1/data/points/quote', {
            type: 'token',
            assetAddress: ethAddress,
            amount: amountWei,
            mode: 'contribute'
        })).data;

        const { getFoundationAddress } = require('../../../core/services/alchemy/foundationConfig');
        let depositAddress;
        try {
            depositAddress = getFoundationAddress('1');
        } catch (_) {
            depositAddress = 'N/A';
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('💰 Purchase Points via Contribution')
            .setDescription(
                `Send native ETH directly to our foundation address:\n` +
                `\`${depositAddress}\`\n\n` +
                `Direct ETH transfers are counted as contributions and must be committed for point delivery.\n\n` +
                `For reference, sending 0.01 ETH right now would credit approximately **${quote.pointsCredited}** points.\n\n` +
                `For easier purchasing (better rates, zero gas), visit **noema.art**.`
            )
            .setFooter({ text: 'StationThis Discord Bot' })
            .setTimestamp();

        const cancelRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('buy:cancel')
                    .setLabel('Ⓧ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );

        // Handle both button interactions (already deferred) and command interactions
        if (interaction.deferred || interaction.replied) {
            // Button interaction or already-deferred command
            await interaction.editReply({
                embeds: [embed],
                components: [cancelRow]
            });
        } else {
            // Command interaction that hasn't been deferred yet
            await interaction.reply({
                embeds: [embed],
                components: [cancelRow],
                flags: 64 // Ephemeral
            });
        }

        logger.info(`[BuyPoints] Started flow for Discord user ${interaction.user.id}`);
    } catch (err) {
        logger.error('[BuyPoints] startFlow error', err.message);
        await interaction.editReply({
            content: '❌ Could not fetch quote.',
            embeds: [],
            components: []
        });
    }
}

/**
 * Handles button interactions for buy points flow
 */
async function handleBuyPointsButton(client, interaction, masterAccountId, dependencies) {
    const { logger = console } = dependencies;
    const customId = interaction.customId;
    const [, action] = customId.split(':');

    if (action === 'cancel') {
        await interaction.update({
            content: '✅ Cancelled.',
            embeds: [],
            components: []
        });
        return;
    }

    logger.warn('[BuyPoints] Unknown button action:', action);
    await interaction.update({
        content: '❌ Unknown action.',
        embeds: [],
        components: []
    });
}


/**
 * Handles the /buypoints command
 */
async function handleBuyPointsCommand(client, interaction, dependencies) {
    const { logger = console } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    if (!apiClient) {
        throw new Error('[BuyPoints] internalApiClient dependency missing');
    }

    try {
        // Defer immediately
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: 64 }); // Ephemeral
        }

        // Get masterAccountId
        const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
            platform: 'discord',
            platformId: interaction.user.id.toString(),
            platformContext: {
                username: interaction.user.username,
                discriminator: interaction.user.discriminator,
                globalName: interaction.user.globalName,
            }
        });
        
        const masterAccountId = findOrCreateResponse.data.masterAccountId;
        if (!masterAccountId) {
            await interaction.editReply({
                content: '❌ I couldn\'t identify your account. Please try again.',
                embeds: [],
                components: []
            });
            return;
        }

        await startFlow(interaction, masterAccountId, dependencies);
    } catch (error) {
        logger.error('[BuyPoints] Error in handleBuyPointsCommand:', error);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: '❌ An error occurred. Please try again later.',
                    embeds: [],
                    components: []
                });
            } else {
                await interaction.reply({
                    content: '❌ An error occurred. Please try again later.',
                    flags: 64
                });
            }
        } catch (replyError) {
            logger.error('[BuyPoints] Failed to send error response:', replyError);
        }
    }
}

/**
 * Registers all handlers for the buy points feature
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, buttonInteractionDispatcher } = dispatcherInstances;
    const { logger = console } = dependencies;

    if (!commandDispatcher || !buttonInteractionDispatcher) {
        logger.error('[BuyPoints] Dispatcher instances not provided. Cannot register handlers.');
        return;
    }

    // Register /buypoints command
    commandDispatcher.register('buypoints', handleBuyPointsCommand);

    // Register button handlers (all buy buttons start with 'buy:')
    buttonInteractionDispatcher.register('buy:', handleBuyPointsButton);

    logger.debug('[BuyPoints] Handlers registered.');
}

module.exports = {
    registerHandlers,
    startFlow,
    handleBuyPointsCommand
};

