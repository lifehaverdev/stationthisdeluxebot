/**
 * Discord Settings Menu Manager
 * 
 * Manages the settings menu for Discord, allowing users to configure
 * tool-specific preferences. Mirrors the Telegram settingsMenuManager functionality.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');

// Utility: resolve canonical internalApiClient for this module
function getApiClient(dependencies) {
    return dependencies.internalApiClient || dependencies.internal?.client;
}

const ITEMS_PER_PAGE_ALL_TOOLS = 6; // 3 rows of 2 tools

/**
 * Fetches user-specific settings for a tool via the internal API.
 * Corresponds to GET /internal/v1/data/users/:masterAccountId/preferences/:toolId
 * @param {string} masterAccountId
 * @param {string} toolIdentifier - The tool's unique identifier (e.g., displayName).
 * @param {object} dependencies - Must contain { logger, internal: { client } }
 * @returns {Promise<object>}
 */
async function getToolSettings(masterAccountId, toolIdentifier, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    if (!apiClient) {
        throw new Error('[SettingsMenu] internalApiClient dependency missing');
    }
    try {
        const encodedIdentifier = encodeURIComponent(toolIdentifier);
        const response = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/preferences/${encodedIdentifier}`);
        return response.data || {};
    } catch (error) {
        if (error.response && error.response.status === 404) {
            logger.warn(`[SettingsMenu] getToolSettings: No preferences found for MAID ${masterAccountId}, Tool ${toolIdentifier}. Returning empty object.`);
            return {};
        }
        logger.error(`[SettingsMenu] getToolSettings: Error fetching tool settings for MAID ${masterAccountId}, Tool ${toolIdentifier}.`, error);
        throw error;
    }
}

/**
 * Saves user-specific settings for a tool via the internal API.
 * Corresponds to PUT /internal/v1/data/users/:masterAccountId/preferences/:toolId
 * @param {string} masterAccountId
 * @param {string} toolIdentifier - The tool's unique identifier (e.g., displayName).
 * @param {object} settingsToUpdate
 * @param {object} dependencies - Must contain { logger, internal: { client } }
 * @returns {Promise<{success: boolean, data?: object, message?: string}>}
 */
async function saveToolSettings(masterAccountId, toolIdentifier, settingsToUpdate, dependencies) {
    const { logger } = dependencies;
    const apiClient = getApiClient(dependencies);
    if (!apiClient) {
        throw new Error('[SettingsMenu] internalApiClient dependency missing');
    }
    try {
        const encodedIdentifier = encodeURIComponent(toolIdentifier);
        const response = await apiClient.put(`/internal/v1/data/users/${masterAccountId}/preferences/${encodedIdentifier}`, settingsToUpdate);
        return { success: true, data: response.data };
    } catch (error) {
        logger.error(`[SettingsMenu] saveToolSettings: Error saving tool settings for MAID ${masterAccountId}, Tool ${toolIdentifier}.`);
        const simplifiedError = {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        };
        logger.error(`[SettingsMenu] saveToolSettings: Simplified error object: ${JSON.stringify(simplifiedError)}`);
        return { success: false, message: error.response?.data?.error?.message || error.message || "An unknown error occurred." };
    }
}

/**
 * Formats a raw parameter name for display.
 * Example: "input_seed" -> "Seed", "input_pose_image" -> "Pose Image"
 * @param {string} paramName - The raw parameter name.
 * @returns {string} The formatted parameter name.
 */
function formatParamNameForDisplay(paramName) {
    if (!paramName) return '';
    let formatted = paramName.startsWith('input_') ? paramName.substring(6) : paramName;
    formatted = formatted.replace(/_/g, ' ');
    // Convert to Title Case
    return formatted.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.substring(1)).join(' ');
}

/**
 * Fetches and filters the most frequently used tools for a user.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - { toolRegistry, logger, internalApiClient }
 * @param {number} [displayLimit=4] - The maximum number of tools to display in the menu.
 * @returns {Promise<Array<object>>} Array of tool objects { toolId, displayName, usageCount } or empty array on error.
 */
async function getMostFrequentlyUsedTools(masterAccountId, dependencies) {
    const { logger = console, toolRegistry } = dependencies || {};
    const limit = 12; // How many raw events to fetch
    const toolCount = 5; // How many unique tools to return
    
    if (!masterAccountId) {
        logger.error('[SettingsMenu] MasterAccountId is required to fetch frequent tools.');
        return [];
    }
    
    if (!toolRegistry) {
        logger.warn('[SettingsMenu] toolRegistry not available, returning empty frequent tools list');
        return [];
    }
    
    try {
        const apiClient = getApiClient(dependencies);
        if (!apiClient) {
            logger.warn('[SettingsMenu] API client not available for fetching frequent tools');
            return [];
        }
        
        const response = await apiClient.get(`/internal/v1/data/generations/users/${masterAccountId}/most-frequent-tools`, {
            params: { limit }
        });

        const rawFrequentTools = response.data && response.data.frequentTools ? response.data.frequentTools : [];
        if (rawFrequentTools.length === 0) {
            logger.info(`[SettingsMenu] No raw frequent tools data from API for MAID: ${masterAccountId}`);
            return [];
        }
        logger.info(`[SettingsMenu] Received ${rawFrequentTools.length} raw frequent tools from API for MAID: ${masterAccountId}`);

        const validEnrichedTools = [];
        for (const toolUsage of rawFrequentTools) {
            if (validEnrichedTools.length >= toolCount) {
                break;
            }
            logger.debug(`[SettingsMenu] Processing toolUsage: toolId from API '${toolUsage.toolId}', usageCount: ${toolUsage.usageCount}`);
            
            if (!toolRegistry) {
                logger.warn(`[SettingsMenu] toolRegistry not available, skipping tool ${toolUsage.toolId}`);
                continue;
            }
            
            let toolDef = toolRegistry.getToolById(toolUsage.toolId);
            if (toolDef) {
                logger.debug(`[SettingsMenu] Found toolDef for '${toolUsage.toolId}' using getToolById.`);
            } else {
                logger.debug(`[SettingsMenu] toolDef for '${toolUsage.toolId}' NOT found using getToolById. Attempting findByDisplayName...`);
                toolDef = toolRegistry.findByDisplayName(toolUsage.toolId);
                if (toolDef) {
                    logger.debug(`[SettingsMenu] Found toolDef for display name '${toolUsage.toolId}' (actual ID: ${toolDef.toolId}) using findByDisplayName.`);
                } else {
                    // Fallback to case-insensitive 'includes' search on display name as a lenient measure
                    const allTools = toolRegistry.getAllTools();
                    const lowerCaseToolIdentifier = toolUsage.toolId.toLowerCase();
                    toolDef = allTools.find(t => t.displayName.toLowerCase().includes(lowerCaseToolIdentifier));
                    
                    if (toolDef) {
                        logger.debug(`[SettingsMenu] Found toolDef for identifier '${toolUsage.toolId}' (actual ID: ${toolDef.toolId}) using case-insensitive 'includes' search on displayName '${toolDef.displayName}'.`);
                    } else {
                        logger.warn(`[SettingsMenu] Tool with identifier '${toolUsage.toolId}' not found in ToolRegistry by ID, DisplayName, or includes-check. Skipping.`);
                    }
                }
            }

            if (toolDef) {
                // Ensure we don't add duplicate tools if different historical IDs map to the same tool.
                const isAlreadyAdded = validEnrichedTools.some(t => t.toolId === toolDef.toolId);
                if (!isAlreadyAdded) {
                    validEnrichedTools.push({
                        toolId: toolDef.toolId,
                        displayName: toolDef.displayName,
                        usageCount: toolUsage.usageCount
                    });
                }
            }
        }

        logger.info(`[SettingsMenu] Returning ${validEnrichedTools.length} valid enriched tools for MAID: ${masterAccountId}`);
        return validEnrichedTools;
    } catch (error) {
        logger.error(`[SettingsMenu] Error fetching most frequently used tools for MAID ${masterAccountId}:`, error);
        return [];
    }
}

/**
 * Handles parameter value replies from users.
 * @param {string} masterAccountId
 * @param {string} toolIdentifier
 * @param {string} paramKey
 * @param {string} newValue
 * @param {object} dependencies
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleParameterValueReply(masterAccountId, toolIdentifier, paramKey, newValue, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const toolDef = toolRegistry.findByDisplayName(toolIdentifier);
    
    if (!toolDef) {
        return { success: false, error: `Tool '${toolIdentifier}' not found.` };
    }

    const paramDef = toolDef.inputSchema?.[paramKey];
    if (!paramDef) {
        return { success: false, error: `Parameter '${paramKey}' not found for tool '${toolIdentifier}'.` };
    }

    // Parse value based on type
    let parsedValue = newValue;
    if (paramDef.type === 'number' || paramDef.type === 'integer') {
        parsedValue = parseFloat(newValue);
        if (isNaN(parsedValue)) {
            return { success: false, error: `Invalid number: ${newValue}` };
        }
    } else if (paramDef.type === 'boolean') {
        parsedValue = newValue.toLowerCase() === 'true';
    }

    // Get current settings and update
    const currentSettings = await getToolSettings(masterAccountId, toolIdentifier, dependencies);
    const updatedSettings = { ...currentSettings, [paramKey]: parsedValue };

    const saveResult = await saveToolSettings(masterAccountId, toolIdentifier, updatedSettings, dependencies);
    
    if (saveResult.success) {
        logger.info(`[SettingsMenu] Updated parameter '${paramKey}' for tool '${toolIdentifier}' for MAID ${masterAccountId}`);
        return { success: true };
    } else {
        return { success: false, error: saveResult.message || 'Failed to save setting.' };
    }
}

/**
 * Builds the main settings menu as a Discord embed with buttons.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildMainMenu(masterAccountId, dependencies) {
    const { logger } = dependencies;
    const frequentTools = await getMostFrequentlyUsedTools(masterAccountId, dependencies);

    const embed = new EmbedBuilder()
        .setTitle('⚙️ Settings')
        .setDescription('Here you can manage your preferences for various tools.\n\nSelect a tool below to configure its settings.')
        .setColor(0x0099FF);

    const components = [];
    
    // "All Tools" button
    const allToolsRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('📋 All Tools')
                .setCustomId('set_all_tools_0')
                .setStyle(ButtonStyle.Primary)
        );
    components.push(allToolsRow);

    // Frequent tools buttons (max 5 buttons per row, max 5 rows)
    if (frequentTools.length > 0) {
        const toolRows = [];
        for (let i = 0; i < Math.min(frequentTools.length, 20); i += 5) {
            const row = new ActionRowBuilder();
            for (let j = i; j < Math.min(i + 5, frequentTools.length); j++) {
                const tool = frequentTools[j];
                const toolCallbackKey = tool.displayName.replace(/\s+/g, '_');
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(tool.displayName.length > 80 ? tool.displayName.substring(0, 77) + '...' : tool.displayName)
                        .setCustomId(`set_viewtool_${toolCallbackKey}`)
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            toolRows.push(row);
        }
        components.push(...toolRows);
    }

    // Close button
    const closeRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('❌ Close')
                .setCustomId('set_nvm')
                .setStyle(ButtonStyle.Danger)
        );
    components.push(closeRow);

    return { embeds: [embed], components };
}

/**
 * Builds the "All Tools" menu using select menus (no pagination needed).
 * Discord select menus can hold up to 25 options each, and we can have up to 5 action rows.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {number} page - Deprecated: kept for compatibility but not used (no pagination).
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildAllToolsMenu(masterAccountId, page = 0, dependencies) {
    const { logger = console, toolRegistry } = dependencies || {};
    
    if (!toolRegistry) {
        logger.warn('[SettingsMenu] toolRegistry not available for buildAllToolsMenu');
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Tool registry not available. Please try again later.')
            .setColor(0xFF0000);
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('⬅️ Back')
                    .setCustomId('set_main')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        return { embeds: [errorEmbed], components: [backRow] };
    }
    
    logger.info(`[SettingsMenu] buildAllToolsMenu: Building for MAID ${masterAccountId}`);
    
    const allRegisteredTools = toolRegistry.getAllTools();
    logger.info(`[SettingsMenu] buildAllToolsMenu: Found ${allRegisteredTools.length} total tools in registry`);
    
    // Filter out internal tools (API/COOK tools)
    const allTools = allRegisteredTools
        .filter(t => {
            const isApiOrCookTool = t.displayName?.includes('_API') || t.displayName?.includes('_COOK');
            if (isApiOrCookTool) {
                logger.debug(`[SettingsMenu] Filtering out internal tool "${t.displayName}"`);
            }
            return !isApiOrCookTool;
        })
        .sort((a, b) => (a.displayName || a.toolId).localeCompare(b.displayName || b.toolId));
    
    logger.info(`[SettingsMenu] buildAllToolsMenu: Found ${allTools.length} tools after filtering`);
    
    // Discord limits: 5 action rows total, 25 options per select menu
    // We'll use multiple select menus if needed (up to 5, covering 125 tools max)
    const MAX_SELECT_OPTIONS = 25; // Discord select menu limit
    const MAX_SELECT_MENUS = 5; // Discord action row limit
    
    const embed = new EmbedBuilder()
        .setTitle('📋 All Tools')
        .setDescription(`Select a tool to configure its settings.`)
        .setColor(0x0099FF);
    
    const components = [];
    
    // Create select menus (up to 5, each with up to 25 options)
    if (allTools.length > 0) {
        const totalSelectMenus = Math.min(Math.ceil(allTools.length / MAX_SELECT_OPTIONS), MAX_SELECT_MENUS);
        
        for (let menuIndex = 0; menuIndex < totalSelectMenus; menuIndex++) {
            const startIndex = menuIndex * MAX_SELECT_OPTIONS;
            const endIndex = startIndex + MAX_SELECT_OPTIONS;
            const toolsForMenu = allTools.slice(startIndex, endIndex);
            
            if (toolsForMenu.length > 0) {
                const toolSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`set_selecttool_${menuIndex}`) // Unique custom_id for each menu
                    .setPlaceholder(totalSelectMenus > 1 ? `Select a tool... (${startIndex + 1}-${Math.min(endIndex, allTools.length)} of ${allTools.length})` : 'Select a tool...');
                
                // Add tool options to select menu
                for (const tool of toolsForMenu) {
                    const toolDisplayName = tool.displayName || tool.toolId;
                    const toolCallbackKey = toolDisplayName.replace(/\s+/g, '_');
                    
                    // Truncate label if too long (Discord limit: 100 chars for select option label)
                    let optionLabel = toolDisplayName;
                    if (optionLabel.length > 100) {
                        optionLabel = optionLabel.substring(0, 97) + '...';
                    }
                    
                    // Use toolCallbackKey as value, store displayName in description
                    toolSelectMenu.addOptions({
                        label: optionLabel,
                        value: toolCallbackKey,
                        description: tool.description ? (tool.description.length > 50 ? tool.description.substring(0, 47) + '...' : tool.description) : undefined
                    });
                }
                
                const selectRow = new ActionRowBuilder()
                    .addComponents(toolSelectMenu);
                components.push(selectRow);
            }
        }
        
        // If we have more tools than can fit in 5 select menus, show a warning
        if (allTools.length > MAX_SELECT_MENUS * MAX_SELECT_OPTIONS) {
            embed.setDescription(`Select a tool to configure its settings.\n\n⚠️ Note: Showing first ${MAX_SELECT_MENUS * MAX_SELECT_OPTIONS} of ${allTools.length} tools.`);
        }
    } else {
        embed.setDescription('No tools available.');
    }
    
    // Back and close buttons
    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('⬅️ Back to Main')
                .setCustomId('set_main')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('❌ Close')
                .setCustomId('set_nvm')
                .setStyle(ButtonStyle.Danger)
        );
    components.push(backRow);
    
    return { embeds: [embed], components };
}

/**
 * Builds the tool-specific parameters menu.
 * @param {string} masterAccountId
 * @param {string} toolKey - The tool's displayName.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildToolParamsMenu(masterAccountId, toolKey, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const toolDef = toolRegistry.findByDisplayName(toolKey);

    if (!toolDef) {
        logger.error(`[SettingsMenu] buildToolParamsMenu: Could not find toolDef for toolKey '${toolKey}'.`);
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Tool not found. Please go back.')
            .setColor(0xFF0000);
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('⬅️ Back')
                    .setCustomId('set_main')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setLabel('❌ Close')
                    .setCustomId('set_nvm')
                    .setStyle(ButtonStyle.Danger)
            );
        
        return { embeds: [errorEmbed], components: [backRow] };
    }

    let userSettings = {};
    try {
        userSettings = await getToolSettings(masterAccountId, toolKey, dependencies);
        logger.info(`[SettingsMenu] Fetched user settings for MAID ${masterAccountId}, Tool ${toolKey}: ${JSON.stringify(userSettings)}`);
    } catch (err) {
        logger.error(`[SettingsMenu] Error fetching user settings in buildToolParamsMenu for MAID ${masterAccountId}, Tool ${toolKey}:`, err);
    }

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ ${toolDef.displayName} Settings`)
        .setDescription(toolDef.description || `Configure settings for ${toolDef.displayName}`)
        .setColor(0x0099FF);

    const components = [];
    
    if (toolDef.inputSchema) {
        const paramRows = [];
        const params = Object.keys(toolDef.inputSchema);
        
        // Group parameters into rows of 5 buttons each
        for (let i = 0; i < params.length; i += 5) {
            const row = new ActionRowBuilder();
            for (let j = i; j < Math.min(i + 5, params.length); j++) {
                const paramName = params[j];
                const paramDef = toolDef.inputSchema[paramName];
                const currentValue = userSettings[paramName] !== undefined 
                    ? userSettings[paramName] 
                    : (paramDef.default !== undefined ? paramDef.default : 'Not set');
                
                const displayParamName = formatParamNameForDisplay(paramName);
                let buttonLabel = displayParamName;
                
                // Truncate value for display
                const valueStr = String(currentValue);
                if (valueStr.length > 15) {
                    buttonLabel += `: ${valueStr.substring(0, 12)}...`;
                } else {
                    buttonLabel += `: ${valueStr}`;
                }
                
                // Truncate label if too long (Discord limit: 80 chars)
                if (buttonLabel.length > 80) {
                    buttonLabel = buttonLabel.substring(0, 77) + '...';
                }
                
                const displayNameForCallback = toolDef.displayName.replace(/\s+/g, '_');
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(buttonLabel)
                        .setCustomId(`set_param_${displayNameForCallback}_${paramName}`)
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            paramRows.push(row);
        }
        
        components.push(...paramRows);
    } else {
        embed.setDescription('This tool has no configurable parameters.');
    }

    // Navigation buttons
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('⬅️ Back to Main')
                .setCustomId('set_main')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('❌ Close')
                .setCustomId('set_nvm')
                .setStyle(ButtonStyle.Danger)
        );
    components.push(navRow);

    return { embeds: [embed], components };
}

