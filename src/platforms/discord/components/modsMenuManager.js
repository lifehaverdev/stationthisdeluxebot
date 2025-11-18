/**
 * Mods Menu Manager for Discord
 * 
 * Handles the display and interaction logic for Mod-related menus.
 * Mirrors the Telegram modsMenuManager functionality.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

// Utility: resolve canonical internalApiClient for this module
function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}

const AVAILABLE_CHECKPOINTS = ['All', 'SDXL', 'SD1.5', 'FLUX'];
const VALID_CHECKPOINTS = ['SD1.5', 'SDXL', 'FLUX', 'SD3'];

// Map for shortening callback data
const FILTER_SHORTCODE_MAP = {
    'type_character': 'char',
    'type_style': 'style',
    'popular': 'pop',
    'recent': 'rec',
    'favorites': 'fav',
};

const FILTER_FROM_SHORTCODE_MAP = Object.fromEntries(
    Object.entries(FILTER_SHORTCODE_MAP).map(([key, value]) => [value, key])
);

function getFilterShortcode(filterType) {
    return FILTER_SHORTCODE_MAP[filterType] || filterType;
}

function getFilterFromShortcode(shortcode) {
    return FILTER_FROM_SHORTCODE_MAP[shortcode] || shortcode;
}

/**
 * Handles the /mods command.
 */
async function handleModsCommand(client, interaction, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    try {
        await interaction.deferReply({ flags: 64 }); // Ephemeral
        
        // Get master account ID
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
        
        const menu = await buildModsMainMenu(masterAccountId, dependencies);
        await interaction.editReply({
            embeds: menu.embeds,
            components: menu.components
        });
    } catch (error) {
        logger.error('[ModsMenuManager] Error in handleModsCommand:', error);
        try {
            await interaction.editReply({
                content: '❌ Error loading Mods menu. Please try again later.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.error('[ModsMenuManager] Failed to send error reply:', replyError);
        }
    }
}

/**
 * Builds the main Mods menu.
 */
async function buildModsMainMenu(masterAccountId, dependencies) {
    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎭 Mod Categories')
        .setDescription('Select a category to explore Mods:');

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mods:category:char:All:1')
                .setLabel('🎭 Character')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('mods:category:style:All:1')
                .setLabel('🖼 Style')
                .setStyle(ButtonStyle.Primary)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mods:category:pop:All:1')
                .setLabel('🔥 Popular')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('mods:category:rec:All:1')
                .setLabel('⏳ Recent')
                .setStyle(ButtonStyle.Secondary)
        );

    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mods_store:main_menu')
                .setLabel('🛍️ Mod Store')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('mods:category:fav:All:1')
                .setLabel('💖 Favorites')
                .setStyle(ButtonStyle.Secondary)
        );

    const row4 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mods:request_form')
                .setLabel('📝 Import Mod')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('mods:nvm')
                .setLabel('❌ Close')
                .setStyle(ButtonStyle.Danger)
        );

    return {
        embeds: [embed],
        components: [row1, row2, row3, row4]
    };
}

/**
 * Handles button interactions for mods menu.
 */
