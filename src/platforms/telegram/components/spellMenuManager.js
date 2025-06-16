const { sendEscapedMessage, editEscapedMessageText } = require('../utils/messaging');

/**
 * Handles the initial /spell command.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The Telegram message object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleSpellCommand(bot, msg, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    logger.info(`[SpellMenu] /spell command received from ${username} (MAID: ${masterAccountId}, ChatID: ${chatId})`);

    try {
        const menu = await buildMainMenu(masterAccountId, username, dependencies);
        await sendEscapedMessage(bot, chatId, menu.text, {
            reply_markup: menu.reply_markup,
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        logger.error('[SpellMenu] Error in handleSpellCommand:', error);
        await sendEscapedMessage(bot, chatId, "Sorry, I couldn't open the spellbook right now. Please try again later.", { reply_to_message_id: msg.message_id });
    }
}


/**
 * Builds the main spellbook menu.
 * @param {string} masterAccountId
 * @param {string} username
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildMainMenu(masterAccountId, username, dependencies) {
    const { logger } = dependencies;
    const text = `${username}'s Spellbook\n\nCreate a new spell or manage your existing ones`;
    const keyboard = [];

    keyboard.push([{ text: "🪄 Create New Spell", callback_data: "spell_create" }]);

    try {
        // Fetch spells owned by the user using the new API
        const response = await dependencies.internal.client.get(`/internal/v1/data/spells`, { params: { ownedBy: masterAccountId } });
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
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleSpellCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, toolRegistry, replyContextManager } = dependencies;
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
            const sentMessage = await editEscapedMessageText(bot, chatId, messageId, text, {
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
            const menu = await buildMainMenu(masterAccountId, username, dependencies);
            await editEscapedMessageText(bot, chatId, messageId, menu.text, {
                reply_markup: menu.reply_markup
            });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_manage_')) {
            const spellSlug = data.substring('spell_manage_'.length);
            try {
                const response = await dependencies.internal.client.get(`/internal/v1/data/spells/${spellSlug}`, { params: { masterAccountId } });
                logger.info(`[SpellMenu] spell_manage_: Raw response for slug ${spellSlug}:`, response.data);
                const spell = response.data;

                if (!spell || spell.error) {
                    logger.error(`[SpellMenu] Callback 'spell_manage_': Could not find spell with slug: ${spellSlug}. Response:`, response.data);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Spell not found.', show_alert: true });
                    return;
                }

                logger.info(`[SpellMenu] spell_manage_: Spell object for slug ${spellSlug}:`, spell);
                try {
                    const menu = await buildSpellEditorMenu(masterAccountId, spell, dependencies);
                    await editEscapedMessageText(bot, chatId, messageId, menu.text, {
                        reply_markup: menu.reply_markup
                    });
                } catch (menuError) {
                    logger.error(`[SpellMenu] Error building or sending spell editor menu for slug '${spellSlug}':`, menuError.stack || menuError);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: "Error displaying spell editor.", show_alert: true });
                    return;
                }

            } catch (error) {
                logger.error(`[SpellMenu] Error fetching spell by slug '${spellSlug}':`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Sorry, couldn't load that spell.", show_alert: true });
                return;
            }
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_add_tool_category_')) {
            const dataString = data.substring('spell_add_tool_category_'.length);
            const [spellSlug, category, pageStr] = dataString.split(':');
            const page = pageStr ? parseInt(pageStr, 10) : 0;

            const menu = await buildToolSelectionMenu(spellSlug, category, page, dependencies);
             await editEscapedMessageText(bot, chatId, messageId, menu.text, {
                reply_markup: menu.reply_markup
            });
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        if (data.startsWith('spell_add_tool_')) {
            const spellSlug = data.substring('spell_add_tool_'.length);
            const menu = await buildAddToolCategoryMenu(spellSlug, dependencies);
            await editEscapedMessageText(bot, chatId, messageId, menu.text, {
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
                const spellResponse = await dependencies.internal.client.get(`/internal/v1/data/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = spellResponse.data;
                if (!spell) {
                    logger.error(`[SpellMenu] 'spell_select_tool_': Could not find spell with slug: ${spellSlug}`);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Spell not found.', show_alert: true });
                    return;
                }
                const spellId = spell._id;

                await dependencies.internal.client.post(`/internal/v1/data/spells/${spellId}/steps`, { toolId, masterAccountId });
                logger.info(`[SpellMenu] Successfully added tool '${toolId}' to spell '${spellId}'.`);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Added tool!`});

                // Re-fetch the spell to get updated steps for the menu
                const updatedSpellResponse = await dependencies.internal.client.get(`/internal/v1/data/spells/${spellSlug}`, { params: { masterAccountId } });
                const updatedSpell = updatedSpellResponse.data;
                const menu = await buildSpellEditorMenu(masterAccountId, updatedSpell, dependencies);
                await editEscapedMessageText(bot, chatId, messageId, menu.text, {
                    reply_markup: menu.reply_markup
                });

            } catch (error) {
                logger.error(`[SpellMenu] Failed to add tool '${toolId}' to spell with slug '${spellSlug}':`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Error adding tool. Please try again.`, show_alert: true});
                // On error, just go back to the spell editor without changes
                const spellResponse = await dependencies.internal.client.get(`/internal/v1/data/spells/${spellSlug}`, { params: { masterAccountId } });
                const menu = await buildSpellEditorMenu(masterAccountId, spellResponse.data, dependencies);
                await editEscapedMessageText(bot, chatId, messageId, menu.text, {
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
                const spellResponse = await dependencies.internal.client.get(`/internal/v1/data/spells/${spellSlug}`, { params: { masterAccountId } });
                const spell = spellResponse.data;
                if (!spell) {
                    logger.error(`[SpellMenu] 'spell_delete_': Could not find spell with slug: ${spellSlug}`);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Spell to delete not found.', show_alert: true });
                    return;
                }
                const spellId = spell._id;
                
                // The API's delete method checks for ownership via masterAccountId in the body
                await dependencies.internal.client.delete(`/internal/v1/data/spells/${spellId}`, { data: { masterAccountId } });
                logger.info(`[SpellMenu] Successfully deleted spell '${spellId}'.`);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Spell deleted.`});

                const menu = await buildMainMenu(masterAccountId, username, dependencies);
                await editEscapedMessageText(bot, chatId, messageId, menu.text, {
                    reply_markup: menu.reply_markup
                });

            } catch (error) {
                logger.error(`[SpellMenu] Failed to delete spell with slug '${spellSlug}':`, error.response?.data || error.message);
                await bot.answerCallbackQuery(callbackQuery.id, {text: `Error deleting spell.`, show_alert: true});
                return;
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
                
                const menu = await buildStepEditorMenu(spell, step, dependencies);
                await editEscapedMessageText(bot, chatId, messageId, menu.text, {
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

                let promptText = `Please reply to this message with the new value for ${paramName.replace('input_', '')}.`;
                if (paramDef.description) {
                    promptText += `\n\n${paramDef.description}`;
                }
                if (paramDef.type === 'boolean') {
                    promptText += `\n\n(Try 'true' or 'false')`;
                }

                const sentMessage = await editEscapedMessageText(bot, chatId, messageId, promptText, {
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
 * Handles the reply when a user provides a name for a new spell.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The user's reply message with the spell name.
 * @param {object} context - The reply context.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleNewSpellNameReply(bot, msg, context, dependencies) {
    const { logger, internalApiClient } = dependencies;
    const chatId = msg.chat.id;
    const { masterAccountId } = context;
    const spellName = msg.text.trim();
    const username = msg.from.username || msg.from.first_name;

    logger.info(`[SpellMenu] Received reply for new spell name. MAID: ${masterAccountId}, Name: '${spellName}'`);

    try {
        const response = await internalApiClient.post('/spells', {
            name: spellName,
            creatorId: masterAccountId,
            ownedBy: masterAccountId
        });
        const newSpell = response.data;
        logger.info(`[SpellMenu] Successfully created new spell with ID: ${newSpell._id}`);

        await sendEscapedMessage(bot, chatId, `✅ Spell "${spellName}" created!`, {
            reply_to_message_id: msg.message_id
        });

        // Show the editor for the new spell
        if (msg.reply_to_message && msg.reply_to_message.message_id) {
            const menu = await buildSpellEditorMenu(masterAccountId, newSpell, dependencies);
            await editEscapedMessageText(bot, chatId, msg.reply_to_message.message_id, menu.text, {
                reply_markup: menu.reply_markup
            });
        }
    } catch (error) {
        const errorMessage = error.response?.data?.message || `Sorry, could not create spell "${spellName}".`;
        logger.error(`[SpellMenu] Error in handleNewSpellNameReply for MAID ${masterAccountId}:`, error);
        await sendEscapedMessage(bot, chatId, `⚠️ ${errorMessage}`, {
            reply_to_message_id: msg.message_id
        });
    }
}

/**
 * Handles the reply when a user provides a value for a spell step parameter.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The user's reply message.
 * @param {object} context - The reply context.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function handleStepParameterValueReply(bot, msg, context, dependencies) {
    const { logger, internalApiClient } = dependencies;
    const chatId = msg.chat.id;
    const { masterAccountId, spellSlug, stepId, paramKey } = context;
    const newValue = msg.text;

    logger.info(`[SpellMenu] Received reply for spell param. MAID: ${masterAccountId}, SpellSlug: ${spellSlug}, StepID: ${stepId}, Param: ${paramKey}, Value: '${newValue}'`);

    try {
        const spellResponse = await internalApiClient.get(`/spells/${spellSlug}`, { params: { masterAccountId } });
        const spell = spellResponse.data;
        if (!spell) throw new Error(`Spell with slug ${spellSlug} not found.`);
        const spellId = spell._id;

        await internalApiClient.put(`/spells/${spellId}/steps/${stepId}/parameters`, {
            masterAccountId,
            updates: { [paramKey]: newValue }
        });

        await sendEscapedMessage(bot, chatId, `✅ Parameter '${paramKey}' updated!`, {
            reply_to_message_id: msg.message_id
        });

        // Refresh the spell editor menu
        if (msg.reply_to_message && msg.reply_to_message.message_id) {
            const response = await internalApiClient.get(`/spells/${spell.slug}`, { params: { masterAccountId } });
            const updatedSpell = response.data;
            const menu = await buildSpellEditorMenu(masterAccountId, updatedSpell, dependencies);
            await editEscapedMessageText(bot, chatId, msg.reply_to_message.message_id, menu.text, {
                reply_markup: menu.reply_markup,
            });
        }
    } catch (error) {
        const errorMessage = error.response?.data?.message || 'Sorry, a critical error occurred while updating the parameter.';
        logger.error(`[SpellMenu] Error in handleStepParameterValueReply for MAID ${masterAccountId}:`, error);
        await sendEscapedMessage(bot, chatId, `⚠️ ${errorMessage}`, {
            reply_to_message_id: msg.message_id
        });
    }
}

/**
 * Builds the menu for editing a specific spell.
 * @param {string} masterAccountId
 * @param {string} spellSlug
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildSpellEditorMenu(masterAccountId, spell, dependencies) {
    try {
        const { logger, toolRegistry } = dependencies;
        let text = `*Spell: ${(spell.name)}* (slug: \`${(spell.slug)}\`)\\n`;
        text += `Description: _${(spell.description || 'No description yet.')}_\\n\\n`;
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
            text += 'This spell has no steps. Add your first tool to begin';
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
    } catch (error) {
        logger.error(`[SpellMenu] Error in buildSpellEditorMenu: ${error}`);
        return { text: "Error: Could not build spell editor menu.", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: `spell_main` }]] } };
    }
    
}

/**
 * Builds the menu for editing a specific step's parameters.
 * @param {object} spell - The full spell object.
 * @param {object} step - The specific step object to edit.
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildStepEditorMenu(spell, step, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const tool = toolRegistry.getToolById(step.toolId);
    if (!tool) {
        logger.error(`[SpellMenu] buildStepEditorMenu: Could not find tool with ID '${step.toolId}' in registry.`);
        return { text: "Error: Tool definition not found.", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: `spell_manage_${spell.slug}` }]] } };
    }

    let text = `Editing Step ${step.stepId}: ${tool.displayName}\n\n`;
    text += `Configure the parameters for this tool.`;

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
        text += '\n\nThis tool has no configurable parameters. You can still change its position in the spell.';
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
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildAddToolCategoryMenu(spellSlug, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const text = "Choose a tool category to add to your spell:";
    const categories = toolRegistry.getToolCategories();

    const keyboard = [];
    const row = [];
    categories.forEach(category => {
        const buttonText = category.charAt(0).toUpperCase() + category.slice(1);
        const callbackData = `spell_add_tool_category_${spellSlug}:${category}`;
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
 * @param {object} dependencies - The canonical dependencies object.
 * @returns {Promise<object>} Menu object { text, reply_markup }
 */
