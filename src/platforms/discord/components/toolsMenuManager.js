/**
 * Tools Menu Manager for Discord
 * 
 * Handles the display and interaction logic for Tools browsing.
 * Mirrors the Telegram toolsMenuManager functionality.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

// Utility: resolve canonical internalApiClient for this module
function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}

/**
 * Fetches most frequently used tools for a user via internal API.
 */
async function getMostFrequentlyUsedTools(masterAccountId, dependencies) {
    const { logger } = dependencies;
    try {
        const apiClient = getApiClient(dependencies);
        if (!apiClient) throw new Error('internalApiClient missing');
        const res = await apiClient.get(`/internal/v1/data/generations/users/${masterAccountId}/most-frequent-tools`, { 
            params: { limit: 12 } 
        });
        return (res.data?.frequentTools || []).slice(0, 5);
    } catch (err) {
        dependencies.logger?.error('[ToolsMenu] frequent tools error', err.message);
        return [];
    }
}

/**
 * Handles the /tools command.
 */
async function handleToolsCommand(client, interaction, dependencies) {
    const { logger, toolRegistry } = dependencies;
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
        
        const menu = await buildMainMenu(masterAccountId, dependencies);
        await interaction.editReply({
            embeds: menu.embeds,
            components: menu.components
        });
    } catch (error) {
        logger.error('[ToolsMenuManager] Error in handleToolsCommand:', error);
        try {
            await interaction.editReply({
                content: '❌ Error loading Tools menu. Please try again later.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.error('[ToolsMenuManager] Failed to send error reply:', replyError);
        }
    }
}

/**
 * Builds the main Tools menu.
 */
async function buildMainMenu(masterAccountId, dependencies) {
    const { toolRegistry } = dependencies;
    
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🛠️ Tools')
        .setDescription('Browse available tools.');
    
    const components = [];
    
    // "All Tools" button
    const allToolsRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('tool_all')
                .setLabel('📋 All Tools')
                .setStyle(ButtonStyle.Primary)
        );
    components.push(allToolsRow);
    
    // Most frequently used tools
    const frequent = await getMostFrequentlyUsedTools(masterAccountId, dependencies);
    if (frequent.length > 0) {
        const frequentTools = [];
        for (const freqTool of frequent) {
            const tool = toolRegistry.getToolById(freqTool.toolId);
            if (tool) {
                frequentTools.push(tool);
            }
        }
        
        if (frequentTools.length > 0) {
            // Create select menu for frequent tools (max 25 options)
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('tool_select_frequent')
                .setPlaceholder('Select a frequently used tool...')
                .setMinValues(1)
                .setMaxValues(1);
            
            frequentTools.slice(0, 25).forEach(tool => {
                const displayName = tool.displayName || 'Unknown Tool';
                selectMenu.addOptions({
                    label: displayName.length > 100 ? displayName.substring(0, 97) + '...' : displayName,
                    value: `tool_view_${displayName.replace(/\s+/g, '_')}`,
                    description: tool.description ? 
                        (tool.description.length > 100 ? tool.description.substring(0, 97) + '...' : tool.description) : 
                        ''
                });
            });
            
            components.push(new ActionRowBuilder().addComponents(selectMenu));
            
            embed.addFields({
                name: '🔥 Frequently Used',
                value: `${frequentTools.length} tool${frequentTools.length !== 1 ? 's' : ''} available`,
                inline: false
            });
        }
    }
    
    // Close button
    const closeRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('tool_nvm')
                .setLabel('❌ Close')
                .setStyle(ButtonStyle.Danger)
        );
    components.push(closeRow);
    
    return {
        embeds: [embed],
        components
    };
}

/**
 * Builds the "All Tools" menu using select menu.
 */
async function buildAllToolsMenu(masterAccountId, dependencies) {
    const { toolRegistry } = dependencies;
    
    // Get all tools, filter out API/COOK tools
    const allTools = toolRegistry.getAllTools()
        .filter(t => !t.displayName.includes('_API') && !t.displayName.includes('_COOK'))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📋 All Tools')
        .setDescription(`Found ${allTools.length} tool${allTools.length !== 1 ? 's' : ''}. Select one to view details.`);
    
    const components = [];
    
    // Discord select menus can hold up to 25 options
    // If we have more than 25 tools, we'll need multiple select menus (up to 5 rows)
    const MAX_SELECT_OPTIONS = 25;
    const MAX_SELECT_MENUS = 5;
    const totalSelectMenus = Math.min(Math.ceil(allTools.length / MAX_SELECT_OPTIONS), MAX_SELECT_MENUS);
    
    for (let menuIndex = 0; menuIndex < totalSelectMenus; menuIndex++) {
        const startIndex = menuIndex * MAX_SELECT_OPTIONS;
        const endIndex = Math.min(startIndex + MAX_SELECT_OPTIONS, allTools.length);
        const toolsSlice = allTools.slice(startIndex, endIndex);
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`tool_select_all_${menuIndex}`)
            .setPlaceholder(
                totalSelectMenus > 1 
                    ? `Select a tool... (${startIndex + 1}-${endIndex} of ${allTools.length})` 
                    : 'Select a tool...'
            )
            .setMinValues(1)
            .setMaxValues(1);
        
        toolsSlice.forEach(tool => {
            const displayName = tool.displayName || 'Unknown Tool';
            selectMenu.addOptions({
                label: displayName.length > 100 ? displayName.substring(0, 97) + '...' : displayName,
                value: `tool_view_${displayName.replace(/\s+/g, '_')}`,
                description: tool.description ? 
                    (tool.description.length > 100 ? tool.description.substring(0, 97) + '...' : tool.description) : 
                    ''
            });
        });
        
        components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
    
    // Navigation buttons
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('tool_main')
                .setLabel('← Back to Main Menu')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('tool_nvm')
                .setLabel('❌ Close')
                .setStyle(ButtonStyle.Danger)
        );
    components.push(navRow);
    
    return {
        embeds: [embed],
        components
    };
}