/**
 * Builds the parameter editing prompt.
 * @param {string} masterAccountId
 * @param {string} toolIdentifier - The tool's displayName.
 * @param {string} paramName - The name of the parameter to edit.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<{embeds: Array, components: Array}>} Discord message components
 */
async function buildEditParamMenu(masterAccountId, toolIdentifier, paramName, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const toolDef = toolRegistry.findByDisplayName(toolIdentifier);
    if (!toolDef) {
        logger.error(`[SettingsMenu] buildEditParamMenu: Could not find toolDef for toolIdentifier '${toolIdentifier}'.`);
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('Could not find tool to edit.')
            .setColor(0xFF0000);
        
        const backRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('⬅️ Back')
                    .setCustomId('set_main')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        return { embeds: [errorEmbed], components: [backRow] };
    }

    const toolSettings = await getToolSettings(masterAccountId, toolIdentifier, dependencies);
    const paramDef = toolDef.inputSchema?.[paramName];
    const currentValue = toolSettings[paramName] !== undefined 
        ? toolSettings[paramName] 
        : (paramDef?.default ?? 'Not set');

    let description = `**Editing:** ${formatParamNameForDisplay(paramName)}\n`;
    description += `**Tool:** ${toolDef.displayName}\n\n`;
    description += `**Current Default:** ${String(currentValue)}\n\n`;
    description += 'Please reply to this message with the new default value.';
    
    if (paramDef?.description) {
        description += `\n\n${paramDef.description}`;
    }
    if (paramDef?.type === 'boolean') {
        description += `\n(Send 'true' or 'false')`;
    }

    const embed = new EmbedBuilder()
        .setTitle('✏️ Edit Parameter')
        .setDescription(description)
        .setColor(0xFFA500);

    const toolCallbackKey = toolDef.displayName.replace(/\s+/g, '_');
    const backRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('⬅️ Back to Tool Settings')
                .setCustomId(`set_viewtool_${toolCallbackKey}`)
                .setStyle(ButtonStyle.Secondary)
        );

    return { embeds: [embed], components: [backRow] };
}

