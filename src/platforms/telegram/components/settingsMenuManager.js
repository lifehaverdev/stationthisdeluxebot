// src/platforms/telegram/components/settingsMenuManager.js
const { ObjectId } = require('../../../core/services/db/BaseDB');
const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');
// const internalApiClient = require('../../../utils/internalApiClient');
// const UserSettingsService = require('../../../core/services/userSettingsService'); // Direct import not needed if passed via dependencies
const { escapeMarkdownV2 } = require('../../../utils/stringUtils'); // ADDED

// Dependencies like logger, toolRegistry, userSettingsService will be passed into functions.

const TELEGRAM_API_KEY = process.env.INTERNAL_API_KEY_TELEGRAM; // Ensure this is defined
const ITEMS_PER_PAGE_ALL_TOOLS = 6; // 3 rows of 2 tools

/**
 * Fetches user-specific settings for a tool via the internal API.
 * Corresponds to GET /internal/v1/data/users/:masterAccountId/preferences/:toolId
 * @param {string} masterAccountId
 * @param {string} toolId
 * @param {object} dependencies - Must contain { logger, internal: { client } }
 * @returns {Promise<object>}
 */
async function getToolSettings(masterAccountId, toolId, dependencies) {
    const { logger, internal } = dependencies;
    try {
        const response = await internal.client.get(`/internal/v1/data/users/${masterAccountId}/preferences/${toolId}`);
        return response.data || {};
    } catch (error) {
        if (error.response && error.response.status === 404) {
            logger.warn(`[SettingsMenu] getToolSettings: No preferences found for MAID ${masterAccountId}, Tool ${toolId}. Returning empty object.`);
            return {};
        }
        logger.error(`[SettingsMenu] getToolSettings: Error fetching tool settings for MAID ${masterAccountId}, Tool ${toolId}.`, error);
        throw error; // Re-throw for the caller to handle
    }
}

/**
 * Saves user-specific settings for a tool via the internal API.
 * Corresponds to PUT /internal/v1/data/users/:masterAccountId/preferences/:toolId
 * @param {string} masterAccountId
 * @param {string} toolId
 * @param {object} settingsToUpdate
 * @param {object} dependencies - Must contain { logger, internal: { client } }
 * @returns {Promise<{success: boolean, data?: object, message?: string}>}
 */
