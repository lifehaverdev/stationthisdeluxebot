/**
 * Discord Wallet Manager
 * 
 * Manages wallet linking and viewing for Discord, allowing users to connect
 * and manage their wallets. Mirrors the Telegram walletManager functionality.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ethers } = require('ethers');
const { FOUNDATION_ADDRESSES, getFoundationAddress, CHAIN_NAMES } = require('../../../core/services/alchemy/foundationConfig');

// Utility: resolve canonical internalApiClient for this module
function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}

/**
 * Fetches wallets for a user via the internal API.
 * @param {object} apiClient - The internal API client
 * @param {string} masterAccountId - The user's master account ID
 * @returns {Promise<Array>} Array of wallet objects
 */
async function fetchWallets(apiClient, masterAccountId) {
    try {
        const res = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/wallets`);
        return Array.isArray(res.data) ? res.data : [];
    } catch (_) {
        return [];
    }
}

/**
 * Abbreviates an Ethereum address for display.
 * @param {string} addr - Full Ethereum address
 * @returns {string} Abbreviated address (first 6 + last 4 chars)
 */
function abbreviate(addr) {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/**
 * Builds the main wallet menu embed and components.
 * @param {string} masterAccountId - The user's master account ID
 * @param {object} dependencies - The canonical dependencies object
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildWalletMenu(masterAccountId, dependencies) {
    const { logger = console } = dependencies || {};
    const apiClient = getApiClient(dependencies);
    
    if (!apiClient) {
        logger.error('[WalletManager] buildWalletMenu: apiClient missing');
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Wallet service unavailable. Please try again later.')
            .setColor(0xFF0000);
        return { embeds: [errorEmbed], components: [] };
    }
    
    const wallets = await fetchWallets(apiClient, masterAccountId);
    
    const embed = new EmbedBuilder()
        .setTitle('💼 Your Linked Wallets')
        .setColor(0x0099FF);
    
    if (wallets.length === 0) {
        embed.setDescription('No wallets connected yet. Click "Add Wallet" below to link one.');
    } else {
        const walletList = wallets.map((w, idx) => {
            const primaryTag = w.isPrimary ? ' ⭐ (primary)' : '';
            return `${idx + 1}. \`${abbreviate(w.address)}\`${primaryTag}`;
        }).join('\n');
        embed.setDescription(walletList);
    }
    
    const components = [];
    
    // Wallet buttons (if any wallets exist)
    if (wallets.length > 0) {
        // Discord limit: 5 action rows, 5 buttons per row = 25 buttons max
        // Use select menu if more than 25 wallets (unlikely but handle it)
        const MAX_WALLET_BUTTONS = 25;
        const walletsToShow = wallets.slice(0, MAX_WALLET_BUTTONS);
        
        // Group wallets into rows of 5 buttons
        for (let i = 0; i < walletsToShow.length; i += 5) {
            const row = new ActionRowBuilder();
            for (let j = i; j < Math.min(i + 5, walletsToShow.length); j++) {
                const wallet = walletsToShow[j];
                const label = abbreviate(wallet.address) + (wallet.isPrimary ? ' ⭐' : '');
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(label.length > 80 ? abbreviate(wallet.address) : label)
                        .setCustomId(`wallet_view_${wallet.address}`)
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            components.push(row);
        }
    }
    
    // Add Wallet button
    const addWalletRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('➕ Add Wallet')
                .setCustomId('wallet_add')
                .setStyle(ButtonStyle.Primary)
        );
    components.push(addWalletRow);
    
    return { embeds: [embed], components };
}