/**
 * Handles the /settings slash command.
 * @param {object} client - Discord client instance
 * @param {object} interaction - Discord interaction
 * @param {object} dependencies - The canonical dependencies object
 */
async function settingsCommandHandler(client, interaction, dependencies) {
    const { logger } = dependencies;
    
    // CRITICAL: Defer immediately (within 3 seconds)
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
    }
    
    try {
        logger.info(`[SettingsMenu] /settings command received from Discord User ID: ${interaction.user.id}`);
        
        // Get or create master account ID
        const apiClient = getApiClient(dependencies);
        if (!apiClient) {
            throw new Error('[SettingsMenu] internalApiClient dependency missing');
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

        const menu = await buildMainMenu(masterAccountId, dependencies);
        await interaction.editReply({
            embeds: menu.embeds,
            components: menu.components
        });
    } catch (error) {
        logger.error(`[SettingsMenu] Critical error in settingsCommandHandler:`, error.stack || error);
        await interaction.editReply({
            content: 'A critical error occurred while handling your command.',
            embeds: [],
            components: []
        });
    }
}

/**
 * Handles select menu interactions for the settings menu.
 * @param {object} client - Discord client instance
 * @param {object} interaction - Discord select menu interaction
 * @param {string} masterAccountId - The user's master account ID (provided by dispatcher)
 * @param {object} dependencies - The canonical dependencies object
 */