async function buildToolSelectionMenu(spellSlug, category, page = 0, dependencies) {
    const { logger, toolRegistry } = dependencies;
    const ITEMS_PER_PAGE = 6;
    const text = `Select a tool from the '${category}' category (Page ${page + 1}):`;

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
    const backCb = `spell_add_tool_${spellSlug}`;
    logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating back button with data: "${backCb}" (Length: ${Buffer.from(backCb).length} bytes)`);
    navRow.push({ text: "⬅️ Back", callback_data: backCb });

    if (page < totalPages - 1) {
        const cb = `spell_add_tool_category_${spellSlug}:${category}:${page + 1}`;
        logger.info(`[SpellMenu] BuildToolSelectionMenu: Generating nav button with data: "${cb}" (Length: ${Buffer.from(cb).length} bytes)`);
        navRow.push({ text: "Next ➡️", callback_data: cb });
    }

    if (navRow.length > 0) {
        keyboard.push(navRow);
    }

    return {
        text,
        reply_markup: { inline_keyboard: keyboard }
    };
}

/**
 * The handler for the /spell command.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The message object from the command.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function spellCommandHandler(bot, msg, dependencies) {
    const { logger } = dependencies;
    const username = msg.from.username || msg.from.first_name;
    logger.info(`[SpellMenu] spellCommandHandler triggered for ${username}`);
    try {
        const findOrCreateResponse = await dependencies.internal.client.post('/internal/v1/data/users/find-or-create', {
            platform: 'telegram',
            platformId: msg.from.id.toString(),
            platformContext: { firstName: msg.from.first_name, username: msg.from.username }
        });
        const masterAccountId = findOrCreateResponse.data.masterAccountId;
        await handleSpellCommand(bot, msg, masterAccountId, dependencies);
    } catch (error) {
        logger.error(`[SpellMenu] Critical error in spellCommandHandler for ${username}:`, error.stack || error);
        await sendEscapedMessage(bot, msg.chat.id, "A critical error occurred while handling your command.");
    }
}

/**
 * The handler for callback queries related to the spell menu.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function spellCallbackHandler(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const username = callbackQuery.from.username || callbackQuery.from.first_name;
    logger.info(`[SpellMenu] spellCallbackHandler triggered for ${username} with data: ${callbackQuery.data}`);
    try {
        await handleSpellCallback(bot, callbackQuery, masterAccountId, dependencies);
    } catch (error) {
        logger.error(`[SpellMenu] Critical error in spellCallbackHandler for ${username}:`, error.stack || error);
        // Avoid double-answering
        if (!callbackQuery.answered) {
          try {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "A critical error occurred.", show_alert: true });
          } catch (e) {
            logger.error(`[SpellMenu] CRITICAL: Failed to answer callback query in error handler:`, e);
          }
        }
    }
}

/**
 * Registers all handlers for the spell menu feature.
 * @param {object} dispatcherInstances - The command/callback dispatchers.
 * @param {object} dependencies - The canonical dependencies object.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher, messageReplyDispatcher } = dispatcherInstances;
    const { logger } = dependencies;

    const newSpellNameHandler = (bot, msg, context) => handleNewSpellNameReply(bot, msg, context, dependencies);
    const stepParameterValueHandler = (bot, msg, context) => handleStepParameterValueReply(bot, msg, context, dependencies);

    // Command to initiate the spell menu
    commandDispatcher.register(/^\/spells(?:@\w+)?$/, spellCommandHandler);

    // Callbacks for navigating the spell menu
    callbackQueryDispatcher.register('spell', spellCallbackHandler);

    // Message replies for spell creation/configuration
    messageReplyDispatcher.register('spell_create_name', newSpellNameHandler);
    messageReplyDispatcher.register('spell_set_step_param', stepParameterValueHandler);

    // Register a handler for the /cast command
    commandDispatcher.register(/^\/cast(?:@\w+)?(?:\s+(.*))?$/i, async (bot, msg, dependencies, match) => {
        const { logger, internal, spellsService } = dependencies;
        const chatId = msg.chat.id;
        const username = msg.from.username || msg.from.first_name;
        let spellSlug = null;
        let paramOverrides = {};
        // Parse slug and parameter overrides from the command
        if (match && match[1]) {
            const parts = match[1].trim().split(/\s+/);
            spellSlug = parts[0];
            // Parse param1=foo param2=bar ...
            for (let i = 1; i < parts.length; i++) {
                const [key, value] = parts[i].split('=');
                if (key && value !== undefined) {
                    paramOverrides[key] = value;
                }
            }
        }
        if (!spellSlug) {
            await bot.sendMessage(chatId, "Usage: /cast <spell_slug> [param1=val1 param2=val2 ...]", { reply_to_message_id: msg.message_id });
            return;
        }
        try {
            // Resolve masterAccountId
            const findOrCreateResponse = await internal.client.post('/internal/v1/data/users/find-or-create', {
                platform: 'telegram',
                platformId: msg.from.id.toString(),
                platformContext: { firstName: msg.from.first_name, username: msg.from.username }
            });
            const masterAccountId = findOrCreateResponse.data.masterAccountId;
            if (!masterAccountId) {
                logger.error(`[SpellMenu] /cast: Could not resolve masterAccountId for user ${msg.from.id}.`);
                await bot.sendMessage(chatId, "I couldn't identify your account. Please try again or contact support.", { reply_to_message_id: msg.message_id });
                return;
            }
            // Call SpellsService to cast the spell
            const result = await spellsService.castSpell(spellSlug, {
                masterAccountId,
                parameterOverrides: paramOverrides,
                platform: 'telegram',
                telegramContext: { chatId, messageId: msg.message_id, userId: msg.from.id }
            });
            // TODO: Improve result display (show output, images, etc.)
            await bot.sendMessage(chatId, `✅ Spell '${spellSlug}' cast successfully!`, { reply_to_message_id: msg.message_id });
        } catch (error) {
            logger.error(`[SpellMenu] /cast error for slug '${spellSlug}': ${error.stack || error}`);
            await bot.sendMessage(chatId, `❌ Failed to cast spell '${spellSlug}': ${error.message || error}`, { reply_to_message_id: msg.message_id });
        }
    });

    logger.info('[SpellMenuManager] All handlers registered.');
}

module.exports = {
    registerHandlers,
};