async function handleModsButtonInteraction(client, interaction, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    // Get masterAccountId if not provided (from interaction context)
    let actualMasterAccountId = masterAccountId;
    if (!actualMasterAccountId) {
        try {
            const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
                platform: 'discord',
                platformId: interaction.user.id.toString(),
                platformContext: {
                    username: interaction.user.username,
                    discriminator: interaction.user.discriminator,
                    globalName: interaction.user.globalName
                }
            });
            actualMasterAccountId = findOrCreateResponse.data.masterAccountId;
        } catch (error) {
            logger.error('[ModsMenuManager] Error getting masterAccountId:', error);
            await interaction.reply({ content: '❌ Error identifying user.', flags: 64 });
            return;
        }
    }
    
    try {
        // Check if interaction is already deferred (bot.js defers it)
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        
        const [action, subAction, ...params] = interaction.customId.split(':');
        
        if (subAction === 'main_menu') {
            const menu = await buildModsMainMenu(actualMasterAccountId, dependencies);
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else if (subAction === 'category') {
            const [filterShortcode, checkpoint, pageStr] = params;
            const page = parseInt(pageStr, 10) || 1;
            const filterType = getFilterFromShortcode(filterShortcode);
            const menu = await buildModsByFilterScreen(actualMasterAccountId, filterType, checkpoint, page, dependencies);
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else if (subAction === 'detail') {
            const [loraIdentifier, backFilterShortcode, backCheckpoint, backPageStr] = params;
            const backPage = parseInt(backPageStr, 10) || 1;
            const backFilterType = getFilterFromShortcode(backFilterShortcode);
            const menu = await buildModDetailScreen(actualMasterAccountId, loraIdentifier, backFilterType, backCheckpoint, backPage, dependencies);
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else if (subAction === 'toggle_favorite') {
            const [currentFavoriteStatusStr, loraMongoId, backFilterShortcode, backCheckpoint, backPageStr] = params;
            const isCurrentlyFavorite = currentFavoriteStatusStr === 'true';
            const backPage = parseInt(backPageStr, 10) || 1;
            const backFilterType = getFilterFromShortcode(backFilterShortcode);
            
            try {
                if (isCurrentlyFavorite) {
                    await apiClient.delete(`/internal/v1/data/loras/${loraMongoId}/favorite`, {
                        data: { masterAccountId: actualMasterAccountId }
                    });
                    await interaction.followUp({
                        content: 'Removed from favorites 💔',
                        flags: 64
                    });
                } else {
                    await apiClient.post(`/internal/v1/data/loras/${loraMongoId}/favorite`, {
                        masterAccountId: actualMasterAccountId
                    });
                    await interaction.followUp({
                        content: 'Added to favorites! ❤️',
                        flags: 64
                    });
                }
                // Refresh the detail screen
                const menu = await buildModDetailScreen(actualMasterAccountId, loraMongoId, backFilterType, backCheckpoint, backPage, dependencies);
                await interaction.editReply({
                    embeds: menu.embeds,
                    components: menu.components
                });
            } catch (favError) {
                logger.error(`[ModsMenuManager] Error toggling favorite:`, favError);
                await interaction.followUp({
                    content: '❌ Error updating favorites.',
                    flags: 64
                });
            }
        } else if (subAction === 'nvm') {
            await interaction.editReply({
                content: 'Mods menu closed.',
                embeds: [],
                components: []
            });
        } else if (subAction === 'request_form') {
            await interaction.editReply({
                content: '📝 **Import Mod**\n\nPlease reply to this message with a Mod URL (Civitai, HuggingFace, etc.) to import.',
                embeds: [],
                components: []
            });
            // Store context for reply handler
            const replyContextManager = dependencies.replyContextManager;
            if (replyContextManager) {
                replyContextManager.setContext(interaction.user.id, {
                    type: 'mod_import_url',
                    masterAccountId: actualMasterAccountId,
                    originalMessageId: interaction.message.id
                });
            }
        } else {
            logger.warn(`[ModsMenuManager] Unknown subAction: ${subAction}`);
        }
    } catch (error) {
        logger.error('[ModsMenuManager] Error in handleModsButtonInteraction:', error);
        try {
            await interaction.editReply({
                content: '❌ Error processing request.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.error('[ModsMenuManager] Failed to send error reply:', replyError);
        }
    }
}

/**
 * Builds the mods list screen by filter.
 */
async function buildModsByFilterScreen(masterAccountId, filterType, currentCheckpoint, currentPage, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    // Sanitize filterType for display
    let displayFilterName = filterType.replace(/^type_/, '');
    displayFilterName = displayFilterName.charAt(0).toUpperCase() + displayFilterName.slice(1);
    
    let title = `${displayFilterName} Mods`;
    if (currentCheckpoint !== 'All') {
        title += ` (${currentCheckpoint})`;
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(title);
    
    try {
        // Build API query params - match Telegram's implementation
        const params = {
            filterType: filterType,
            checkpoint: currentCheckpoint,
            page: currentPage,
            limit: 25, // Discord select menu limit
            userId: masterAccountId
        };
        
        logger.info(`[ModsMenuManager] Calling /internal/v1/data/loras/list with params: filterType=${filterType}&checkpoint=${currentCheckpoint}&page=${currentPage}&limit=25&userId=${masterAccountId}`);
        
        const response = await apiClient.get('/internal/v1/data/loras/list', { params });
        const responseData = response.data;
        const loras = responseData?.loras || [];
        const totalPages = responseData?.pagination?.totalPages || 1;
        
        if (loras.length === 0) {
            embed.setDescription('No Mods found in this category.');
        } else {
            // Create select menu for mods
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`mods:select:${getFilterShortcode(filterType)}:${currentCheckpoint}:${currentPage}`)
                .setPlaceholder('Select a Mod to view details...')
                .setMinValues(1)
                .setMaxValues(1);
            
            loras.forEach((lora, index) => {
                const label = lora.name || `Mod ${index + 1}`;
                const value = `${lora._id || lora.id}:${getFilterShortcode(filterType)}:${currentCheckpoint}:${currentPage}`;
                
                // Build option object - only include description if it exists and is not empty
                const option = {
                    label: label.length > 100 ? label.substring(0, 97) + '...' : label,
                    value: value.length > 100 ? value.substring(0, 100) : value
                };
                
                // Only add description if it exists and is not empty (Discord.js validation requirement)
                if (lora.description && lora.description.trim().length > 0) {
                    const description = lora.description.length > 100 ? lora.description.substring(0, 97) + '...' : lora.description;
                    option.description = description;
                }
                
                selectMenu.addOptions(option);
            });
            
            const components = [
                new ActionRowBuilder().addComponents(selectMenu)
            ];
            
            // Checkpoint filter buttons
            const checkpointRow = new ActionRowBuilder();
            AVAILABLE_CHECKPOINTS.forEach(cp => {
                checkpointRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`mods:category:${getFilterShortcode(filterType)}:${cp}:1`)
                        .setLabel(cp === currentCheckpoint ? `✅ ${cp}` : cp)
                        .setStyle(cp === currentCheckpoint ? ButtonStyle.Success : ButtonStyle.Secondary)
                );
            });
            components.push(checkpointRow);
            
            // Navigation buttons
            const navRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('mods:main_menu')
                        .setLabel('← Back to Categories')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('mods:nvm')
                        .setLabel('❌ Close')
                        .setStyle(ButtonStyle.Danger)
                );
            components.push(navRow);
            
            embed.setDescription(`Found ${loras.length} Mod${loras.length !== 1 ? 's' : ''}. Select one to view details.`);
            
            return {
                embeds: [embed],
                components
            };
        }
    } catch (error) {
        logger.error('[ModsMenuManager] Error fetching mods:', error);
        embed.setDescription('❌ Error loading Mods. Please try again later.');
    }
    
    // Fallback: return menu with error or empty state
    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mods:main_menu')
                .setLabel('← Back to Categories')
                .setStyle(ButtonStyle.Secondary)
        );
    
    return {
        embeds: [embed],
        components: [backRow]
    };
}

