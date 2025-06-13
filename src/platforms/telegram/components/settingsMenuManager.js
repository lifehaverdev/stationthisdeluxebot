// src/platforms/telegram/components/settingsMenuManager.js
const { ObjectId } = require('../../../core/services/db/BaseDB');
const internalApiClient = require('../../../utils/internalApiClient');
// const UserSettingsService = require('../../../core/services/userSettingsService'); // Direct import not needed if passed via dependencies
const { escapeMarkdownV2 } = require('../../../utils/stringUtils'); // ADDED

// Dependencies like logger, toolRegistry, userSettingsService will be passed into functions.

const TELEGRAM_API_KEY = process.env.INTERNAL_API_KEY_TELEGRAM; // Ensure this is defined
const ITEMS_PER_PAGE_ALL_TOOLS = 6; // 3 rows of 2 tools

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
 * @param {object} toolRegistry - The ToolRegistry instance.
 * @param {object} logger - The Logger instance.
 * @param {number} [displayLimit=4] - The maximum number of tools to display in the menu.
 * @returns {Promise<Array<object>>} Array of tool objects { toolId, displayName, usageCount } or empty array on error.
 */
async function getMostFrequentlyUsedTools(masterAccountId, toolRegistry, logger, displayLimit = 4) {
    if (!masterAccountId) {
        logger.error('[SettingsMenu] MasterAccountId is required to fetch frequent tools.');
        return [];
    }
    try {
        const apiFetchLimit = displayLimit * 3; // Fetch more to account for filtering
        logger.info(`[SettingsMenu] Fetching most frequent tools (raw) for MAID: ${masterAccountId}, API fetch limit: ${apiFetchLimit}`);
        
        const response = await internalApiClient.get(`/generations/users/${masterAccountId}/most-frequent-tools`, {
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
            if (validEnrichedTools.length >= displayLimit) {
                break;
            }
            logger.debug(`[SettingsMenu] Processing toolUsage: toolId from API '${toolUsage.toolId}', usageCount: ${toolUsage.usageCount}`);
            
            let toolDef = toolRegistry.getToolById(toolUsage.toolId);
            if (toolDef) {
                logger.debug(`[SettingsMenu] Found toolDef for '${toolUsage.toolId}' using getToolById.`);
            } else {
                logger.debug(`[SettingsMenu] toolDef for '${toolUsage.toolId}' NOT found using getToolById. Attempting findByDisplayName...`);
                toolDef = toolRegistry.findByDisplayName(toolUsage.toolId);
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
 * @param {object} dependencies - Object containing { logger, toolRegistry, userSettingsService (optional) }.
 */
async function handleSettingsCommand(bot, msg, masterAccountId, { logger, toolRegistry, userSettingsService }) {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    logger.info(`[SettingsMenu] /settings command received from ${username} (MAID: ${masterAccountId}, ChatID: ${chatId})`);

    try {
        const menu = await buildMainMenu(masterAccountId, username, { logger, toolRegistry, userSettingsService });
        await bot.sendMessage(chatId, menu.text, {
            reply_markup: menu.reply_markup,
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        logger.error('[SettingsMenu] Error in handleSettingsCommand:', error);
        await bot.sendMessage(chatId, "Sorry, I couldn't open the settings menu right now. Please try again later.", { reply_to_message_id: msg.message_id });
    }
}

/**
 * Handles callback queries for the settings menu.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The Telegram callback query object.
 * @param {string} masterAccountId - The user's master account ID (derived from the original command).
 * @param {object} dependencies - Object containing { logger, toolRegistry, userSettingsService (optional), replyContextManager }.
 */
async function handleSettingsCallback(bot, callbackQuery, masterAccountId, { logger, toolRegistry, userSettingsService, replyContextManager }) {
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
            menu = await buildMainMenu(masterAccountId, username, { logger, toolRegistry, userSettingsService });
            newText = menu.text;
            newKeyboard = menu.reply_markup;
        } else if (data.startsWith('set_all_tools_')) {
            const page = parseInt(data.substring('set_all_tools_'.length), 10) || 0;
            menu = await buildAllToolsMenu(masterAccountId, username, page, { logger, toolRegistry, userSettingsService });
            newText = menu.text;
            newKeyboard = menu.reply_markup;
        } else if (data === 'no_op_page_indicator') {
            await bot.answerCallbackQuery(callbackQuery.id, {text: "☹︎"}); // Just acknowledge, do nothing
            return;
        } else if (data.startsWith('set_viewtool_')) {
            const displayNameFromCallback = data.substring('set_viewtool_'.length);
            const toolDef = toolRegistry.findByDisplayName(displayNameFromCallback.replace(/_/g, ' ')); // Convert underscores back to spaces
            if (toolDef) {
                menu = await buildToolParamsMenu(masterAccountId, toolDef.toolId, { logger, toolRegistry, userSettingsService }); // Pass canonical toolId
                newText = menu.text;
                newKeyboard = menu.reply_markup;
            } else {
                logger.error(`[SettingsMenu] Callback 'set_viewtool_': ToolDef not found for displayName '${displayNameFromCallback}'.`);
                newText = "Error: Could not find the tool definition. Please try again.";
                // Basic keyboard to go back or NVM
                newKeyboard = { inline_keyboard: [[{ text: "⇱", callback_data: "set_main" }], [{ text: "Ⓧ", callback_data: "set_nvm" }]] };
            }
        } else if (data.startsWith('set_param_')) {
            const parts = data.substring('set_param_'.length).split('_');
            const toolCallbackKey = parts[0]; // This is the displayName based callback key
            const paramName = parts.slice(1).join('_'); // Param name might have underscores

            const toolDef = toolRegistry.findByDisplayName(toolCallbackKey.replace(/_/g, ' '));
            if (toolDef) {
                menu = await buildEditParamMenu(masterAccountId, toolDef.toolId, paramName, { logger, toolRegistry, userSettingsService });
                // newText = menu.text;
                // newKeyboard = menu.reply_markup;
                
                // This is where the prompt is about to be sent. We will send it, then store context for the reply.
                const sentMessage = await bot.editMessageText(menu.text, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: menu.reply_markup
                });

                if (replyContextManager) {
                    const context = {
                        type: 'settings_param_edit',
                        masterAccountId: masterAccountId,
                        toolDisplayName: toolDef.displayName,
                        paramName: paramName
                    };
                    replyContextManager.addContext(sentMessage, context);
                    logger.info(`[SettingsMenu] Stored reply context for 'settings_param_edit' for MAID ${masterAccountId}, Tool: ${toolDef.displayName}, Param: ${paramName}.`);
                } else {
                    logger.error('[SettingsMenu] ReplyContextManager not found in dependencies. Cannot set context for settings reply.');
                }
                
                await bot.answerCallbackQuery(callbackQuery.id);
                return; // Return early as we've handled the full interaction here.

            } else {
                logger.error(`[SettingsMenu] Callback 'set_param_': ToolDef not found for callback key '${toolCallbackKey}'.`);
                newText = "Error: Could not find tool to edit parameter. Please try again.";
                newKeyboard = { inline_keyboard: [[{ text: "⇱", callback_data: "set_main" }], [{ text: "Ⓧ", callback_data: "set_nvm" }]] };
            }
        } else if (data.startsWith('set_back_main_from_tool_')) {
            menu = await buildMainMenu(masterAccountId, username, { logger, toolRegistry, userSettingsService });
            newText = menu.text;
            newKeyboard = menu.reply_markup;
        } else if (data.startsWith('set_back_toolparams_')) {
            const toolCallbackKey = data.substring('set_back_toolparams_'.length);
            const toolDef = toolRegistry.findByDisplayName(toolCallbackKey.replace(/_/g, ' '));
            if (toolDef) {
                menu = await buildToolParamsMenu(masterAccountId, toolDef.toolId, { logger, toolRegistry, userSettingsService });
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
            await bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: messageId,
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
 * Builds the main settings menu.
 * @param {string} masterAccountId
 * @param {string} username
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildMainMenu(masterAccountId, username, { logger, toolRegistry, userSettingsService }) {
    const text = `${username}'s stationthisbot settings`;
    // Note: userSettingsService is passed here but not used yet by buildMainMenu directly.
    // getMostFrequentlyUsedTools will use the passed logger and toolRegistry.
    const frequentlyUsedTools = await getMostFrequentlyUsedTools(masterAccountId, toolRegistry, logger, 4);

    const keyboard = [];
    // keyboard.push([{ text: "Preferences", callback_data: "set_prefs" }]); // Temporarily hidden
    keyboard.push([{ text: "All Tools", callback_data: "set_all_tools_0" }]); // Page 0 for all tools

    const toolRows = [];
    for (let i = 0; i < frequentlyUsedTools.length; i += 2) {
        const row = [];
        // Use short displayName for callback_data, ensure it's URL-safe if necessary (assuming simple names for now)
        const toolCallbackKey1 = frequentlyUsedTools[i].displayName.replace(/\s+/g, '_'); // Basic safety
        row.push({ text: frequentlyUsedTools[i].displayName, callback_data: `set_viewtool_${toolCallbackKey1}` });
        if (i + 1 < frequentlyUsedTools.length) {
            const toolCallbackKey2 = frequentlyUsedTools[i + 1].displayName.replace(/\s+/g, '_'); // Basic safety
            row.push({ text: frequentlyUsedTools[i + 1].displayName, callback_data: `set_viewtool_${toolCallbackKey2}` });
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
async function buildToolParamsMenu(masterAccountId, toolKey, { logger, toolRegistry, userSettingsService }) {
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
    let effectiveSettings = {};

    if (userSettingsService && typeof userSettingsService.getEffectiveSettings === 'function') {
        try {
            effectiveSettings = await userSettingsService.getEffectiveSettings(masterAccountId, toolKey, TELEGRAM_API_KEY);
            logger.info(`[SettingsMenu] Fetched effective settings for MAID ${masterAccountId}, Tool ${toolKey}: ${JSON.stringify(effectiveSettings)}`);
        } catch (err) {
            logger.error(`[SettingsMenu] Error fetching effective settings for MAID ${masterAccountId}, Tool ${toolKey}:`, err);
            // Proceed with empty effectiveSettings or defaults from paramDef
        }
    } else {
        logger.warn(`[SettingsMenu] UserSettingsService not available or getEffectiveSettings is not a function. Using defaults for toolKey ${toolKey}.`);
        // Fallback to trying to use paramDef.default below
    }

    if (toolDef.inputSchema) {
        // Use toolDef.displayName (short) for callback data keys if available and simple, otherwise fallback or error.
        // For now, assuming toolDef.displayName is suitable as a short callback key.
        const callbackToolKey = toolDef.displayName.replace(/\s+/g, '_'); // Basic safety

        for (const paramName in toolDef.inputSchema) {
            const paramDef = toolDef.inputSchema[paramName];
            const currentValue = effectiveSettings[paramName] !== undefined ? effectiveSettings[paramName] : (paramDef.default !== undefined ? paramDef.default : 'Not set');
            
            const displayParamName = formatParamNameForDisplay(paramName);
            let buttonText = `${displayParamName}`;

            if (typeof currentValue === 'string' && currentValue.length > 15) {
                buttonText += `: ${currentValue.substring(0,12)}...`;
            } else {
                 buttonText += `: ${currentValue}`;
            }
            keyboard.push([{ text: buttonText, callback_data: `set_param_${callbackToolKey}_${paramName}` }]);
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
async function buildEditParamMenu(masterAccountId, canonicalToolId, paramName, { logger, toolRegistry, userSettingsService }) {
    const toolDef = toolRegistry.getToolById(canonicalToolId);

    if (!toolDef) {
        logger.error(`[SettingsMenu] buildEditParamMenu: ToolDef not found for canonical ID '${canonicalToolId}'.`);
        return { text: "Error: Tool not found.", reply_markup: { inline_keyboard: [[{ text: "⇱", callback_data: "set_main"}]]}};
    }

    const paramDef = toolDef.inputSchema ? toolDef.inputSchema[paramName] : null;
    if (!paramDef) {
        logger.error(`[SettingsMenu] buildEditParamMenu: ParamDef '${paramName}' not found for tool '${canonicalToolId}'.`);
        // Fallback gracefully to tool params menu
        const toolParamsMenu = await buildToolParamsMenu(masterAccountId, canonicalToolId, { logger, toolRegistry, userSettingsService });
        return { 
            text: `Error: Parameter '${paramName}' not found. ${toolParamsMenu.text}`,
            reply_markup: toolParamsMenu.reply_markup
        };
    }

    // Fetch current value
    let effectiveSettings = {};
    if (userSettingsService && typeof userSettingsService.getEffectiveSettings === 'function') {
        try {
            effectiveSettings = await userSettingsService.getEffectiveSettings(masterAccountId, canonicalToolId, TELEGRAM_API_KEY);
            logger.info(`[SettingsMenu] buildEditParamMenu: Fetched effective settings for MAID ${masterAccountId}, Tool ${canonicalToolId}: ${JSON.stringify(effectiveSettings)}`);
        } catch (err) {
            logger.error(`[SettingsMenu] buildEditParamMenu: Error fetching effective settings for MAID ${masterAccountId}, Tool ${canonicalToolId}:`, err);
            // Proceed with empty effectiveSettings or defaults from paramDef
        }
    } else {
        logger.warn(`[SettingsMenu] buildEditParamMenu: UserSettingsService not available or getEffectiveSettings is not a function. Using defaults for tool ${canonicalToolId}.`);
        // Fallback to trying to use paramDef.default below
    }
    const currentValue = effectiveSettings[paramName] !== undefined ? effectiveSettings[paramName] : (paramDef.default !== undefined ? paramDef.default : 'Not set');

    // Add a parseable marker and structure for reply handling
    // const promptMarker = 'SessionSettingsParamEditPrompt::';
    let promptText = ``; // `${promptMarker}Tool:${toolDef.displayName}::Param:${paramName}\n\n`; // Marker and parseable info

    const displayParamName = formatParamNameForDisplay(paramName);

    promptText += `Editing '${displayParamName}' for ${toolDef.displayName}:\n`;
    promptText += `Type: ${paramDef.type}\n`;
    if (paramDef.description) {
        promptText += `Description: ${paramDef.description}\n`;
    }
    promptText += `Current value: ${currentValue}\n\n`;
    promptText += `Please reply to this message with the new value.`;

    // Use short display name for back callback key
    const callbackToolKey = toolDef.displayName.replace(/\s+/g, '_');

    const keyboard = [
        [{ text: "⇱", callback_data: `set_back_toolparams_${callbackToolKey}` }],
        [{ text: "Ⓧ", callback_data: "set_nvm" }]
    ];

    return {
        text: promptText,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Handles a user's reply containing a new value for a parameter.
 * @param {string} masterAccountId
 * @param {string} toolDisplayName - Display name of the tool.
 * @param {string} paramName - Name of the parameter.
 * @param {string} newValue - The new value provided by the user.
 * @param {object} dependencies - { logger, toolRegistry, userSettingsService }
 * @returns {Promise<{success: boolean, message: string, canonicalToolId?: string}>}
 */
async function handleParameterValueReply(masterAccountId, toolDisplayName, paramName, newValue, { logger, toolRegistry, userSettingsService }) {
    const toolDef = toolRegistry.findByDisplayName(toolDisplayName);
    if (!toolDef) {
        logger.error(`[SettingsMenu] handleParameterValueReply: ToolDef not found for displayName '${toolDisplayName}'.`);
        return { success: false, message: `Error: Tool '${toolDisplayName}' not found.` };
    }

    const canonicalToolId = toolDef.toolId;
    const paramDef = toolDef.inputSchema ? toolDef.inputSchema[paramName] : null;
    if (!paramDef) {
        logger.error(`[SettingsMenu] handleParameterValueReply: ParamDef '${paramName}' not found for tool '${canonicalToolId}'.`);
        return { success: false, message: `Error: Parameter '${paramName}' not found for tool '${toolDisplayName}'.` };
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
        logger.warn(`[SettingsMenu] handleParameterValueReply: Validation failed for '${paramName}' (Tool: ${toolDisplayName}) with value '${newValue}'. Error: ${validationError}`);
        return { success: false, message: validationError };
    }

    const settingsToUpdate = { [paramName]: parsedValue };
    let saveResult;

    if (userSettingsService && typeof userSettingsService.savePreferences === 'function') {
        try {
            saveResult = await userSettingsService.savePreferences(masterAccountId, canonicalToolId, settingsToUpdate, TELEGRAM_API_KEY);
            logger.info(`[SettingsMenu] Called UserSettingsService.savePreferences for MAID ${masterAccountId}, Tool ${canonicalToolId}. Result: ${JSON.stringify(saveResult)}`);
            // Assuming savePreferences returns an object like { success: boolean, message?: string }
            // or throws on error.
            if (saveResult === undefined || typeof saveResult.success !== 'boolean') {
                 // If service method doesn't return a clear success structure, assume success if no error thrown
                logger.warn('[SettingsMenu] UserSettingsService.savePreferences did not return a standard success object. Assuming success as no error was thrown.');
                saveResult = { success: true, message: `Settings for '${paramName}' updated.` }; // Default success message
            }

        } catch (err) {
            logger.error(`[SettingsMenu] Error calling UserSettingsService.savePreferences for MAID ${masterAccountId}, Tool ${canonicalToolId}:`, err);
            saveResult = { success: false, message: err.message || "An error occurred while saving your settings." };
        }
    } else {
        logger.error(`[SettingsMenu] UserSettingsService not available or savePreferences is not a function. Cannot save settings for tool ${canonicalToolId}.`);
        saveResult = { success: false, message: "Error: Settings service is unavailable. Cannot save changes." };
    }

    if (saveResult.success) {
        logger.info(`[SettingsMenu] Parameter '${paramName}' for tool '${toolDisplayName}' (ID: ${canonicalToolId}) updated to '${parsedValue}' for MAID ${masterAccountId}.`);
        return { 
            success: true, 
            message: `Successfully updated '${paramName}' to '${parsedValue}'.`,
            canonicalToolId: canonicalToolId // Return canonicalId for navigation
        };
    } else {
        logger.error(`[SettingsMenu] Failed to save parameter '${paramName}' for tool '${toolDisplayName}'. Error: ${saveResult.message}`);
        return { success: false, message: saveResult.message || "Failed to update setting. Please try again." };
    }
}

// Placeholder for "All Tools" menu
async function buildAllToolsMenu(masterAccountId, username, page = 0, { logger, toolRegistry, userSettingsService }) {
    const text = "Select a tool to configure its settings (Page " + (page + 1) + "):";
    
    const allTools = toolRegistry.getAllTools()
        .sort((a, b) => (a.displayName || a.toolId).localeCompare(b.displayName || b.toolId));

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
    // In a real scenario, you'd fetch current preference values here using userSettingsService
    // For example: const prefs = await userSettingsService.getGlobalPreferences(masterAccountId);
    // const deliverAsFile = prefs.telegramDeliverAsFile || false; 
    const deliverAsFile = false; // Placeholder value

    const text = `${username}'s General Preferences`;
    const keyboard = [];

    keyboard.push([
        {
            text: `Always Deliver as File: ${deliverAsFile ? 'Yes' : 'No'}`,
            callback_data: 'set_pref_toggle_deliverasfile'
        }
    ]);
    // Add more preference toggles here in the future

    keyboard.push([{ text: "⇱", callback_data: "set_main" }]);
    keyboard.push([{ text: "Ⓧ", callback_data: "set_nvm" }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
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
async function buildTweakUIMenu(masterAccountId, canonicalToolId, currentTweakedParams, originalUserCommandMessageId, originalUserCommandChatId, generationId, { logger, toolRegistry, userSettingsService }) {
  logger.info(`[SettingsMenu][Tweak] buildTweakUIMenu called with canonicalToolId: \'${canonicalToolId}\' for GenID: ${generationId}`);
  const toolDef = toolRegistry.getToolById(canonicalToolId);
  logger.info(`[SettingsMenu][Tweak] toolDef after getToolById(\'${canonicalToolId}\'): ${JSON.stringify(toolDef)}`);

  if (!toolDef) {
    logger.error(`[SettingsMenu][Tweak] buildTweakUIMenu: Could not find toolDef for canonicalToolId \'${canonicalToolId}\'.`);
    return {
      text: "Error: Tool definition not found. Cannot tweak.",
      reply_markup: { inline_keyboard: [[{ text: "❌ Close", callback_data: `tweak_cancel:${generationId}` }]] }
    };
  }

  const shortGenId = generationId.substring(generationId.length - 6);
  const text = `✎ Tweaking *${escapeMarkdownV2(toolDef.displayName)}* \\(for Gen \`${shortGenId}\`\\)`;
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
async function buildTweakParamEditPrompt(masterAccountId, generationId, canonicalToolId, paramName, pendingTweaksStore, { logger, toolRegistry }) {
  const toolDef = toolRegistry.getToolById(canonicalToolId);
  if (!toolDef) {
    logger.error(`[SettingsMenu][TweakPrompt] ToolDef not found for ${canonicalToolId}`);
    return { text: "Error: Tool definition missing.", reply_markup: { inline_keyboard: [[{ text: "Back to Tweak Menu", callback_data: `tweak_gen_menu_render:${generationId}` }]] } };
  }

  const paramDef = toolDef.inputSchema ? toolDef.inputSchema[paramName] : null;
  if (!paramDef) {
    logger.error(`[SettingsMenu][TweakPrompt] ParamDef not found for ${paramName} in ${canonicalToolId}`);
    return { text: "Error: Parameter definition missing.", reply_markup: { inline_keyboard: [[{ text: "Back to Tweak Menu", callback_data: `tweak_gen_menu_render:${generationId}` }]] } };
  }

  const tweakSessionKey = `${generationId}_${masterAccountId}`;
  const currentToolTweaks = pendingTweaksStore[tweakSessionKey];

  if (!currentToolTweaks) {
    logger.error(`[SettingsMenu][TweakPrompt] No pending tweak session found for key: ${tweakSessionKey}`);
    return { text: "Error: Tweak session not found. Please try starting the tweak again.", reply_markup: { inline_keyboard: [[{ text: "Close", callback_data: "hide_menu"}]] } };
  }

  const currentValue = currentToolTweaks[paramName] !== undefined 
    ? currentToolTweaks[paramName] 
    : (paramDef.default !== undefined ? paramDef.default : 'Not set');

  const shortGenId = generationId.substring(generationId.length - 6);
  const displayParamName = formatParamNameForDisplay(paramName);

  const escapedGenId = escapeMarkdownV2(generationId);
  const escapedToolDisplayNameInMarker = escapeMarkdownV2(toolDef.displayName);
  const escapedCanonicalToolId = escapeMarkdownV2(canonicalToolId);
  const escapedParamNameInMarker = escapeMarkdownV2(paramName);

  // const promptMarker = `TweakParamEditPrompt::GenID:${escapedGenId}::ToolDisplay:${escapedToolDisplayNameInMarker}::ToolID:${escapedCanonicalToolId}::Param:${escapedParamNameInMarker}`;
  
  let promptText = ""; // promptMarker + "\n\n"; 

  const displayableParamName = escapeMarkdownV2(displayParamName);
  const displayableToolName = escapeMarkdownV2(toolDef.displayName);
  const displayableShortGenId = escapeMarkdownV2(shortGenId);

  promptText += `✎ Editing *${displayableParamName}* for *${displayableToolName}* \\(for Gen \`${displayableShortGenId}\`\\)\n`;
  promptText += `Current value: \`${escapeMarkdownV2(String(currentValue))}\`\n\n`;
  promptText += `Please reply to this message with the new value for *${displayableParamName}*\\.`;
  
  if (paramDef.description) {
    promptText += `\n\n_${escapeMarkdownV2(paramDef.description)}_`;
  }
  if (paramDef.type === 'boolean') {
    promptText += `\n\\(Send \`true\` or \`false\`\\)`;
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
 * Registers all handlers for the settings menu feature.
 * @param {object} dispatchers - The dispatchers object.
 * @param {CommandDispatcher} dispatchers.commandDispatcher - The command dispatcher.
 * @param {CallbackQueryDispatcher} dispatchers.callbackQueryDispatcher - The callback query dispatcher.
 * @param {MessageReplyDispatcher} dispatchers.messageReplyDispatcher - The message reply dispatcher.
 * @param {object} dependencies - The dependencies needed by the handlers.
 */
function registerHandlers(dispatchers, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;
    const { logger, toolRegistry, userSettingsService, replyContextManager, internalApiClient } = dependencies;

    commandDispatcher.register(/^\/settings(?:@\w+)?$/i, async (message) => {
        const telegramUserId = message.from.id.toString();
        const platform = 'telegram';
        logger.info(`[Bot] /settings command received from Telegram User ID: ${telegramUserId}`);
        try {
            const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
                platform: platform,
                platformId: telegramUserId,
                platformContext: { firstName: message.from.first_name, username: message.from.username }
            });
            const masterAccountId = findOrCreateResponse.data.masterAccountId;
            logger.info(`[Bot] MasterAccountId ${masterAccountId} found/created for Telegram User ID: ${telegramUserId}`);
            
            await handleSettingsCommand(dependencies.bot, message, masterAccountId, { logger, toolRegistry, userSettingsService });
        } catch (error) {
            logger.error(`[Bot] Error processing /settings command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
            dependencies.bot.sendMessage(message.chat.id, "Sorry, there was an error trying to open settings. Please try again.", { reply_to_message_id: message.message_id });
        }
    });

    callbackQueryDispatcher.register('set_', async (bot, callbackQuery, masterAccountId, deps) => {
        await handleSettingsCallback(bot, callbackQuery, masterAccountId, { ...deps, replyContextManager });
    });

    messageReplyDispatcher.register('settings_param_edit', async (bot, message, context, deps) => {
        const { masterAccountId, toolDisplayName, paramName } = context;
        const value = message.text;
        logger.info(`[Bot] Reply received for settings param edit via Context. User: ${message.from.id}, MAID: ${masterAccountId}, Tool: ${toolDisplayName}, Param: ${paramName}, Value: '${value}'`);

        const result = await handleParameterValueReply(masterAccountId, toolDisplayName, paramName, value, { logger, toolRegistry, userSettingsService });

        if (result.success) {
            await bot.sendMessage(message.chat.id, result.message, { reply_to_message_id: message.message_id });
            if (result.canonicalToolId) {
                const updatedToolParamsMenu = await buildToolParamsMenu(masterAccountId, result.canonicalToolId, { logger, toolRegistry, userSettingsService });
                await bot.editMessageText(updatedToolParamsMenu.text, {
                    chat_id: message.reply_to_message.chat.id,
                    message_id: message.reply_to_message.message_id,
                    reply_markup: updatedToolParamsMenu.reply_markup
                });
            }
        } else {
            await bot.sendMessage(message.chat.id, result.message || "Failed to update setting.", { reply_to_message_id: message.message_id });
        }
    });
}

// TODO: Implement other menu building functions as per ADR-007
// async function buildAllToolsMenu(masterAccountId, page = 0, { logger, toolRegistry, userSettingsService }) { ... }
// async function buildEditParamMenu(masterAccountId, toolKey, paramName, { logger, toolRegistry, userSettingsService }) { ... }
// async function buildPreferencesMenu(masterAccountId, { logger, userSettingsService }) { ... }

module.exports = {
    handleSettingsCommand,
    handleSettingsCallback,
    handleParameterValueReply,
    buildToolParamsMenu,
    buildAllToolsMenu,
    buildTweakUIMenu,
    buildTweakParamEditPrompt,
    registerHandlers,
    // buildUserPreferencesMenu // Temporarily hidden
}; 