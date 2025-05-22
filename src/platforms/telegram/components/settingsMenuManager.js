// src/platforms/telegram/components/settingsMenuManager.js
const internalApiClient = require('../utils/internalApiClient'); // For fetching user-specific data

// Dependencies like logger and toolRegistry will be passed into functions.
// UserSettingsService will also be passed in when available.

const TELEGRAM_API_KEY = process.env.INTERNAL_API_KEY_TELEGRAM;

// Placeholder for UserSettingsService.getEffectiveSettings - replace with actual service call
async function getEffectiveSettingsPlaceholder(masterAccountId, toolId, logger) {
    logger.warn(`[SettingsMenu] Using PLACEHOLDER getEffectiveSettings for MAID ${masterAccountId}, Tool ${toolId}!`);
    // Simulate fetching settings. Actual implementation would call UserSettingsService.
    if (toolId === 'comfy-0a863d4e-1f43-4f56-924f-12a9f8ac1ac8') { // Example: quickmake
        return { input_prompt: 'a placeholder prompt', seed: 12345, steps: 25 };
    }
    if (toolId === 'comfy-386015cd-7f1f-48e3-9b4f-17ee6cc983a1') { // Example: effect
        return { input_prompt: 'effect prompt', strength: 0.75 };
    }
    return { generic_param: 'default_value' }; // Default for other tools
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
 * @param {object} dependencies - Object containing { logger, toolRegistry, userSettingsService (optional) }.
 */
async function handleSettingsCallback(bot, callbackQuery, masterAccountId, { logger, toolRegistry, userSettingsService }) {
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
                newKeyboard = { inline_keyboard: [[{ text: "Back to Main", callback_data: "set_main" }], [{ text: "NVM", callback_data: "set_nvm" }]] };
            }
        } else if (data.startsWith('set_back_main_from_tool_')) { // Example for back from tool params
            menu = await buildMainMenu(masterAccountId, username, { logger, toolRegistry, userSettingsService });
            newText = menu.text;
            newKeyboard = menu.reply_markup;
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
    keyboard.push([{ text: "Preferences", callback_data: "set_prefs" }]); // Placeholder
    keyboard.push([{ text: "All Tools", callback_data: "set_all_tools_0" }]); // Placeholder

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
    keyboard.push([{ text: "NVM", callback_data: "set_nvm" }]);

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
    const toolDef = toolRegistry.getToolById(toolKey);

    if (!toolDef) {
        logger.error(`[SettingsMenu] buildToolParamsMenu: Could not find toolDef for toolKey '${toolKey}'.`);
        return {
            text: "Error: Tool not found. Please go back.",
            reply_markup: { inline_keyboard: [
                [{ text: "Back to Main Menu", callback_data: "set_main" }],
                [{ text: "NVM", callback_data: "set_nvm" }]
            ]}
        };
    }

    const text = toolDef.description || `Settings for ${toolDef.displayName}`;
    const keyboard = [];

    // Fetch effective settings (using placeholder for now)
    // const effectiveSettings = userSettingsService ? await userSettingsService.getEffectiveSettings(masterAccountId, toolKey) : {};
    const effectiveSettings = await getEffectiveSettingsPlaceholder(masterAccountId, toolKey, logger);


    if (toolDef.inputSchema) {
        // Use toolDef.displayName (short) for callback data keys if available and simple, otherwise fallback or error.
        // For now, assuming toolDef.displayName is suitable as a short callback key.
        const callbackToolKey = toolDef.displayName.replace(/\s+/g, '_'); // Basic safety

        for (const paramName in toolDef.inputSchema) {
            const paramDef = toolDef.inputSchema[paramName];
            const currentValue = effectiveSettings[paramName] !== undefined ? effectiveSettings[paramName] : (paramDef.default !== undefined ? paramDef.default : 'Not set');
            // Use paramName (the key from inputSchema) as it's guaranteed to exist here.
            // paramDef.name should ideally be the same, but paramName is safer in this loop context.
            let buttonText = `${paramName}`;
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
    keyboard.push([{ text: "Back", callback_data: `set_back_main_from_tool_${callbackToolKeyForBack}` }, { text: "NVM", callback_data: "set_nvm" }]);
    
    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}


// TODO: Implement other menu building functions as per ADR-007
// async function buildAllToolsMenu(masterAccountId, page = 0, { logger, toolRegistry, userSettingsService }) { ... }
// async function buildEditParamMenu(masterAccountId, toolKey, paramName, { logger, toolRegistry, userSettingsService }) { ... }
// async function buildPreferencesMenu(masterAccountId, { logger, userSettingsService }) { ... }


module.exports = {
    handleSettingsCommand,
    handleSettingsCallback,
}; 