/**
 * Builds the wallet details view embed and components.
 * @param {string} masterAccountId - The user's master account ID
 * @param {string} walletAddress - The wallet address to view
 * @param {object} dependencies - The canonical dependencies object
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildWalletDetailsMenu(masterAccountId, walletAddress, dependencies) {
    const { logger = console } = dependencies || {};
    const apiClient = getApiClient(dependencies);
    
    if (!apiClient) {
        logger.error('[WalletManager] buildWalletDetailsMenu: apiClient missing');
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Wallet service unavailable. Please try again later.')
            .setColor(0xFF0000);
        return { embeds: [errorEmbed], components: [] };
    }
    
    try {
        const res = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/wallets/${walletAddress}`);
        const wallet = res.data;
        
        const embed = new EmbedBuilder()
            .setTitle('💼 Wallet Details')
            .addFields(
                { name: 'Address', value: `\`${wallet.address}\``, inline: false },
                { name: 'Primary', value: wallet.isPrimary ? 'Yes ⭐' : 'No', inline: true },
                { name: 'Verified', value: wallet.verified ? 'Yes ✅' : 'No', inline: true }
            )
            .setColor(0x0099FF);
        
        const components = [];
        const buttonRow = new ActionRowBuilder();
        
        // Add "Make Primary" button if not already primary
        if (!wallet.isPrimary) {
            buttonRow.addComponents(
                new ButtonBuilder()
                    .setLabel('⭐ Make Primary')
                    .setCustomId(`wallet_makeprimary_${wallet.address}`)
                    .setStyle(ButtonStyle.Primary)
            );
        }
        
        // Back button
        buttonRow.addComponents(
            new ButtonBuilder()
                .setLabel('⬅️ Back')
                .setCustomId('wallet_back')
                .setStyle(ButtonStyle.Secondary)
        );
        
        if (buttonRow.components.length > 0) {
            components.push(buttonRow);
        }
        
        return { embeds: [embed], components };
    } catch (err) {
        logger.error('[WalletManager] Failed to fetch wallet details:', err);
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Failed to fetch wallet details. Please try again.')
            .setColor(0xFF0000);
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('⬅️ Back')
                    .setCustomId('wallet_back')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        return { embeds: [errorEmbed], components: [backRow] };
    }
}

/**
 * Builds the magic link instructions embed.
 * @param {string} masterAccountId - The user's master account ID
 * @param {object} dependencies - The canonical dependencies object
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildMagicLinkInstructions(masterAccountId, dependencies) {
    const { logger = console } = dependencies || {};
    const apiClient = getApiClient(dependencies);
    
    if (!apiClient) {
        logger.error('[WalletManager] buildMagicLinkInstructions: apiClient missing');
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Wallet linking unavailable. Please try again later.')
            .setColor(0xFF0000);
        return { embeds: [errorEmbed], components: [] };
    }
    
    try {
        // Create magic amount linking request via INTERNAL API
        const resp = await apiClient.post(`/internal/v1/data/users/${masterAccountId}/wallets/requests/magic-amount`, {
            tokenAddress: '0x0000000000000000000000000000000000000000',
        });
        
        const { magicAmountWei, tokenAddress, expiresAt } = resp.data;
        const magicAmount = ethers.formatEther(magicAmountWei);
        
        // Default to Ethereum Mainnet (1)
        let depositToAddress;
        try {
            depositToAddress = getFoundationAddress('1');
        } catch (_) {
            depositToAddress = 'N/A';
        }
        
        const chainsText = Object.keys(FOUNDATION_ADDRESSES)
            .map(id => CHAIN_NAMES[id] || `Chain ${id}`)
            .join(', ');
        
        const expiresHuman = new Date(expiresAt).toLocaleTimeString();
        const tokenLabel = tokenAddress === '0x0000000000000000000000000000000000000000' ? 'ETH' : 'token';
        
        const embed = new EmbedBuilder()
            .setTitle('🔗 Wallet Linking Instructions')
            .setDescription(
                `Send **exactly** \`${magicAmount}\` ${tokenLabel} to:\n` +
                `\`${depositToAddress}\`\n\n` +
                `**Supported chains:** ${chainsText}\n\n` +
                `_Expires:_ ${expiresHuman}`
            )
            .setColor(0xFFA500);
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('⬅️ Back')
                    .setCustomId('wallet_back')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        logger.info(`[WalletManager] Magic linking initiated (masterAccountId=${masterAccountId}).`);
        
        return { embeds: [embed], components: [backRow] };
    } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message || 'Unknown error';
        logger.error('[WalletManager] initiate flow failed:', errMsg);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription(`Failed to start wallet-link flow: ${errMsg}`)
            .setColor(0xFF0000);
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('⬅️ Back')
                    .setCustomId('wallet_back')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        return { embeds: [errorEmbed], components: [backRow] };
    }
}

/**
 * Handles the /wallet slash command.
 * @param {object} client - Discord client instance
 * @param {object} interaction - Discord interaction
 * @param {object} dependencies - The canonical dependencies object
 */
async function walletCommandHandler(client, interaction, dependencies) {
    const { logger } = dependencies;
    
    // CRITICAL: Defer immediately (within 3 seconds)
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
    }
    
    try {
        logger.info(`[WalletManager] /wallet command received from Discord User ID: ${interaction.user.id}`);
        
        // Get or create master account ID
        const apiClient = getApiClient(dependencies);
        if (!apiClient) {
            throw new Error('[WalletManager] internalApiClient dependency missing');
        }
        
        const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
            platform: 'discord',
            platformId: interaction.user.id.toString(),
            platformContext: { 
                username: interaction.user.username,
                discriminator: interaction.user.discriminator
            }
        });
        const masterAccountId = findOrCreateResponse.data.masterAccountId;
        
        const wallets = await fetchWallets(apiClient, masterAccountId);
        
        let menu;
        if (wallets.length > 0) {
            menu = await buildWalletMenu(masterAccountId, dependencies);
        } else {
            // No wallets, show magic link instructions
            menu = await buildMagicLinkInstructions(masterAccountId, dependencies);
        }
        
        await interaction.editReply({
            embeds: menu.embeds,
            components: menu.components
        });
    } catch (error) {
        logger.error(`[WalletManager] Critical error in walletCommandHandler:`, error.stack || error);
        await interaction.editReply({
            content: 'A critical error occurred while handling your command.',
            embeds: [],
            components: []
        });
    }
}