async function settingsSelectMenuHandler(client, interaction, masterAccountId, dependencies) {
    const { logger = console } = dependencies || {};
    const customId = interaction?.customId;
    
    if (!customId) {
        logger.error('[SettingsMenu] Select menu interaction missing customId');
        return;
    }
    
    if (!masterAccountId) {
        logger.error('[SettingsMenu] masterAccountId not provided by dispatcher');
        return;
    }
    
    // CRITICAL: Defer immediately (within 3 seconds)
    if (!interaction.deferred && !interaction.replied) {
        try {
            await interaction.deferUpdate();
        } catch (deferError) {
            logger.error('[SettingsMenu] Failed to defer update:', deferError);
            return;
        }
    }
    
    try {
        logger.info(`[SettingsMenu] Select menu interaction received: '${customId}' from ${interaction.user?.id}, MAID: ${masterAccountId}`);
        
        if (customId.startsWith('set_selecttool_')) {
            // Handle tool selection from all tools menu (any of the select menus)
            const selectedValue = interaction.values?.[0];
            if (!selectedValue) {
                logger.warn('[SettingsMenu] No value selected in tool select menu');
                await interaction.editReply({
                    content: 'No tool selected.',
                    embeds: [],
                    components: []
                });
                return;
            }
            
            const displayNameFromCallback = selectedValue.replace(/_/g, ' ');
            const menu = await buildToolParamsMenu(masterAccountId, displayNameFromCallback, dependencies);
            
            if (menu && menu.embeds && menu.components) {
                await interaction.editReply({
                    embeds: menu.embeds,
                    components: menu.components
                });
            } else {
                logger.warn('[SettingsMenu] Menu is missing embeds or components');
                await interaction.editReply({
                    content: 'Error: Could not build tool menu. Please try again.',
                    embeds: [],
                    components: []
                });
            }
        } else {
            logger.warn(`[SettingsMenu] Unhandled select menu callback: ${customId}`);
            await interaction.editReply({
                content: 'Action not implemented yet.',
                embeds: [],
                components: []
            });
        }
    } catch (error) {
        logger.error('[SettingsMenu] Error in settingsSelectMenuHandler:', error);
        logger.error('[SettingsMenu] Error stack:', error?.stack);
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
            logger.error('[SettingsMenu] Failed to send error response:', replyError);
        }
    }
}