/**
 * Handles select menu interactions for mods.
 */
async function handleModsSelectMenuInteraction(client, interaction, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    // Get masterAccountId if not provided
    let actualMasterAccountId = masterAccountId;
    if (!actualMasterAccountId) {
        try {
            const findOrCreateResponse = await apiClient.post('/internal/v1/data/users/find-or-create', {
                platform: 'discord',
                platformId: interaction.user.id.toString(),
                platformContext: {
                    username: interaction.user.username,
                    discriminator: interaction.user.discriminator,
                    globalName: interaction.user.globalName
                }
            });
            actualMasterAccountId = findOrCreateResponse.data.masterAccountId;
        } catch (error) {
            logger.error('[ModsMenuManager] Error getting masterAccountId:', error);
            await interaction.reply({ content: '❌ Error identifying user.', flags: 64 });
            return;
        }
    }
    
    try {
        // Check if interaction is already deferred (bot.js defers it)
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        
        const [action, subAction, filterShortcode, checkpoint, pageStr] = interaction.customId.split(':');
        const selectedValue = interaction.values[0];
        const [loraIdentifier, ...backParams] = selectedValue.split(':');
        
        const backFilterType = getFilterFromShortcode(filterShortcode);
        const backCheckpoint = checkpoint || 'All';
        const backPage = parseInt(pageStr, 10) || 1;
        
        const menu = await buildModDetailScreen(actualMasterAccountId, loraIdentifier, backFilterType, backCheckpoint, backPage, dependencies);
        await interaction.editReply({
            embeds: menu.embeds,
            components: menu.components
        });
    } catch (error) {
        logger.error('[ModsMenuManager] Error in handleModsSelectMenuInteraction:', error);
        try {
            await interaction.editReply({
                content: '❌ Error loading Mod details.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.error('[ModsMenuManager] Failed to send error reply:', replyError);
        }
    }
}

/**
 * Builds the mod detail screen.
 */
async function buildModDetailScreen(masterAccountId, loraIdentifier, backFilterType, backCheckpoint, backPage, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    
    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎭 Mod Details');
    
    try {
        logger.info(`[ModsMenuManager] Calling /internal/v1/data/loras/${loraIdentifier}?userId=${masterAccountId}`);
        const response = await apiClient.get(`/internal/v1/data/loras/${loraIdentifier}`, {
            params: { userId: masterAccountId }
        });
        const lora = response.data?.lora || response.data;
        
        if (!lora) {
            embed.setDescription('❌ Mod not found.');
        } else {
            embed.setTitle(`🎭 ${lora.name || 'Unknown Mod'}`);
            
            // Description (strip HTML if needed, limit to 4096 chars for embed)
            if (lora.description) {
                // Simple HTML stripping for Discord (basic tags)
                let cleanedDesc = lora.description.replace(/<[^>]*>/g, '');
                cleanedDesc = cleanedDesc.substring(0, 4096);
                embed.setDescription(cleanedDesc);
            }
            
            // Add fields
            const fields = [];
            if (lora.checkpoint) {
                fields.push({ name: 'Checkpoint', value: lora.checkpoint, inline: true });
            }
            if (lora.type) {
                fields.push({ name: 'Type', value: lora.type, inline: true });
            }
            
            // Trigger words
            if (lora.triggerWords && lora.triggerWords.length > 0) {
                let triggers = lora.triggerWords.join(', ');
                if (triggers.length > 1024) triggers = triggers.substring(0, 1021) + '...';
                fields.push({ name: '🎯 Triggers', value: triggers, inline: false });
            }
            
            // Cognates (shortcuts)
            if (lora.cognates && lora.cognates.length > 0) {
                const cognateWords = lora.cognates.map(c => c.word).join(', ');
                const shortcuts = cognateWords.length > 1024 ? cognateWords.substring(0, 1021) + '...' : cognateWords;
                fields.push({ name: '⚡ Shortcuts', value: shortcuts, inline: false });
            }
            
            // Tags
            if (lora.tags && lora.tags.length > 0) {
                const tags = lora.tags.slice(0, 10).map(t => t.tag || t).join(', ');
                const tagsText = tags.length > 1024 ? tags.substring(0, 1021) + '...' : tags;
                fields.push({ name: '🏷️ Tags', value: tagsText, inline: false });
            }
            
            // Default weight
            if (lora.defaultWeight !== undefined && lora.defaultWeight !== null) {
                fields.push({ name: '⚖️ Default Weight', value: String(lora.defaultWeight), inline: true });
            }
            
            // Handle rating - can be a number or an object with avg property
            if (lora.rating) {
                let ratingValue;
                if (typeof lora.rating === 'number') {
                    ratingValue = lora.rating.toFixed(1);
                } else if (lora.rating.avg !== undefined) {
                    ratingValue = Number(lora.rating.avg).toFixed(1);
                } else {
                    ratingValue = 'N/A';
                }
                fields.push({ name: '⭐ Rating', value: ratingValue, inline: true });
            }
            
            if (fields.length > 0) {
                embed.addFields(fields);
            }
            
            // Add preview image if available (prefer previewImages over imageUrl/thumbnailUrl)
            let imageUrl = null;
            if (lora.previewImages && lora.previewImages.length > 0) {
                const firstImage = lora.previewImages[0];
                if (typeof firstImage === 'string' && (firstImage.startsWith('http://') || firstImage.startsWith('https://'))) {
                    imageUrl = firstImage;
                }
            }
            if (!imageUrl && (lora.imageUrl || lora.thumbnailUrl)) {
                imageUrl = lora.imageUrl || lora.thumbnailUrl;
            }
            if (imageUrl) {
                embed.setImage(imageUrl);
            }
        }
        
        // Build buttons
        const buttons = [];
        
        // Favorite button
        const isFavorite = lora?.isFavorite || false;
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`mods:toggle_favorite:${isFavorite}:${lora._id || lora.id}:${getFilterShortcode(backFilterType)}:${backCheckpoint}:${backPage}`)
                .setLabel(isFavorite ? '💖 Remove from Favorites' : '🤍 Add to Favorites')
                .setStyle(isFavorite ? ButtonStyle.Danger : ButtonStyle.Success)
        );
        
        // Back button
        const backFilterShortcode = getFilterShortcode(backFilterType);
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`mods:category:${backFilterShortcode}:${backCheckpoint}:${backPage}`)
                .setLabel('← Back to List')
                .setStyle(ButtonStyle.Secondary)
        );
        
        // Close button
        buttons.push(
            new ButtonBuilder()
                .setCustomId('mods:nvm')
                .setLabel('❌ Close')
                .setStyle(ButtonStyle.Danger)
        );
        
        const row = new ActionRowBuilder().addComponents(buttons);
        
        return {
            embeds: [embed],
            components: [row]
        };
    } catch (error) {
        logger.error('[ModsMenuManager] Error fetching mod details:', error);
        embed.setDescription('❌ Error loading Mod details.');
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`mods:category:${getFilterShortcode(backFilterType)}:${backCheckpoint}:${backPage}`)
                    .setLabel('← Back to List')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        return {
            embeds: [embed],
            components: [backRow]
        };
    }
}