/**
 * Handles button interactions for the wallet menu.
 * @param {object} client - Discord client instance
 * @param {object} interaction - Discord button interaction
 * @param {string} masterAccountId - The user's master account ID (provided by dispatcher)
 * @param {object} dependencies - The canonical dependencies object
 */
async function walletButtonHandler(client, interaction, masterAccountId, dependencies) {
    const { logger = console } = dependencies || {};
    const customId = interaction?.customId;
    
    if (!customId) {
        logger.error('[WalletManager] Button interaction missing customId');
        return;
    }
    
    if (!masterAccountId) {
        logger.error('[WalletManager] masterAccountId not provided by dispatcher');
        return;
    }
    
    // CRITICAL: Defer immediately (within 3 seconds)
    if (!interaction.deferred && !interaction.replied) {
        try {
            await interaction.deferUpdate();
        } catch (deferError) {
            logger.error('[WalletManager] Failed to defer update:', deferError);
            return;
        }
    }
    
    try {
        logger.info(`[WalletManager] Button interaction received: '${customId}' from ${interaction.user?.id}, MAID: ${masterAccountId}`);
        
        let menu;
        
        if (customId === 'wallet_add') {
            // Show magic link instructions
            menu = await buildMagicLinkInstructions(masterAccountId, dependencies);
        } else if (customId.startsWith('wallet_view_')) {
            // View wallet details
            const walletAddress = customId.substring('wallet_view_'.length);
            menu = await buildWalletDetailsMenu(masterAccountId, walletAddress, dependencies);
        } else if (customId === 'wallet_back') {
            // Back to main wallet menu
            menu = await buildWalletMenu(masterAccountId, dependencies);
        } else if (customId.startsWith('wallet_makeprimary_')) {
            // Set wallet as primary
            const walletAddress = customId.substring('wallet_makeprimary_'.length);
            const apiClient = getApiClient(dependencies);
            
            if (!apiClient) {
                throw new Error('[WalletManager] internalApiClient dependency missing');
            }
            
            try {
                await apiClient.put(`/internal/v1/data/users/${masterAccountId}/wallets/${walletAddress}`, { 
                    isPrimary: true 
                });
                
                // Refresh the wallet menu
                menu = await buildWalletMenu(masterAccountId, dependencies);
                logger.info(`[WalletManager] Set wallet ${walletAddress} as primary for MAID ${masterAccountId}`);
            } catch (err) {
                const msg = err.response?.data?.error?.message || 'Failed to set primary';
                logger.error(`[WalletManager] Failed to set primary: ${msg}`);
                
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setDescription(msg)
                    .setColor(0xFF0000);
                
                const backRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('⬅️ Back')
                            .setCustomId('wallet_back')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                menu = { embeds: [errorEmbed], components: [backRow] };
            }
        } else {
            logger.warn(`[WalletManager] Unhandled button callback: ${customId}`);
            await interaction.editReply({
                content: 'Action not implemented yet.',
                embeds: [],
                components: []
            });
            return;
        }
        
        if (menu && menu.embeds && menu.components) {
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else {
            logger.warn('[WalletManager] Menu is missing embeds or components');
            await interaction.editReply({
                content: 'Error: Could not build menu. Please try again.',
                embeds: [],
                components: []
            });
        }
    } catch (error) {
        logger.error('[WalletManager] Error in walletButtonHandler:', error);
        logger.error('[WalletManager] Error stack:', error?.stack);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: 'Error processing action. Please try again.',
                    embeds: [],
                    components: []
                });
            } else {
                await interaction.reply({
                    content: 'Error processing action. Please try again.',
                    flags: 64
                });
            }
        } catch (replyError) {
            logger.error('[WalletManager] Failed to send error response:', replyError);
        }
    }
}

/**
 * Registers all handlers for the wallet menu feature.
 * @param {object} dispatcherInstances - The dispatcher instances object.
 * @param {CommandDispatcher} dispatcherInstances.commandDispatcher - The command dispatcher.
 * @param {ButtonInteractionDispatcher} dispatcherInstances.buttonInteractionDispatcher - The button interaction dispatcher.
 * @param {object} dependencies - The dependencies needed by the handlers.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, buttonInteractionDispatcher } = dispatcherInstances;
    const { logger } = dependencies;
    
    if (!commandDispatcher || !buttonInteractionDispatcher) {
        logger.error('[WalletManager] Dispatcher instances not provided. Cannot register handlers.');
        return;
    }
    
    // Register the command handler
    commandDispatcher.register('wallet', walletCommandHandler);
    
    // Register button handlers (all wallet buttons start with 'wallet_')
    buttonInteractionDispatcher.register('wallet_', walletButtonHandler);
    
    logger.debug('[WalletManager] Handlers registered.');
}

module.exports = {
    registerHandlers,
    buildWalletMenu
};