/**
 * Handles button interactions for the settings menu.
 * @param {object} client - Discord client instance
 * @param {object} interaction - Discord button interaction
 * @param {string} masterAccountId - The user's master account ID (provided by dispatcher)
 * @param {object} dependencies - The canonical dependencies object
 */
async function settingsButtonHandler(client, interaction, masterAccountId, dependencies) {
    const { logger = console } = dependencies || {};
    const customId = interaction?.customId;
    
    if (!customId) {
        logger.error('[SettingsMenu] Button interaction missing customId');
        return;
    }
    
    if (!masterAccountId) {
        logger.error('[SettingsMenu] masterAccountId not provided by dispatcher');
        return;
    }
    
    // CRITICAL: Defer immediately (within 3 seconds)
    if (!interaction.deferred && !interaction.replied) {
        try {
            await interaction.deferUpdate();
        } catch (deferError) {
            logger.error('[SettingsMenu] Failed to defer update:', deferError);
            return;
        }
    }
    
    try {
        logger.info(`[SettingsMenu] Button interaction received: '${customId}' from ${interaction.user?.id}, MAID: ${masterAccountId}`);

        let menu;
        
        if (customId === 'set_nvm') {
            // Close menu - edit to show closed state (can't always delete due to cache issues)
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ 
                        content: 'Settings closed.', 
                        embeds: [], 
                        components: [] 
                    });
                } else {
                    await interaction.reply({ content: 'Settings closed.', flags: 64 }); // Ephemeral
                }
            } catch (closeError) {
                logger.warn('[SettingsMenu] Could not close menu:', closeError);
                // If edit fails, try to delete (but this might fail due to cache)
                try {
                    if (interaction.message && interaction.message.deletable) {
                        // Fetch channel if not cached
                        if (!interaction.channel) {
                            const channel = await client.channels.fetch(interaction.channelId);
                            const message = await channel.messages.fetch(interaction.message.id);
                            await message.delete();
                        } else {
                            await interaction.message.delete();
                        }
                    }
                } catch (deleteError) {
                    logger.error('[SettingsMenu] Could not delete message either:', deleteError);
                }
            }
            return;
        }
        
        // Handle disabled page indicator button (no-op)
        if (customId === 'no_op_page_indicator') {
            // Just acknowledge, do nothing
            return;
        }

        if (customId === 'set_main') {
            menu = await buildMainMenu(masterAccountId, dependencies);
        } else if (customId.startsWith('set_all_tools_')) {
            // Legacy pagination support (no longer used, but kept for compatibility)
            // All tools are now shown in select menus without pagination
            menu = await buildAllToolsMenu(masterAccountId, 0, dependencies);
        } else if (customId.startsWith('set_viewtool_')) {
            const displayNameFromCallback = customId.substring('set_viewtool_'.length).replace(/_/g, ' ');
            menu = await buildToolParamsMenu(masterAccountId, displayNameFromCallback, dependencies);
        } else if (customId.startsWith('set_param_')) {
            // Parse: set_param_<displayName>_<paramName>
            const paramData = customId.substring('set_param_'.length);
            const firstUnderscore = paramData.indexOf('_');
            if (firstUnderscore === -1) {
                logger.error(`[SettingsMenu] Malformed set_param_ callback: '${customId}'`);
                await interaction.editReply({
                    content: 'Malformed parameter callback.',
                    embeds: [],
                    components: []
                });
                return;
            }
            const displayNameFromCallback = paramData.substring(0, firstUnderscore).replace(/_/g, ' ');
            const paramName = paramData.substring(firstUnderscore + 1);
            
            // Build edit param menu and send as new message with reply context
            menu = await buildEditParamMenu(masterAccountId, displayNameFromCallback, paramName, dependencies);
            
            // Ensure we have a channel (fetch if not cached)
            let channel = interaction.channel;
            if (!channel && interaction.channelId) {
                try {
                    channel = await client.channels.fetch(interaction.channelId);
                } catch (fetchError) {
                    logger.error('[SettingsMenu] Failed to fetch channel:', fetchError);
                    await interaction.editReply({
                        content: 'Error: Could not access channel. Please try again.',
                        embeds: [],
                        components: []
                    });
                    return;
                }
            }
            
            if (!channel) {
                logger.error('[SettingsMenu] No channel available for sending edit param message');
                await interaction.editReply({
                    content: 'Error: Could not access channel. Please try again.',
                    embeds: [],
                    components: []
                });
                return;
            }
            
            // Detect DM context for logging
            const isDM = channel.type === 1; // DM channel type
            if (isDM) {
                logger.info(`[SettingsMenu] Sending edit prompt in DM context for MAID ${masterAccountId}`);
            }
            
            // Send new message asking for value
            const sentMessage = await channel.send({
                embeds: menu.embeds,
                components: menu.components
            });
            
            // Set up reply context
            if (dependencies.replyContextManager) {
                const context = {
                    type: 'settings_param_edit',
                    masterAccountId: masterAccountId,
                    toolIdentifier: displayNameFromCallback,
                    paramKey: paramName
                };
                dependencies.replyContextManager.addContext(sentMessage, context);
                logger.info(`[SettingsMenu] Stored reply context for 'settings_param_edit' for MAID ${masterAccountId}, Tool: ${displayNameFromCallback}, Param: ${paramName}.`);
            }
            
            // Acknowledge the interaction (edit to show it was processed)
            await interaction.editReply({
                content: 'Parameter edit prompt sent. Please reply to the message above.',
                embeds: [],
                components: []
            });
            return;
        } else {
            logger.warn(`[SettingsMenu] Unhandled button callback: ${customId}`);
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
            logger.warn('[SettingsMenu] Menu is missing embeds or components:', { hasMenu: !!menu, hasEmbeds: !!menu?.embeds, hasComponents: !!menu?.components });
            await interaction.editReply({
                content: 'Error: Could not build menu. Please try again.',
                embeds: [],
                components: []
            });
        }
    } catch (error) {
        logger.error('[SettingsMenu] Error in settingsButtonHandler:', error);
        logger.error('[SettingsMenu] Error stack:', error?.stack);
        logger.error('[SettingsMenu] Error details:', {
            message: error?.message,
            name: error?.name,
            customId: customId,
            interactionId: interaction?.id
        });
        
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
                    flags: 64 // Ephemeral
                });
            }
        } catch (replyError) {
            logger.error('[SettingsMenu] Failed to send error response:', replyError);
            logger.error('[SettingsMenu] Reply error stack:', replyError?.stack);
        }
    }
}