/**
 * Handles message replies for mod import.
 */
async function handleModImportReply(client, message, context, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    const { masterAccountId } = context;
    
    try {
        const url = message.content.trim();
        
        // Basic URL validation
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            await message.reply('❌ Please provide a valid URL.');
            return;
        }
        
        // Call import API
        await apiClient.post('/internal/v1/data/loras/import', {
            url,
            masterAccountId
        });
        
        await message.reply('✅ Mod import request submitted! The Mod will be processed and added to the collection.');
    } catch (error) {
        logger.error('[ModsMenuManager] Error importing mod:', error);
        const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
        await message.reply(`❌ Error importing Mod: ${errorMsg}`);
    }
}

/**
 * Registers all handlers for the mods menu feature.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const apiClient = getApiClient(dependencies);
    if (!apiClient) {
        throw new Error('[ModsMenuManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;
    
    const { commandDispatcher, buttonInteractionDispatcher, selectMenuInteractionDispatcher, messageReplyDispatcher } = dispatcherInstances;
    const { logger } = dependencies;
    
    // Register command handler
    commandDispatcher.register('mods', handleModsCommand);
    
    // Register button handlers
    buttonInteractionDispatcher.register('mods', handleModsButtonInteraction);
    buttonInteractionDispatcher.register('mods_store', handleModsButtonInteraction); // Mod store uses same handler
    
    // Register select menu handler
    selectMenuInteractionDispatcher.register('mods:select', handleModsSelectMenuInteraction);
    
    // Register message reply handler
    messageReplyDispatcher.register('mod_import_url', handleModImportReply);
    
    logger.info('[ModsMenuManager] All handlers registered.');
}

module.exports = {
    registerHandlers
};