async function saveToolSettings(masterAccountId, toolId, settingsToUpdate, dependencies) {
    const { logger, internal } = dependencies;
    try {
        const response = await internal.client.put(`/internal/v1/data/users/${masterAccountId}/preferences/${toolId}`, settingsToUpdate);
        return { success: true, data: response.data };
    } catch (error) {
        logger.error(`[SettingsMenu] saveToolSettings: Error saving tool settings for MAID ${masterAccountId}, Tool ${toolId}.`, error);
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
    const { logger } = dependencies;
    const limit = 12; // How many raw events to fetch
    const toolCount = 5; // How many unique tools to return
    if (!masterAccountId) {
        logger.error('[SettingsMenu] MasterAccountId is required to fetch frequent tools.');
        return [];
    }
    try {
        const apiFetchLimit = limit * 3; // Fetch more to account for filtering
        logger.info(`[SettingsMenu] Fetching most frequent tools (raw) for MAID: ${masterAccountId}, API fetch limit: ${apiFetchLimit}`);
        
        const response = await dependencies.internal.client.get(`/internal/v1/data/generations/users/${masterAccountId}/most-frequent-tools`, {
            params: { limit: apiFetchLimit }
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
            
            let toolDef = dependencies.toolRegistry.getToolById(toolUsage.toolId);
            if (toolDef) {
                logger.debug(`[SettingsMenu] Found toolDef for '${toolUsage.toolId}' using getToolById.`);
            } else {
                logger.debug(`[SettingsMenu] toolDef for '${toolUsage.toolId}' NOT found using getToolById. Attempting findByDisplayName...`);
                toolDef = dependencies.toolRegistry.findByDisplayName(toolUsage.toolId);
                if (toolDef) {
                    logger.debug(`[SettingsMenu] Found toolDef for display name '${toolUsage.toolId}' (actual ID: ${toolDef.toolId}) using findByDisplayName.`);
                } else {
                    logger.warn(`[SettingsMenu] Tool with identifier '${toolUsage.toolId}' not found in ToolRegistry by ID or DisplayName. Skipping.`);
                }
            }

            if (toolDef) {
                validEnrichedTools.push({
                    toolId: toolDef.toolId, // Store the canonical toolId
                    usageCount: toolUsage.usageCount,
                    displayName: toolDef.displayName || toolDef.toolId // Fallback for display name
                });
                logger.debug(`[SettingsMenu] Added valid tool: '${toolDef.toolId}', displayName: '${toolDef.displayName || toolDef.toolId}'`);
            }
        }
        logger.info(`[SettingsMenu] Filtered to ${validEnrichedTools.length} valid frequent tools for MAID: ${masterAccountId}`);
        return validEnrichedTools;

    } catch (error) {
        logger.error(`[SettingsMenu] Error fetching/filtering most frequent tools for MAID ${masterAccountId}.`, error);
        if (error.response && error.response.data) {
            logger.error('[SettingsMenu] Axios error response data:', error.response.data);
        }
        return [];
    }
}

/**
 * Handles the initial /settings command.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The Telegram message object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleSettingsCommand(bot, msg, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    logger.info(`[SettingsMenu] /settings command received from ${username} (MAID: ${masterAccountId}, ChatID: ${chatId})`);

    try {
        const menu = await buildMainMenu(masterAccountId, dependencies);
        await sendEscapedMessage(bot, chatId, menu.text, {
            reply_markup: menu.reply_markup,
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        logger.error('[SettingsMenu] Error in handleSettingsCommand:', error);
        await sendEscapedMessage(bot, chatId, "Sorry, I couldn't open the settings menu right now. Please try again later.", { reply_to_message_id: msg.message_id });
    }
}

/**
 * Handles callback queries for the settings menu.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The Telegram callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleSettingsCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, userSettingsService, toolRegistry } = dependencies;
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const data = callbackQuery.data;
    const username = callbackQuery.from.username || callbackQuery.from.first_name;

    logger.info(`[SettingsMenu] Callback received: '${data}' from ${username} (MAID: ${masterAccountId}, ChatID: ${chatId}, MsgID: ${messageId})`);

    try {
        let menu;
        let newText;
        let newKeyboard;

        if (data === 'set_nvm') {
            await bot.deleteMessage(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Settings closed." });
            return;
        }

        if (data === 'set_main') {
            menu = await buildMainMenu(masterAccountId, dependencies);
            newText = menu.text;
            newKeyboard = menu.reply_markup;
        } else if (data.startsWith('set_all_tools_')) {
            const page = parseInt(data.substring('set_all_tools_'.length), 10) || 0;
            menu = await buildAllToolsMenu(masterAccountId, username, page, dependencies);
            newText = menu.text;
            newKeyboard = menu.reply_markup;
        } else if (data === 'no_op_page_indicator') {
            await bot.answerCallbackQuery(callbackQuery.id, {text: "☹︎"}); // Just acknowledge, do nothing
            return;
        } else if (data.startsWith('set_viewtool_')) {
            const displayNameFromCallback = data.substring('set_viewtool_'.length);
            const toolDef = dependencies.toolRegistry.findByDisplayName(displayNameFromCallback.replace(/_/g, ' ')); // Convert underscores back to spaces
            if (toolDef) {
                menu = await buildToolParamsMenu(masterAccountId, toolDef.toolId, dependencies); // Pass canonical toolId
                newText = menu.text;
                newKeyboard = menu.reply_markup;
            } else {
                logger.error(`[SettingsMenu] Callback 'set_viewtool_': ToolDef not found for displayName '${displayNameFromCallback}'.`);
                newText = "Error: Could not find the tool definition. Please try again.";
                // Basic keyboard to go back or NVM
                newKeyboard = { inline_keyboard: [[{ text: "⇱", callback_data: "set_main" }], [{ text: "Ⓧ", callback_data: "set_nvm" }]] };
            }
        } else if (data.startsWith('set_param_')) {
            // Parse callback data: set_param_<displayName>_<paramName>
            const paramData = data.substring('set_param_'.length);
            const firstUnderscore = paramData.indexOf('_');
            if (firstUnderscore === -1) {
                logger.error(`[SettingsMenu] Malformed set_param_ callback: '${data}'`);
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Malformed parameter callback.', show_alert: true });
                return;
            }
            const displayNameFromCallback = paramData.substring(0, firstUnderscore).replace(/_/g, ' ');
            const paramName = paramData.substring(firstUnderscore + 1);
            const toolDef = toolRegistry.findByDisplayName(displayNameFromCallback);
            if (toolDef) {
                menu = await buildEditParamMenu(masterAccountId, toolDef.toolId, paramName, dependencies);
                // This interaction now sends a new message asking for the new value
                // and sets up a reply context, so we don't edit the original menu here.
                const sentMessage = await sendEscapedMessage(bot, chatId, menu.text, {
                    reply_markup: menu.reply_markup
                });
                if (dependencies.replyContextManager) {
                    const context = {
                        type: 'settings_param_edit',
                        masterAccountId: masterAccountId,
                        toolId: toolDef.toolId,
                        paramKey: paramName
                    };
                    dependencies.replyContextManager.addContext(sentMessage, context);
                    logger.info(`[SettingsMenu] Stored reply context for 'settings_param_edit' for MAID ${masterAccountId}, Tool: ${toolDef.displayName}, Param: ${paramName}.`);
                } else {
                    logger.error("[SettingsMenu] replyContextManager is not available in dependencies. Cannot set context for param edit.");
                }
            } else {
                logger.error(`[SettingsMenu] Callback 'set_param_': ToolDef not found for displayName '${displayNameFromCallback}'.`);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `Error: Could not find tool for key ${displayNameFromCallback}.` });
            }
            return;
        } else if (data.startsWith('set_back_main_from_tool_')) {
            menu = await buildMainMenu(masterAccountId, dependencies);
            newText = menu.text;
            newKeyboard = menu.reply_markup;
        } else if (data.startsWith('set_back_toolparams_')) {
            const toolCallbackKey = data.substring('set_back_toolparams_'.length);
            const toolDef = dependencies.toolRegistry.findByDisplayName(toolCallbackKey.replace(/_/g, ' '));
            if (toolDef) {
                menu = await buildToolParamsMenu(masterAccountId, toolDef.toolId, dependencies);
                newText = menu.text;
                newKeyboard = menu.reply_markup;
            } else {
                logger.error(`[SettingsMenu] Callback 'set_back_toolparams_': ToolDef not found for callback key '${toolCallbackKey}'.`);
                newText = "Error: Could not find tool to go back to. Please try again.";
                newKeyboard = { inline_keyboard: [[{ text: "⇱", callback_data: "set_main" }], [{ text: "Ⓧ", callback_data: "set_nvm" }]] };
            }
        } else {
            logger.warn(`[SettingsMenu] Unhandled callback data: ${data}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Action not implemented yet." });
            return;
        }

        if (newText && newKeyboard) {
            await editEscapedMessageText(bot, chatId, messageId, newText, {
                reply_markup: newKeyboard
            });
        }
        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        logger.error('[SettingsMenu] Error in handleSettingsCallback:', error);
        if (error.message.includes('message is not modified')) {
            logger.warn('[SettingsMenu] Attempted to edit message with identical content.');
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Already on this view." });
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error processing action." });
        }
    }
}

/**
 * Handles replies for editing a parameter value.
 * This is triggered by the MessageReplyDispatcher.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The user's reply message.
 * @param {object} context - The context stored for this reply.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleSettingsReply(bot, msg, context, dependencies) {
    const { logger, userSettingsService } = dependencies;
    const { toolId, paramKey, masterAccountId } = context;
    const newValue = msg.text.trim();

    logger.info(`[SettingsMenu] Received reply for param edit. MAID: ${masterAccountId}, Tool: ${toolId}, Param: ${paramKey}, NewValue: '${newValue}'`);

    try {
        const result = await handleParameterValueReply(masterAccountId, toolId, paramKey, newValue, dependencies);
        
        if (result.success) {
            await sendEscapedMessage(bot, msg.chat.id, `✅ Setting updated successfully for ${toolId}!`, { reply_to_message_id: msg.message_id });

            // Find the original menu message to edit it
            if (msg.reply_to_message && msg.reply_to_message.message_id) {
                const menu = await buildToolParamsMenu(masterAccountId, toolId, dependencies);
                await editEscapedMessageText(bot, msg.chat.id, msg.reply_to_message.message_id, menu.text, {
                    reply_markup: menu.reply_markup
                });
            }
        } else {
            await sendEscapedMessage(bot, msg.chat.id, `⚠️ ${result.error}`, { reply_to_message_id: msg.message_id });
        }
    } catch (error) {
        logger.error(`[SettingsMenu] Error in handleSettingsReply for MAID ${masterAccountId}:`, error);
        await sendEscapedMessage(bot, msg.chat.id, "Sorry, there was a critical error trying to save that setting.", { reply_to_message_id: msg.message_id });
    }
}

/**
 * Builds the main settings menu.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildMainMenu(masterAccountId, dependencies) {
    const { logger } = dependencies;
    let text = '*Settings*\n\n';
    text += 'Here you can manage your preferences for various tools.\n\n';
    // getMostFrequentlyUsedTools will use the passed logger and toolRegistry.
    const frequentTools = await getMostFrequentlyUsedTools(masterAccountId, dependencies);

    const keyboard = [];
    // keyboard.push([{ text: "Preferences", callback_data: "set_prefs" }]); // Temporarily hidden
    keyboard.push([{ text: "All Tools", callback_data: "set_all_tools_0" }]); // Page 0 for all tools

    const toolRows = [];
    for (let i = 0; i < frequentTools.length; i += 2) {
        const row = [];
        // Use short displayName for callback_data, ensure it's URL-safe if necessary (assuming simple names for now)
        const toolCallbackKey1 = frequentTools[i].displayName.replace(/\s+/g, '_'); // Basic safety
        row.push({ text: frequentTools[i].displayName, callback_data: `set_viewtool_${toolCallbackKey1}` });
        if (i + 1 < frequentTools.length) {
            const toolCallbackKey2 = frequentTools[i + 1].displayName.replace(/\s+/g, '_'); // Basic safety
            row.push({ text: frequentTools[i + 1].displayName, callback_data: `set_viewtool_${toolCallbackKey2}` });
        }
        toolRows.push(row);
    }
    keyboard.push(...toolRows);
    keyboard.push([{ text: "Ⓧ", callback_data: "set_nvm" }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Builds the tool-specific parameters menu.
 * @param {string} masterAccountId
 * @param {string} toolKey - The canonical toolId.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildToolParamsMenu(masterAccountId, toolKey, dependencies) {
    const { logger, toolRegistry, userSettingsService } = dependencies;
    const toolDef = toolRegistry.getToolById(toolKey); // toolKey is canonical ID here

    if (!toolDef) {
        logger.error(`[SettingsMenu] buildToolParamsMenu: Could not find toolDef for toolKey '${toolKey}'.`);
        return {
            text: "Error: Tool not found. Please go back.",
            reply_markup: { inline_keyboard: [
                [{ text: "⇱", callback_data: "set_main" }],
                [{ text: "Ⓧ", callback_data: "set_nvm" }]
            ]}
        };
    }

    const text = toolDef.description || `Settings for ${toolDef.displayName}`;
    const keyboard = [];
    let userSettings = {};

    try {
        // Use the reliable helper function to get user-specific overrides
        userSettings = await getToolSettings(masterAccountId, toolKey, dependencies);
        logger.info(`[SettingsMenu] Fetched user settings for MAID ${masterAccountId}, Tool ${toolKey}: ${JSON.stringify(userSettings)}`);
    } catch (err) {
        logger.error(`[SettingsMenu] Error fetching user settings in buildToolParamsMenu for MAID ${masterAccountId}, Tool ${toolKey}:`, err);
        // On error, proceed with empty settings; defaults from the tool definition will be used.
    }

    if (toolDef.inputSchema) {
        for (const paramName in toolDef.inputSchema) {
            const paramDef = toolDef.inputSchema[paramName];
            // This logic correctly merges the user's saved settings with the tool's defaults.
            const currentValue = userSettings[paramName] !== undefined ? userSettings[paramName] : (paramDef.default !== undefined ? paramDef.default : 'Not set');
            
            const displayParamName = formatParamNameForDisplay(paramName);
            let buttonText = `${displayParamName}`;

            if (typeof currentValue === 'string' && currentValue.length > 15) {
                buttonText += `: ${currentValue.substring(0,12)}...`;
            } else {
                 buttonText += `: ${currentValue}`;
            }
            // Use displayName (with underscores for spaces) in callback data
            const displayNameForCallback = toolDef.displayName.replace(/\s+/g, '_');
            keyboard.push([{ text: buttonText, callback_data: `set_param_${displayNameForCallback}_${paramName}` }]);
        }
    } else {
        keyboard.push([{ text: "This tool has no configurable parameters.", callback_data: "no_op_params"}] )
    }

    // Use the same short callbackToolKey for the back button
    const callbackToolKeyForBack = toolDef.displayName.replace(/\s+/g, '_');
    keyboard.push([{ text: "⇱", callback_data: `set_back_main_from_tool_${callbackToolKeyForBack}` }, { text: "Ⓧ", callback_data: "set_nvm" }]);
    
    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Builds the parameter editing menu.
 * @param {string} masterAccountId
 * @param {string} canonicalToolId - The canonical toolId (e.g. comfy-xyz)
 * @param {string} paramName - The name of the parameter to edit.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildEditParamMenu(masterAccountId, canonicalToolId, paramName, dependencies) {
    const { logger, toolRegistry, userSettingsService } = dependencies;
    const toolDef = toolRegistry.getToolById(canonicalToolId);
    if (!toolDef) {
        logger.error(`[SettingsMenu] buildEditParamMenu: Could not find toolDef for canonicalToolId '${canonicalToolId}'.`);
        return { text: "Error: Could not find tool to edit.", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: 'set_main' }]] } };
    }

    const toolSettings = await getToolSettings(masterAccountId, canonicalToolId, dependencies);
    const paramDef = toolDef.inputSchema[paramName];
    const currentValue = toolSettings[paramName] !== undefined ? toolSettings[paramName] : (paramDef?.default ?? 'Not set');

    let text = `Editing default for: ${formatParamNameForDisplay(paramName)}\n`;
    text += `Tool: ${toolDef.displayName}\n\n`;
    text += `Current Default: ${String(currentValue)}\n\n`;
    text += "Please reply to this message with the new default value.";
    
    if (paramDef?.description) {
        text += `\n\n${paramDef.description}`;
    }
    if (paramDef?.type === 'boolean') {
        text += `\n(Send 'true' or 'false')`;
    }

    const toolCallbackKey = toolDef.displayName.replace(/\s+/g, '_');
    const keyboard = [
        [{ text: "⬅️ Back to Tool Settings", callback_data: `set_viewtool_${toolCallbackKey}` }]
    ];

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Handles a user's reply containing a new value for a parameter.
 * @param {string} masterAccountId
 * @param {string} toolId - The canonical toolId of the tool.
 * @param {string} paramName - Name of the parameter.
 * @param {string} newValue - The new value provided by the user.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<{success: boolean, message: string, canonicalToolId?: string}>}
 */
async function handleParameterValueReply(masterAccountId, toolId, paramName, newValue, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const toolDef = toolRegistry.getToolById(toolId);
    if (!toolDef) {
        logger.error(`[SettingsMenu] handleParameterValueReply: ToolDef not found for toolId '${toolId}'.`);
        return { success: false, message: `Error: Tool with ID '${toolId}' not found.` };
    }

    const canonicalToolId = toolDef.toolId;
    const paramDef = toolDef.inputSchema ? toolDef.inputSchema[paramName] : null;
    if (!paramDef) {
        logger.error(`[SettingsMenu] handleParameterValueReply: ParamDef '${paramName}' not found for tool '${canonicalToolId}'.`);
        return { success: false, message: `Error: Parameter '${paramName}' not found for tool '${toolDef.displayName}'.` };
    }

    // Basic Validation (more sophisticated validation needed later)
    let parsedValue = newValue;
    let validationError = null;

    switch (paramDef.type) {
        case 'number':
        case 'integer':
            parsedValue = parseFloat(newValue);
            if (isNaN(parsedValue)) {
                validationError = `Invalid number: '${newValue}'. Please provide a valid number.`;
            }
            // TODO: Add min/max/step validation if defined in paramDef (e.g., paramDef.constraints.min)
            break;
        case 'boolean':
            if (['true', 'yes', '1', 'on'].includes(newValue.toLowerCase())) parsedValue = true;
            else if (['false', 'no', '0', 'off'].includes(newValue.toLowerCase())) parsedValue = false;
            else validationError = `Invalid boolean: '${newValue}'. Use true/false, yes/no, etc.`;
            break;
        case 'string':
            // TODO: Add regex/length validation if defined in paramDef
            parsedValue = newValue; 
            break;
        default:
            logger.warn(`[SettingsMenu] handleParameterValueReply: Validation not implemented for type '${paramDef.type}'. Accepting as is.`);
            parsedValue = newValue; // Accept as is for unhandled types for now
            break;
    }

    if (validationError) {
        logger.warn(`[SettingsMenu] handleParameterValueReply: Validation failed for '${paramName}' (Tool: ${toolDef.displayName}) with value '${newValue}'. Error: ${validationError}`);
        return { success: false, message: validationError };
    }

    const settingsToUpdate = { [paramName]: parsedValue };
    let saveResult;

    try {
        saveResult = await saveToolSettings(masterAccountId, canonicalToolId, settingsToUpdate, dependencies);
        logger.info(`[SettingsMenu] Called saveToolSettings for MAID ${masterAccountId}, Tool ${canonicalToolId}. Result: ${JSON.stringify(saveResult)}`);
    } catch (err) {
        logger.error(`[SettingsMenu] Error calling saveToolSettings for MAID ${masterAccountId}, Tool ${canonicalToolId}:`, err);
        saveResult = { success: false, message: err.message || "An error occurred while saving your settings." };
    }

    if (saveResult.success) {
        logger.info(`[SettingsMenu] Parameter '${paramName}' for tool '${toolDef.displayName}' (ID: ${canonicalToolId}) updated to '${parsedValue}' for MAID ${masterAccountId}.`);
        return { 
            success: true, 
            message: `Successfully updated '${paramName}' to '${parsedValue}'.`,
            canonicalToolId: canonicalToolId // Return canonicalId for navigation
        };
    } else {
        logger.error(`[SettingsMenu] Failed to save parameter '${paramName}' for tool '${toolDef.displayName}'. Error: ${saveResult.message}`);
        return { success: false, message: saveResult.message || "Failed to update setting. Please try again." };
    }
}

// Placeholder for "All Tools" menu
async function buildAllToolsMenu(masterAccountId, username, page = 0, dependencies) {
    const text = "Select a tool to configure its settings (Page " + (page + 1) + "):";
    
    const allTools = dependencies.toolRegistry.getAllTools()
        .filter(t => t.platformHints?.supportedClients?.includes('telegram')) // Ensure tool is available on Telegram
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const totalTools = allTools.length;
    const totalPages = Math.ceil(totalTools / ITEMS_PER_PAGE_ALL_TOOLS);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1)); // Ensure page is within bounds

    const startIndex = currentPage * ITEMS_PER_PAGE_ALL_TOOLS;
    const endIndex = startIndex + ITEMS_PER_PAGE_ALL_TOOLS;
    const toolsForPage = allTools.slice(startIndex, endIndex);

    const keyboard = [];
    keyboard.push([{ text: "⇱", callback_data: "set_main" }]);
    for (let i = 0; i < toolsForPage.length; i += 2) {
        const row = [];
        const tool1 = toolsForPage[i];
        const toolCallbackKey1 = (tool1.displayName || tool1.toolId).replace(/\s+/g, '_');
        row.push({ text: (tool1.displayName || tool1.toolId), callback_data: `set_viewtool_${toolCallbackKey1}` });

        if (i + 1 < toolsForPage.length) {
            const tool2 = toolsForPage[i+1];
            const toolCallbackKey2 = (tool2.displayName || tool2.toolId).replace(/\s+/g, '_');
            row.push({ text: (tool2.displayName || tool2.toolId), callback_data: `set_viewtool_${toolCallbackKey2}` });
        }
        keyboard.push(row);
    }

    const navRow = [];
    if (currentPage > 0) {
        navRow.push({ text: "⇤", callback_data: `set_all_tools_${currentPage - 1}` });
    }
    
    // Simple page indicator, not a button itself
    if (totalPages > 1) {
         // Add a non-clickable page indicator if there's more than one page
        navRow.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: "no_op_page_indicator" });
    }

    if (currentPage < totalPages - 1) {
        navRow.push({ text: "⇥", callback_data: `set_all_tools_${currentPage + 1}` });
    }

    if (navRow.length > 0) {
        keyboard.push(navRow);
    }

    
    keyboard.push([{ text: "Ⓧ", callback_data: "set_nvm" }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

// Placeholder for User Preferences Menu
async function buildUserPreferencesMenu(masterAccountId, username, { logger, userSettingsService }) {
    // This is a placeholder for future functionality.
    const text = `User Preferences for ${username}`;
    const keyboard = [
        [{ text: "Work in Progress", callback_data: "no_op" }],
        [{ text: "⬅️ Back to Settings", callback_data: "set_main" }]
    ];
    return { text, reply_markup: { inline_keyboard: keyboard } };
}

/**
 * Builds the UI for tweaking parameters of a specific generation.
 * @param {string} masterAccountId - MAID of the user performing the tweak.
 * @param {string} canonicalToolId - The canonical toolId of the generation.
 * @param {object} currentTweakedParams - The current set of parameters (base from original gen + any user tweaks so far).
 * @param {string} originalUserCommandMessageId - Message ID of the user's original command.
 * @param {string} originalUserCommandChatId - Chat ID of the user's original command.
 * @param {string} generationId - The ID of the generation being tweaked.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService (optional for defaults if a param is missing) }.
 * @returns {Promise<object>} Menu object { text, reply_markup }.
 */
async function buildTweakUIMenu(masterAccountId, canonicalToolId, currentTweakedParams, originalUserCommandMessageId, originalUserCommandChatId, generationId, dependencies) {
  const { logger, toolRegistry, userSettingsService } = dependencies;
  logger.info(`[SettingsMenu][Tweak] buildTweakUIMenu called with canonicalToolId: '${canonicalToolId}' for GenID: ${generationId}`);
  const toolDef = toolRegistry.getToolById(canonicalToolId);
  logger.info(`[SettingsMenu][Tweak] toolDef after getToolById('${canonicalToolId}'): ${JSON.stringify(toolDef)}`);

  if (!toolDef) {
    logger.error(`[SettingsMenu][Tweak] buildTweakUIMenu: Could not find toolDef for canonicalToolId '${canonicalToolId}'.`);
    return {
      text: "Error: Tool definition not found. Cannot tweak.",
      reply_markup: { inline_keyboard: [[{ text: "❌ Close", callback_data: `tweak_cancel:${generationId}` }]] }
    };
  }

  const shortGenId = generationId.substring(generationId.length - 6);
  const text = `✎ Tweaking ${toolDef.displayName} (for Gen ${shortGenId})`;
  const keyboard = [];

  logger.info(`[SettingsMenu][Tweak] toolDef.displayName: '${toolDef.displayName}', toolDef.inputSchema keys: ${toolDef.inputSchema ? Object.keys(toolDef.inputSchema).join(', ') : 'null'}`);

  if (toolDef.inputSchema) {
    for (const paramName in toolDef.inputSchema) {
      const paramDef = toolDef.inputSchema[paramName];
      const currentValue = currentTweakedParams[paramName] !== undefined 
        ? currentTweakedParams[paramName] 
        : (paramDef.default !== undefined ? paramDef.default : 'Not set');
      
      const displayParamName = formatParamNameForDisplay(paramName);
      let buttonText = `${displayParamName}`;

      if (typeof currentValue === 'string' && currentValue.length > 15) {
        buttonText += `: ${currentValue.substring(0,12)}...`;
      } else {
        buttonText += `: ${currentValue}`;
      }
      // Callback includes generationId to keep context for edits and applying tweaks
      keyboard.push([{ text: buttonText, callback_data: `tpe:${generationId}:${paramName}` }]);
    }
  } else {
    keyboard.push([{ text: "This tool has no configurable parameters.", callback_data: "no_op_params"}]);
  }

  // Action buttons for the tweak menu
  keyboard.push([
    { text: "🚀 Rerun Tweaked", callback_data: `tweak_apply:${generationId}` },
  ]);
  keyboard.push([
    { text: "❌ Cancel Tweak", callback_data: `tweak_cancel:${generationId}` }
  ]);
  
  return {
    text,
    reply_markup: { inline_keyboard: keyboard }
  };
}

/**
 * Builds the prompt for editing a specific parameter during a tweak session.
 * @param {string} masterAccountId - MAID of the user performing the tweak.
 * @param {string} generationId - The ID of the generation being tweaked.
 * @param {string} canonicalToolId - The canonical toolId of the generation.
 * @param {string} paramName - The name of the parameter to edit.
 * @param {object} pendingTweaksStore - The entire pendingTweaks store from bot.js.
 * @param {object} dependencies - { logger, toolRegistry }
 * @returns {Promise<object>} Menu object { text, reply_markup } for the edit prompt.
 */
async function buildTweakParamEditPrompt(masterAccountId, generationId, canonicalToolId, paramName, pendingTweaksStore, dependencies) {
    const { logger, toolRegistry } = dependencies;
    logger.info(`[SettingsMenu][Tweak] buildTweakParamEditPrompt called for GenID: ${generationId}, Tool: ${canonicalToolId}, Param: ${paramName}`);

    const toolDef = toolRegistry.getToolById(canonicalToolId);
    const paramDef = toolDef?.inputSchema?.[paramName];

    if (!toolDef || !paramDef) {
        logger.error(`[SettingsMenu][Tweak] buildTweakParamEditPrompt: Could not find toolDef or paramDef for Tool: ${canonicalToolId}, Param: ${paramName}`);
        return { text: "Error: Tool or parameter definition not found.", reply_markup: { inline_keyboard: [[{text: "Back", callback_data: `tweak_gen_menu_render:${generationId}`}]] } };
    }

    const pendingTweaks = pendingTweaksStore.get(generationId) || {};
    const currentToolTweaks = pendingTweaks[canonicalToolId] || {};

    const currentValue = currentToolTweaks[paramName] !== undefined 
        ? currentToolTweaks[paramName] 
        : (paramDef.default !== undefined ? paramDef.default : 'Not set');

    const shortGenId = generationId.substring(generationId.length - 6);
    const displayParamName = formatParamNameForDisplay(paramName);
    
    let promptText = ""; // promptMarker + "\n\n"; 

    const displayableParamName = displayParamName;
    const displayableToolName = toolDef.displayName;
    const displayableShortGenId = shortGenId;

    promptText += `✎ Editing ${displayableParamName} for ${displayableToolName} (for Gen ${displayableShortGenId})\n`;
    promptText += `Current value: ${String(currentValue)}\n\n`;
    promptText += `Please reply to this message with the new value for ${displayableParamName}.`;
    
    if (paramDef.description) {
        promptText += `\n\n${paramDef.description}`;
    }
    if (paramDef.type === 'boolean') {
        promptText += `\n(Send 'true' or 'false')`;
    }

    const keyboard = [
        [{ text: "🔙 Cancel Edit (Back to Tweak Menu)", callback_data: `tweak_gen_menu_render:${generationId}` }] 
    ];

    return {
        text: promptText,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * The handler for the /settings command.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The message object from the command.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function settingsCommandHandler(bot, msg, dependencies) {
    const { logger } = dependencies;
    const username = msg.from.username || msg.from.first_name;
    logger.info(`[SettingsMenu] /settings command received from Telegram User ID: ${msg.from.id}`);
    try {
        const findOrCreateResponse = await dependencies.internal.client.post('/internal/v1/data/users/find-or-create', {
            platform: 'telegram',
            platformId: msg.from.id.toString(),
            platformContext: { firstName: msg.from.first_name, username: msg.from.username }
        });
        const masterAccountId = findOrCreateResponse.data.masterAccountId;

        await handleSettingsCommand(bot, msg, masterAccountId, dependencies);
    } catch (error) {
        logger.error(`[SettingsMenu] Critical error in settingsCommandHandler for ${username}:`, error.stack || error);
        await sendEscapedMessage(bot, msg.chat.id, "A critical error occurred while handling your command.");
    }
}

/**
 * The handler for callback queries related to the settings menu.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function settingsCallbackHandler(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const username = callbackQuery.from.username || callbackQuery.from.first_name;
    logger.info(`[SettingsMenu] settingsCallbackHandler triggered for ${username} with data: ${callbackQuery.data}`);
    try {
        await handleSettingsCallback(bot, callbackQuery, masterAccountId, dependencies);
    } catch (error) {
        logger.error(`[SettingsMenu] Critical error in settingsCallbackHandler for ${username}:`, error.stack || error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "A critical error occurred.", show_alert: true });
    }
}

/**
 * Registers all handlers for the settings menu feature.
 * @param {object} dispatcherInstances - The dispatcher instances object.
 * @param {CommandDispatcher} dispatcherInstances.commandDispatcher - The command dispatcher.
 * @param {CallbackQueryDispatcher} dispatcherInstances.callbackQueryDispatcher - The callback query dispatcher.
 * @param {MessageReplyDispatcher} dispatcherInstances.messageReplyDispatcher - The message reply dispatcher.
 * @param {object} dependencies - The dependencies needed by the handlers.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher, messageReplyDispatcher } = dispatcherInstances;
    const { logger } = dependencies;

    if (!commandDispatcher || !callbackQueryDispatcher || !messageReplyDispatcher) {
        logger.error('[SettingsMenuManager] Dispatcher instances not provided. Cannot register handlers.');
        return;
    }
    
    // Register the command and callback handlers
    commandDispatcher.register(/^\/settings(?:@\w+)?/i, settingsCommandHandler);
    callbackQueryDispatcher.register('set_', settingsCallbackHandler);
    callbackQueryDispatcher.register('tweak_', settingsCallbackHandler);

    // Register the reply handler for when a user provides a new parameter value
    messageReplyDispatcher.register('settings_param_edit', handleSettingsReply);

    logger.info('[SettingsMenuManager] Handlers registered.');
}

// TODO: Implement other menu building functions as per ADR-007
// async function buildAllToolsMenu(masterAccountId, page = 0, { logger, toolRegistry, userSettingsService }) { ... }
// async function buildEditParamMenu(masterAccountId, toolKey, paramName, { logger, toolRegistry, userSettingsService }) { ... }
// async function buildPreferencesMenu(masterAccountId, { logger, userSettingsService }) { ... }

module.exports = {
    registerHandlers
}; 