/**
 * Handles replies for editing a parameter value.
 * @param {object} client - Discord client instance
 * @param {object} message - The user's reply message
 * @param {object} context - The context stored for this reply
 * @param {object} dependencies - The canonical dependencies object
 */
async function handleSettingsReply(client, message, context, dependencies) {
    const { logger } = dependencies;
    const { toolIdentifier, paramKey, masterAccountId } = context;
    const newValue = message.content.trim();
    const isDM = message.channel.type === 1; // DM channel type

    logger.info(`[SettingsMenu] Received reply for param edit. MAID: ${masterAccountId}, Tool: ${toolIdentifier}, Param: ${paramKey}, NewValue: '${newValue}', IsDM: ${isDM}`);

    try {
        const result = await handleParameterValueReply(masterAccountId, toolIdentifier, paramKey, newValue, dependencies);
        
        if (result.success) {
            // Try to reply, but handle DM failures gracefully
            try {
                await message.reply(`✅ Setting updated successfully for ${toolIdentifier}!`);
            } catch (replyError) {
                // If DM reply fails (e.g., user has DM restrictions), try sending in channel
                if (isDM) {
                    logger.warn(`[SettingsMenu] DM reply failed, trying channel send:`, replyError.message);
                    try {
                        await message.channel.send(`✅ Setting updated successfully for ${toolIdentifier}!`);
                    } catch (channelError) {
                        logger.error(`[SettingsMenu] Both DM and channel send failed:`, channelError);
                        // Last resort: log and continue
                    }
                } else {
                    // In a server channel, this shouldn't fail, but log if it does
                    logger.error(`[SettingsMenu] Failed to reply in channel:`, replyError);
                    throw replyError; // Re-throw for channel contexts
                }
            }

            // Update the original menu message if it exists
            if (message.reference && message.reference.messageId) {
                try {
                    const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
                    const menu = await buildToolParamsMenu(masterAccountId, toolIdentifier, dependencies);
                    await originalMessage.edit({
                        embeds: menu.embeds,
                        components: menu.components
                    });
                } catch (editError) {
                    logger.warn(`[SettingsMenu] Could not update original menu message:`, editError);
                    // Don't fail the whole operation if we can't update the menu
                }
            }
        } else {
            // Try to reply with error, handle DM failures
            try {
                await message.reply(`⚠️ ${result.error}`);
            } catch (replyError) {
                if (isDM) {
                    logger.warn(`[SettingsMenu] DM error reply failed, trying channel send:`, replyError.message);
                    try {
                        await message.channel.send(`⚠️ ${result.error}`);
                    } catch (channelError) {
                        logger.error(`[SettingsMenu] Both DM and channel error send failed:`, channelError);
                    }
                } else {
                    logger.error(`[SettingsMenu] Failed to send error reply in channel:`, replyError);
                }
            }
        }
    } catch (error) {
        logger.error(`[SettingsMenu] Error in handleSettingsReply for MAID ${masterAccountId}:`, error);
        try {
            await message.reply('Sorry, there was a critical error trying to save that setting.');
        } catch (replyError) {
            if (isDM) {
                logger.warn(`[SettingsMenu] DM critical error reply failed:`, replyError.message);
                try {
                    await message.channel.send('Sorry, there was a critical error trying to save that setting.');
                } catch (channelError) {
                    logger.error(`[SettingsMenu] Critical: Both DM and channel send failed:`, channelError);
                }
            } else {
                logger.error(`[SettingsMenu] Critical: Failed to send error message:`, replyError);
            }
        }
    }
}

