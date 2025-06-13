const internalApiClient = require('../../../utils/internalApiClient');
const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

/**
 * Handles the initial /spell command.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The Telegram message object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - { logger, toolRegistry, replyContextManager }.
 */
async function handleSpellCommand(bot, msg, masterAccountId, { logger, toolRegistry, replyContextManager }) {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    logger.info(`[SpellMenu] /spell command received from ${username} (MAID: ${masterAccountId}, ChatID: ${chatId})`);

    try {
        const menu = await buildMainMenu(masterAccountId, username, { logger });
        await bot.sendMessage(chatId, menu.text, {
            parse_mode: 'MarkdownV2',
            reply_markup: menu.reply_markup,
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        logger.error('[SpellMenu] Error in handleSpellCommand:', error);
        await bot.sendMessage(chatId, "Sorry, I couldn't open the spellbook right now. Please try again later.", { reply_to_message_id: msg.message_id });
    }
}


/**
 * Builds the main spellbook menu.
 * @param {string} masterAccountId
 * @param {string} username
 * @param {object} dependencies - { logger }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildMainMenu(masterAccountId, username, { logger }) {
    const text = `*${escapeMarkdownV2(username)}'s Spellbook*\n\nCreate a new spell or manage your existing ones`;
    const keyboard = [];

    keyboard.push([{ text: "🪄 Create New Spell", callback_data: "spell_create" }]);

    try {
        // Fetch spells owned by the user using the new API
        const response = await internalApiClient.get(`/spells`, { params: { ownedBy: masterAccountId } });
        const spells = response.data.spells || [];

        if (spells.length > 0) {
            spells.forEach(spell => {
                // Use the spell's slug for management to keep callback_data small
                const callbackData = `spell_manage_${spell.slug}`;
                logger.info(`[SpellMenu] BuildMainMenu: Generating button with data: "${callbackData}" (Length: ${Buffer.from(callbackData).length} bytes)`);
                keyboard.push([{ text: `📖 ${spell.name}`, callback_data: callbackData }]);
            });
        }
    } catch (error) {
        logger.error(`[SpellMenu] Failed to fetch spells for MAID ${masterAccountId}:`, error);
        // Do not add any spell buttons, the "Create" button will still be there.
    }

    keyboard.push([{ text: "Ⓧ Close", callback_data: "spell_nvm" }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}


/**
 * Handles callback queries for the spell menu.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The Telegram callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - { logger, toolRegistry, replyContextManager }.
 */
async function handleSpellCallback(bot, callbackQuery, masterAccountId, { logger, toolRegistry, replyContextManager }) {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const data = callbackQuery.data;
    const username = callbackQuery.from.username || callbackQuery.from.first_name;

    logger.info(`[SpellMenu] Callback received: '${data}' from ${username} (MAID: ${masterAccountId}, ChatID: ${chatId})`);

    try {
        if (data === 'spell_nvm') {
            await bot.deleteMessage(chatId, messageId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Spellbook closed." });
            return;
        }

        if (data === 'spell_create') {
            const text = "What would you like to name your new spell? Please reply to this message with the name.";
            const sentMessage = await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: "⬅️ Cancel", callback_data: "spell_main" }]]
                }
            });

            replyContextManager.addContext(sentMessage, {
                type: 'spell_create_name',
                masterAccountId: masterAccountId,
            });
            logger.info(`[SpellMenu] Stored reply context for 'spell_create_name' for MAID ${masterAccountId}.`);
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data === 'spell_main') {
            const menu = await buildMainMenu(masterAccountId, username, { logger });
            await bot.editMessageText(menu.text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'MarkdownV2',
                reply_markup: menu.reply_markup
            });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_manage_')) {
            const spellSlug = data.substring('spell_manage_'.length);
            
            try {
                const response = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = response.data;

                if (!spell) {
                    logger.error(`[SpellMenu] Callback 'spell_manage_': Could not find spell with slug: ${spellSlug}`);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Spell not found.', show_alert: true });
                    return;
                }

                const menu = await buildSpellEditorMenu(masterAccountId, spell, { logger, toolRegistry });
                await bot.editMessageText(menu.text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: menu.reply_markup
                });

            } catch (error) {
                logger.error(`[SpellMenu] Error fetching spell by slug '${spellSlug}':`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Sorry, couldn't load that spell.", show_alert: true });
            }
            
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_add_tool_category_')) {
            const dataString = data.substring('spell_add_tool_category_'.length);
            const [spellSlug, category, pageStr] = dataString.split(':');
            const page = pageStr ? parseInt(pageStr, 10) : 0;

            const menu = await buildToolSelectionMenu(spellSlug, category, page, { logger, toolRegistry });
             await bot.editMessageText(menu.text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'MarkdownV2',
                reply_markup: menu.reply_markup
            });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_add_tool_')) {
            const spellSlug = data.substring('spell_add_tool_'.length);
            const menu = await buildAddToolCategoryMenu(spellSlug, { logger, toolRegistry });
            await bot.editMessageText(menu.text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'MarkdownV2',
                reply_markup: menu.reply_markup
            });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_select_tool_')) {
             const dataString = data.substring('spell_select_tool_'.length);
             const [spellSlug, ...displayNameParts] = dataString.split(':');
             const displayName = displayNameParts.join(':');
             
             const tool = toolRegistry.findByDisplayName(displayName);
             if (!tool) {
                 logger.error(`[SpellMenu] Could not find tool by display name: '${displayName}'`);
                 await bot.answerCallbackQuery(callbackQuery.id, {text: `Error: Tool not found.`, show_alert: true});
                 return;
             }
             const toolId = tool.toolId;

            try {
                // Fetch spell by slug to get its ID for the API call
                const spellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = spellResponse.data;
                if (!spell) {
                    logger.error(`[SpellMenu] 'spell_select_tool_': Could not find spell with slug: ${spellSlug}`);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Spell not found.', show_alert: true });
                    return;
                }
                const spellId = spell._id;

                await internalApiClient.post(`/spells/${spellId}/steps`, { toolId, masterAccountId });
                logger.info(`[SpellMenu] Successfully added tool '${toolId}' to spell '${spellId}'.`);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Added tool!`});

                // Re-fetch the spell to get updated steps for the menu
                const updatedSpellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const updatedSpell = updatedSpellResponse.data;
                const menu = await buildSpellEditorMenu(masterAccountId, updatedSpell, { logger, toolRegistry });
                await bot.editMessageText(menu.text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: menu.reply_markup
                });

            } catch (error) {
                logger.error(`[SpellMenu] Failed to add tool '${toolId}' to spell with slug '${spellSlug}':`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Error adding tool. Please try again.`, show_alert: true});
                // On error, just go back to the spell editor without changes
                const spellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const menu = await buildSpellEditorMenu(masterAccountId, spellResponse.data, { logger, toolRegistry });
                await bot.editMessageText(menu.text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: menu.reply_markup
                });
                return;
            }

            return;
        }
        
        if (data.startsWith('spell_delete_')) {
            const spellSlug = data.substring('spell_delete_'.length);
            try {
                // API requires ID, so fetch spell by slug first
                const spellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = spellResponse.data;
                if (!spell) {
                    logger.error(`[SpellMenu] 'spell_delete_': Could not find spell with slug: ${spellSlug}`);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Spell to delete not found.', show_alert: true });
                    return;
                }
                const spellId = spell._id;
                
                // The API's delete method checks for ownership via masterAccountId in the body
                await internalApiClient.delete(`/spells/${spellId}`, { data: { masterAccountId } });
                logger.info(`[SpellMenu] Successfully deleted spell '${spellId}'.`);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Spell deleted.`});

                const menu = await buildMainMenu(masterAccountId, username, { logger });
                await bot.editMessageText(menu.text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: menu.reply_markup
                });

            } catch (error) {
                logger.error(`[SpellMenu] Failed to delete spell '${spellId}':`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Error deleting spell.`, show_alert: true});
            }
            return;
        }

        if (data.startsWith('spell_edit_step_')) {
            const dataString = data.substring('spell_edit_step_'.length);
            const [spellSlug, stepIdStr] = dataString.split('_');
            const stepId = parseInt(stepIdStr, 10);

            logger.info(`[SpellMenu] User wants to edit step ${stepId} of spell ${spellSlug}.`);

            try {
                const response = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = response.data;
                const step = spell.steps.find(s => s.stepId === stepId);

                if (!spell || !step) {
                    logger.error(`[SpellMenu] Could not find spell or step for slug:${spellSlug}, step:${stepId}`);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not find the step to edit.", show_alert: true });
                    return;
                }
                
                const menu = await buildStepEditorMenu(spell, step, { logger, toolRegistry });
                await bot.editMessageText(menu.text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: menu.reply_markup
                });
                await bot.answerCallbackQuery(callbackQuery.id);

            } catch (error) {
                logger.error(`[SpellMenu] Error building step editor for ${spellSlug}, step ${stepId}:`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Sorry, couldn't open the step editor.", show_alert: true });
            }
            return;
        }

        if (data.startsWith('spell_param_edit_')) {
            const dataString = data.substring('spell_param_edit_'.length);
            const parts = dataString.split('_');
            const spellSlug = parts[0];
            const stepIdStr = parts[1];
            const paramName = parts.slice(2).join('_');
            const stepId = parseInt(stepIdStr, 10);

            try {
                const spellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = spellResponse.data;
                const step = spell.steps.find(s => s.stepId === stepId);
                const tool = toolRegistry.getToolById(step.toolId);
                const paramDef = tool.inputSchema[paramName];

                let promptText = `Please reply to this message with the new value for *${escapeMarkdownV2(paramName.replace('input_', ''))}*\\.`;
                if (paramDef.description) {
                    promptText += `\n\n_${escapeMarkdownV2(paramDef.description)}_`;
                }
                if (paramDef.type === 'boolean') {
                    promptText += `\n\n(Try 'true' or 'false')`;
                }

                const sentMessage = await bot.editMessageText(promptText, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [[{ text: "⬅️ Cancel", callback_data: `spell_edit_step_${spell.slug}_${step.stepId}` }]]
                    }
                });
                
                replyContextManager.addContext(sentMessage, {
                    type: 'spell_param_value',
                    masterAccountId,
                    spellSlug,
                    stepId,
                    paramName,
                });
                logger.info(`[SpellMenu] Stored reply context for 'spell_param_value' for param '${paramName}'.`);

            } catch (error) {
                 logger.error(`[SpellMenu] Error processing spell_param_edit for ${spellSlug}, step ${stepId}, param ${paramName}:`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Sorry, couldn't open the parameter editor.", show_alert: true });
            }
            
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        await bot.answerCallbackQuery(callbackQuery.id, { text: "This feature is not yet complete." });

    } catch (error) {
        logger.error('[SpellMenu] Error in handleSpellCallback:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred." });
    }
}