/**
 * Builds the tool detail view.
 */
async function buildToolDetailMenu(displayName, dependencies) {
    const { toolRegistry } = dependencies;
    
    const tool = toolRegistry.findByDisplayName(displayName);
    
    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🛠️ Tool Details');
    
    if (!tool) {
        embed.setDescription('❌ Tool not found.');
    } else {
        embed.setTitle(`🛠️ ${tool.displayName || 'Unknown Tool'}`);
        if (tool.description) {
            embed.setDescription(tool.description.substring(0, 4096));
        }
        
        // Add tool parameters if available
        if (tool.parameters && Array.isArray(tool.parameters) && tool.parameters.length > 0) {
            const paramsList = tool.parameters
                .slice(0, 10) // Limit to first 10 parameters
                .map(param => {
                    const paramName = param.name || 'Unknown';
                    const paramType = param.type || 'string';
                    const required = param.required ? ' (required)' : '';
                    return `• **${paramName}**: ${paramType}${required}`;
                })
                .join('\n');
            
            if (paramsList) {
                embed.addFields({
                    name: 'Parameters',
                    value: paramsList.length > 1024 ? paramsList.substring(0, 1021) + '...' : paramsList,
                    inline: false
                });
            }
        }
    }
    
    // Navigation buttons
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('tool_main')
                .setLabel('← Back to Main Menu')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('tool_nvm')
                .setLabel('❌ Close')
                .setStyle(ButtonStyle.Danger)
        );
    
    return {
        embeds: [embed],
        components: [navRow]
    };
}

/**
 * Handles button interactions for tools menu.
 */
async function handleToolsButtonInteraction(client, interaction, masterAccountId, dependencies) {
    const { logger } = dependencies;
    
    try {
        // Check if interaction is already deferred (bot.js defers it)
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        
        const customId = interaction.customId;
        
        if (customId === 'tool_nvm') {
            await interaction.editReply({
                content: 'Tools menu closed.',
                embeds: [],
                components: []
            });
        } else if (customId === 'tool_main') {
            const menu = await buildMainMenu(masterAccountId, dependencies);
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else if (customId === 'tool_all') {
            const menu = await buildAllToolsMenu(masterAccountId, dependencies);
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else {
            logger.warn(`[ToolsMenuManager] Unknown button customId: ${customId}`);
        }
    } catch (error) {
        logger.error('[ToolsMenuManager] Error in handleToolsButtonInteraction:', error);
        try {
            await interaction.editReply({
                content: '❌ Error processing request.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.error('[ToolsMenuManager] Failed to send error reply:', replyError);
        }
    }
}

/**
 * Handles select menu interactions for tools.
 */
async function handleToolsSelectMenuInteraction(client, interaction, masterAccountId, dependencies) {
    const { logger } = dependencies;
    
    try {
        // Check if interaction is already deferred (bot.js defers it)
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        
        const selectedValue = interaction.values[0];
        
        if (selectedValue.startsWith('tool_view_')) {
            const displayName = selectedValue.substring('tool_view_'.length).replace(/_/g, ' ');
            const menu = await buildToolDetailMenu(displayName, dependencies);
            await interaction.editReply({
                embeds: menu.embeds,
                components: menu.components
            });
        } else {
            logger.warn(`[ToolsMenuManager] Unknown select menu value: ${selectedValue}`);
        }
    } catch (error) {
        logger.error('[ToolsMenuManager] Error in handleToolsSelectMenuInteraction:', error);
        try {
            await interaction.editReply({
                content: '❌ Error loading tool details.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.error('[ToolsMenuManager] Failed to send error reply:', replyError);
        }
    }
}

/**
 * Registers all handlers for the tools menu feature.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const apiClient = getApiClient(dependencies);
    if (!apiClient) {
        throw new Error('[ToolsMenuManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;
    
    const { commandDispatcher, buttonInteractionDispatcher, selectMenuInteractionDispatcher } = dispatcherInstances;
    const { logger } = dependencies;
    
    // Register command handler
    commandDispatcher.register('tools', handleToolsCommand);
    
    // Register button handlers
    buttonInteractionDispatcher.register('tool_', handleToolsButtonInteraction);
    
    // Register select menu handlers
    selectMenuInteractionDispatcher.register('tool_select', handleToolsSelectMenuInteraction);
    
    logger.debug('[ToolsMenuManager] All handlers registered.');
}

module.exports = {
    registerHandlers
};