/**
 * Registers all handlers for the settings menu feature.
 * @param {object} dispatcherInstances - The dispatcher instances object.
 * @param {CommandDispatcher} dispatcherInstances.commandDispatcher - The command dispatcher.
 * @param {ButtonInteractionDispatcher} dispatcherInstances.buttonInteractionDispatcher - The button interaction dispatcher.
 * @param {SelectMenuInteractionDispatcher} dispatcherInstances.selectMenuInteractionDispatcher - The select menu interaction dispatcher.
 * @param {MessageReplyDispatcher} dispatcherInstances.messageReplyDispatcher - The message reply dispatcher.
 * @param {object} dependencies - The dependencies needed by the handlers.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, buttonInteractionDispatcher, selectMenuInteractionDispatcher, messageReplyDispatcher } = dispatcherInstances;
    const { logger } = dependencies;

    if (!commandDispatcher || !buttonInteractionDispatcher || !selectMenuInteractionDispatcher || !messageReplyDispatcher) {
        logger.error('[SettingsMenuManager] Dispatcher instances not provided. Cannot register handlers.');
        return;
    }
    
    // Register the command handler
    commandDispatcher.register('settings', settingsCommandHandler);
    
    // Register button handlers (all settings buttons start with 'set_')
    buttonInteractionDispatcher.register('set_', settingsButtonHandler);
    
    // Register select menu handler (for tool selection in all tools menu)
    // Matches set_selecttool_0, set_selecttool_1, etc.
    selectMenuInteractionDispatcher.register('set_selecttool_', settingsSelectMenuHandler);
    
    // Register the reply handler for when a user provides a new parameter value
    messageReplyDispatcher.register('settings_param_edit', handleSettingsReply);

    logger.info('[SettingsMenuManager] Handlers registered.');
}

module.exports = {
    registerHandlers
};