/**
 * Handles a user's reply containing the new spell name.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The user's reply message.
 * @param {object} context - The context object from ReplyContextManager.
 * @param {object} dependencies - { logger, toolRegistry }.
 * @returns {Promise<void>}
 */
async function handleNewSpellNameReply(bot, msg, context, { logger, toolRegistry }) {
    const { masterAccountId } = context;
    const spellName = msg.text.trim();
    const chatId = msg.chat.id;
    const messageToEditId = msg.reply_to_message.message_id;

    logger.info(`[SpellMenu] Handling reply for new spell name '${spellName}' from MAID ${masterAccountId}`);

    if (!spellName || spellName.length > 50) {
        await bot.sendMessage(chatId, "Invalid name. Please use a name between 1 and 50 characters.", { reply_to_message_id: msg.message_id });
        return;
    }

    try {
        const response = await internalApiClient.post(`/spells`, { name: spellName, creatorId: masterAccountId });
        const newSpell = response.data;

        const menu = await buildSpellEditorMenu(masterAccountId, newSpell, { logger, toolRegistry });

        await bot.editMessageText(menu.text, {
            chat_id: chatId,
            message_id: messageToEditId,
            parse_mode: 'MarkdownV2',
            reply_markup: menu.reply_markup
        });

    } catch (error) {
        let errorDetails = 'No details available';
        try {
            let loggableError = { message: error.message, stack: error.stack, name: error.name };
            if (error.response && error.response.data) {
                loggableError.responseData = error.response.data;
            }
            if (error.config) {
                loggableError.config = {
                    url: error.config.url,
                    method: error.config.method,
                    headers: error.config.headers,
                }
            }
            errorDetails = JSON.stringify(loggableError, null, 2);
        } catch (stringifyError) {
            errorDetails = `Could not stringify error. Message: ${error.message}`;
        }
        logger.error(`[SpellMenu] Error creating spell for MAID ${masterAccountId}: ${errorDetails}`);

        let errorMessage = "Could not create your spell. Please try again.";
        if (error.response?.data?.error?.code === 'CONFLICT' || error.response?.data?.error?.includes('duplicate key')) {
            errorMessage = `A spell with that name already exists. Please choose a different name.`;
        }
        await bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageToEditId,
            reply_markup: {
                inline_keyboard: [[{ text: "⬅️ Back to Spellbook", callback_data: "spell_main" }]]
            }
        });
    }
}

/**
 * Builds the menu for editing a specific spell.
 * @param {string} masterAccountId
 * @param {string} spellSlug
 * @param {object} dependencies - { logger, toolRegistry }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildSpellEditorMenu(masterAccountId, spell, { logger, toolRegistry }) {
    let text = `*Editing Spell: ${escapeMarkdownV2(spell.name)}*\n\n`;
    const keyboard = [];

    if (spell.steps && spell.steps.length > 0) {
        text += 'Current steps:';
        spell.steps.forEach(step => {
            const tool = toolRegistry.getToolById(step.toolId);
            const displayName = tool ? tool.displayName : step.toolId;
            const callbackData = `spell_edit_step_${spell.slug}_${step.stepId}`;
            logger.info(`[SpellMenu] BuildSpellEditorMenu: Generating button with data: "${callbackData}" (Length: ${Buffer.from(callbackData).length} bytes)`);
            keyboard.push([{ text: `Step ${step.stepId}: ${displayName}`, callback_data: callbackData }]);
        });
    } else {
        text += 'This spell has no steps\\. Add your first tool to begin';
    }

    const addToolCb = `spell_add_tool_${spell.slug}`;
    const deleteCb = `spell_delete_${spell.slug}`;
    logger.info(`[SpellMenu] BuildSpellEditorMenu: Generating 'Add' button with data: "${addToolCb}" (Length: ${Buffer.from(addToolCb).length} bytes)`);
    logger.info(`[SpellMenu] BuildSpellEditorMenu: Generating 'Delete' button with data: "${deleteCb}" (Length: ${Buffer.from(deleteCb).length} bytes)`);

    keyboard.push([{ text: "➕ Add Tool", callback_data: addToolCb }]);
    keyboard.push([{ text: "⬅️ Back to Spellbook", callback_data: `spell_main` }]);
    keyboard.push([{ text: "❌ Discard & Delete", callback_data: deleteCb }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Builds the menu for editing a specific step's parameters.
 * @param {object} spell - The full spell object.
 * @param {object} step - The specific step object to edit.
 * @param {object} dependencies - { logger, toolRegistry }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildStepEditorMenu(spell, step, { logger, toolRegistry }) {
    const tool = toolRegistry.getToolById(step.toolId);
    if (!tool) {
        logger.error(`[SpellMenu] buildStepEditorMenu: Could not find tool with ID '${step.toolId}' in registry.`);
        return { text: "Error: Tool definition not found.", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: `spell_manage_${spell.slug}` }]] } };
    }

    let text = `*Editing Step ${step.stepId}: ${escapeMarkdownV2(tool.displayName)}*\n\n`;
    text += `Configure the parameters for this tool\\.`;

    const keyboard = [];
    const currentOverrides = step.parameterOverrides || {};

    if (tool.inputSchema) {
        for (const paramName in tool.inputSchema) {
            // A parameter is configurable unless explicitly set to false.
            if (paramName.startsWith('input_') && tool.inputSchema[paramName].configurable !== false) {
                 const paramDef = tool.inputSchema[paramName];
                 const displayParamName = paramName.replace('input_', '');
                 const currentValue = currentOverrides[paramName] ?? paramDef.default;
                 
                 const buttonText = `⚙️ ${displayParamName}: ${currentValue}`;
                 const callbackData = `spell_param_edit_${spell.slug}_${step.stepId}_${paramName}`;
                 logger.info(`[SpellMenu] buildStepEditorMenu: Generating button with data: "${callbackData}" (Length: ${Buffer.from(callbackData).length} bytes)`);
                 keyboard.push([{ text: buttonText, callback_data: callbackData }]);
            }
        }
    }

    if (keyboard.length === 0) {
        text += '\n\nThis tool has no configurable parameters\\. You can still change its position in the spell\\.';
    }
    
    keyboard.push([{ text: "⬅️ Back to Spell", callback_data: `spell_manage_${spell.slug}` }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Builds the menu for choosing a tool category.
 * @param {string} spellSlug
 * @param {object} dependencies - { logger, toolRegistry }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildAddToolCategoryMenu(spellSlug, { logger, toolRegistry }) {
    const text = "What type of tool do you want to start with?";
    
    const allTools = toolRegistry.getAllTools();
    const primaryInputTypes = [...new Set(allTools.map(tool => tool.platformHints?.primaryInput).filter(Boolean))];

    const keyboard = [];
    const row = [];
    primaryInputTypes.forEach(type => {
        const buttonText = type.charAt(0).toUpperCase() + type.slice(1);
        const callbackData = `spell_add_tool_category_${spellSlug}:${type}`;
        logger.info(`[SpellMenu] BuildAddToolCategoryMenu: Generating button with data: "${callbackData}" (Length: ${Buffer.from(callbackData).length} bytes)`);
        row.push({ text: buttonText, callback_data: callbackData});
    });

    if (row.length > 0) {
        keyboard.push(row);
    }
    
    const backCallbackData = `spell_manage_${spellSlug}`;
    logger.info(`[SpellMenu] BuildAddToolCategoryMenu: Generating back button with data: "${backCallbackData}" (Length: ${Buffer.from(backCallbackData).length} bytes)`);
    keyboard.push([{ text: "⬅️ Back", callback_data: backCallbackData }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Builds the menu for selecting a specific tool from a category.
 * @param {string} spellSlug
 * @param {string} category - The primary input type (e.g., 'text', 'image').
 * @param {number} page - The current page number for pagination.
 * @param {object} dependencies - { logger, toolRegistry }
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildToolSelectionMenu(spellSlug, category, page, { logger, toolRegistry }) {
    const ITEMS_PER_PAGE = 6;
    const text = `*Select a Tool* \\(Category: ${escapeMarkdownV2(category)}\\)`;

    const filteredTools = toolRegistry.getAllTools()
        .filter(tool => tool.platformHints?.primaryInput === category)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const totalPages = Math.ceil(filteredTools.length / ITEMS_PER_PAGE);
    const startIndex = page * ITEMS_PER_PAGE;
    const toolsForPage = filteredTools.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const keyboard = [];
    for (let i = 0; i < toolsForPage.length; i += 2) {
        const row = [];
        const tool1 = toolsForPage[i];
        const cb1 = `spell_select_tool_${spellSlug}:${tool1.displayName}`;
        logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating button with data: "${cb1}" (Length: ${Buffer.from(cb1).length} bytes)`);
        row.push({ text: tool1.displayName, callback_data: cb1 });
        
        if (i + 1 < toolsForPage.length) {
            const tool2 = toolsForPage[i + 1];
            const cb2 = `spell_select_tool_${spellSlug}:${tool2.displayName}`;
            logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating button with data: "${cb2}" (Length: ${Buffer.from(cb2).length} bytes)`);
            row.push({ text: tool2.displayName, callback_data: cb2 });
        }
        keyboard.push(row);
    }

    const navRow = [];
    if (page > 0) {
        const cb = `spell_add_tool_category_${spellSlug}:${category}:${page - 1}`;
        logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating nav button with data: "${cb}" (Length: ${Buffer.from(cb).length} bytes)`);
        navRow.push({ text: "⬅️ Prev", callback_data: cb });
    }
    if (page < totalPages - 1) {
        const cb = `spell_add_tool_category_${spellSlug}:${category}:${page + 1}`;
        logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating nav button with data: "${cb}" (Length: ${Buffer.from(cb).length} bytes)`);
        navRow.push({ text: "Next ➡️", callback_data: cb });
    }

    if (navRow.length > 0) {
        keyboard.push(navRow);
    }

    const backCb = `spell_add_tool_${spellSlug}`;
    logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating back button with data: "${backCb}" (Length: ${Buffer.from(backCb).length} bytes)`);
    keyboard.push([{ text: "⬅️ Back to Categories", callback_data: backCb }]);

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * Handles a user's reply with a new parameter value for a spell step.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The user's reply message.
 * @param {object} context - The context object from ReplyContextManager.
 * @param {object} dependencies - { logger, toolRegistry }.
 * @returns {Promise<void>}
 */
async function handleStepParameterValueReply(bot, msg, context, { logger, toolRegistry }) {
    const { masterAccountId, spellSlug, stepId, paramName } = context;
    const newValue = msg.text.trim();
    const chatId = msg.chat.id;
    const messageToEditId = msg.reply_to_message.message_id;
    
    logger.info(`[SpellMenu] Handling reply for spell param update. Spell: ${spellSlug}, Step: ${stepId}, Param: ${paramName}, NewValue: '${newValue}'`);

    try {
        // Fetch the spell to get the current state and spell ID
        const spellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
        const spell = spellResponse.data;
        const step = spell.steps.find(s => s.stepId === stepId);
        
        if (!spell || !step) {
            throw new Error(`Spell or step not found during parameter update.`);
        }

        // TODO: Add validation for the new value against the tool's inputSchema
        const newOverrides = { ...step.parameterOverrides, [paramName]: newValue };

        // API call to update the step
        await internalApiClient.put(`/spells/${spell._id}/steps/${step.stepId}`, {
            masterAccountId,
            parameterOverrides: newOverrides
        });

        // Success, now rebuild the step editor menu with the fresh data
        const updatedSpellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
        const updatedSpell = updatedSpellResponse.data;
        const updatedStep = updatedSpell.steps.find(s => s.stepId === stepId);

        const menu = await buildStepEditorMenu(updatedSpell, updatedStep, { logger, toolRegistry });
        
        await bot.editMessageText(menu.text, {
            chat_id: chatId,
            message_id: messageToEditId,
            parse_mode: 'MarkdownV2',
            reply_markup: menu.reply_markup
        });

        // Clean up the user's reply message
        await bot.deleteMessage(chatId, msg.message_id);

    } catch (error) {
        logger.error(`[SpellMenu] Error updating spell step parameter:`, error.response?.data || error.message);
        await bot.sendMessage(chatId, "❌ Error saving parameter. Please try again.", { reply_to_message_id: msg.message_id });
        
        // Restore the previous menu on failure
        const originalSpellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
        const originalSpell = originalSpellResponse.data;
        const originalStep = originalSpell.steps.find(s => s.stepId === stepId);
        const menu = await buildStepEditorMenu(originalSpell, originalStep, { logger, toolRegistry });
         await bot.editMessageText(menu.text, {
            chat_id: chatId,
            message_id: messageToEditId,
            parse_mode: 'MarkdownV2',
            reply_markup: menu.reply_markup
        });
    }
}

/**
 * Registers all handlers for the spell menu feature.
 * @param {object} dispatchers - The dispatchers object.
 * @param {CommandDispatcher} dispatchers.commandDispatcher - The command dispatcher.
 * @param {CallbackQueryDispatcher} dispatchers.callbackQueryDispatcher - The callback query dispatcher.
 * @param {MessageReplyDispatcher} dispatchers.messageReplyDispatcher - The message reply dispatcher.
 * @param {object} dependencies - The dependencies needed by the handlers.
 */
function registerHandlers(dispatchers, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;
    const { logger, toolRegistry, replyContextManager, internalApiClient, spellsService } = dependencies;

    // /spells command
    commandDispatcher.register(/^\/spells(?:@\w+)?$/i, async (message) => {
        const telegramUserId = message.from.id.toString();
        logger.info(`[Bot] /spells command received from Telegram User ID: ${telegramUserId}`);
        try {
            const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
                platform: 'telegram',
                platformId: telegramUserId,
                platformContext: { firstName: message.from.first_name, username: message.from.username }
            });
            const masterAccountId = findOrCreateResponse.data.masterAccountId;
            await handleSpellCommand(dependencies.bot, message, masterAccountId, { logger, toolRegistry, replyContextManager });
        } catch (error) {
            logger.error(`[Bot] Error processing /spells command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
            dependencies.bot.sendMessage(message.chat.id, "Sorry, there was an error opening your spellbook. Please try again.", { reply_to_message_id: message.message_id });
        }
    });

    // /cast command
    commandDispatcher.register(/^\/cast(?:@\w+)?\s+(\w[-\w]*)(?:\s+(.*))?$/i, async (message, match) => {
        const telegramUserId = message.from.id.toString();
        const slug = match[1];
        const overridesString = match[2];
        
        logger.info(`[Bot] /cast command received from UserID: ${telegramUserId} for slug: "${slug}"`);

        try {
            const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
                platform: 'telegram',
                platformId: telegramUserId,
                platformContext: { firstName: message.from.first_name, username: message.from.username }
            });
            const masterAccountId = findOrCreateResponse.data.masterAccountId;

            const parameterOverrides = {};
            if (overridesString) {
                parameterOverrides.input_prompt = overridesString.trim();
            }

            const context = {
                masterAccountId,
                platform: 'telegram',
                telegramUserId,
                chatId: message.chat.id,
                messageId: message.message_id,
                parameterOverrides,
            };

            dependencies.bot.sendMessage(message.chat.id, `Casting spell "${slug}"...`, { reply_to_message_id: message.message_id });

            spellsService.castSpell(slug, context)
              .catch(error => {
                logger.error(`[Bot] Asynchronous error during /cast for slug "${slug}":`, error.message, error.stack);
                const friendlyErrors = ['not found', 'permission', 'Multiple spells'];
                const isFriendly = friendlyErrors.some(term => error.message.includes(term));
                
                const errorMessage = isFriendly
                    ? error.message
                    : "Sorry, an unexpected error occurred while casting that spell.";
                
                dependencies.bot.sendMessage(context.chatId, escapeMarkdownV2(errorMessage), { 
                    reply_to_message_id: context.messageId,
                    parse_mode: 'MarkdownV2'
                });
            });

        } catch (error) {
            logger.error(`[Bot] Synchronous error processing /cast command for slug "${slug}":`, error.message);
            dependencies.bot.sendMessage(message.chat.id, "Sorry, there was an error preparing to cast the spell.", { reply_to_message_id: message.message_id });
        }
    });

    // Callback query handler
    callbackQueryDispatcher.register('spell_', async (bot, callbackQuery, masterAccountId, deps) => {
        await handleSpellCallback(bot, callbackQuery, masterAccountId, { ...deps, replyContextManager });
    });

    // Message reply handlers
    messageReplyDispatcher.register('spell_create_name', async (bot, message, context, deps) => {
        await handleNewSpellNameReply(bot, message, context, { ...deps });
    });

    messageReplyDispatcher.register('spell_param_value', async (bot, message, context, deps) => {
        await handleStepParameterValueReply(bot, message, context, { ...deps });
    });
}

module.exports = {
    handleSpellCommand,
    handleSpellCallback,
    handleNewSpellNameReply,
    handleStepParameterValueReply,
    registerHandlers,
};