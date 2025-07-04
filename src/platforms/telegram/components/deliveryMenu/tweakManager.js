/**
 * @file tweakManager.js
 * @description Handles callbacks for tweaking a generation's parameters.
 * This manager introduces a temporary, in-memory session to hold parameter changes.
 */

const { escapeMarkdownV2, stripHtml } = require('../../../../utils/stringUtils');
const { v4: uuidv4 } = require('uuid');

// In-memory store for pending tweaks. Key: `generationId_masterAccountId`
const pendingTweaks = {};

// --- UI Builder ---

/**
 * Builds the text and keyboard for the Tweak UI menu.
 * @param {string} generationId - The original generation ID.
 * @param {object} currentParams - The current state of parameters for the tweak.
 * @param {object} dependencies - Shared dependencies.
 * @returns {object} - { text, reply_markup }
 */
function buildTweakUIMenu(generationId, masterAccountId, currentParams, dependencies) {
    const { logger } = dependencies;
    const sessionKey = `${generationId}_${masterAccountId}`;

    let text = '*Tweak Generation Parameters*\\n\\n';
    text += 'Modify the parameters below and then click Apply\\. \\n';
    
    const prompt = currentParams.input_prompt || '(No prompt)';
    const seed = currentParams.input_seed || '(Random)';
    
    text += `*Prompt:* \`\`\`\n${escapeMarkdownV2(prompt)}\n\`\`\`\n`;
    text += `*Seed:* \`${escapeMarkdownV2(String(seed))}\`\\n`;

    const keyboard = [
        [
            { text: '✏️ Edit Prompt', callback_data: `tweak_param_edit_start:${sessionKey}:input_prompt` },
            { text: '🎲 Edit Seed', callback_data: `tweak_param_edit_start:${sessionKey}:input_seed` }
        ],
        [
            { text: '✅ Apply Tweaks', callback_data: `tweak_apply:${sessionKey}` },
            { text: '❌ Close Menu', callback_data: `hide_menu` }
        ]
    ];

    return { text, reply_markup: { inline_keyboard: keyboard } };
}


// --- Action-specific Logic Functions ---

async function handleRenderTweakMenuCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal } = dependencies;
    const { data, message } = callbackQuery;

    const parts = data.split(':');
    const generationId = parts[1];
    const sessionKey = `${generationId}_${masterAccountId}`;

    logger.info(`[TweakManager] Tweak menu render request for GenID: ${generationId}`);

    try {
        const currentTweaks = pendingTweaks[sessionKey];

        if (!currentTweaks) {
            logger.warn(`[TweakManager] No pending tweak session found for key ${sessionKey}. Re-initiating from original.`);
        }
        
        // Always fetch the original generation to get the most reliable metadata
        const genResponse = await internal.client.get(`/internal/v1/data/generations/${generationId}`);
        const generationRecord = genResponse.data;
        if (!generationRecord) throw new Error(`Original generation ${generationId} not found.`);

        // If the session was lost, re-initialize it from the record
        if (!currentTweaks) {
            const userFacingPrompt = generationRecord.metadata?.userInputPrompt || generationRecord.requestPayload?.input_prompt;
            pendingTweaks[sessionKey] = { 
                ...(generationRecord.requestPayload || {}),
                input_prompt: userFacingPrompt,
             };
            logger.info(`[TweakManager] Re-initialized lost session: ${sessionKey}`);
        }

        const refreshedMenu = buildTweakUIMenu(generationId, masterAccountId, pendingTweaks[sessionKey], dependencies);

        await bot.editMessageText(refreshedMenu.text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: refreshedMenu.reply_markup,
            parse_mode: 'MarkdownV2'
        });

        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        logger.error(`[TweakManager] Error in handleRenderTweakMenuCallback for ${generationId}:`, error.stack);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Error refreshing tweak menu.", show_alert: true });
    }
}

async function handleApplyTweaks(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal, services } = dependencies;
    const { data, message } = callbackQuery;

    const parts = data.split(':');
    const sessionKey = parts[1];
    const [generationId] = sessionKey.split('_');

    const finalTweakedParams = pendingTweaks[sessionKey];
    logger.info(`[TweakManager] Applying tweaks for session: ${sessionKey}`);

    if (!finalTweakedParams) {
        logger.warn(`[TweakManager] tweak_apply: No pending tweak session found.`);
        await bot.editMessageText("Error: Your tweak session has expired.", {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: null
        });
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Session expired.", show_alert: true });
        return;
    }

    try {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Applying tweaks..." });

        const genResponse = await internal.client.get(`/internal/v1/data/generations/${generationId}`);
        const originalRecord = genResponse.data;
        if (!originalRecord) throw new Error(`Original generation record ${generationId} not found.`);

        const toolId = finalTweakedParams.__canonicalToolId__ || originalRecord.metadata?.toolId;
        if (!toolId) throw new Error(`Could not resolve toolId for tweaked generation.`);

        const { telegramMessageId, telegramChatId, platformContext, initiatingEventId } = originalRecord.metadata;

        const servicePayload = { ...finalTweakedParams };
        delete servicePayload.__canonicalToolId__;

        const newGenMetadata = {
            telegramMessageId, telegramChatId, platformContext,
            parentGenerationId: generationId,
            isTweaked: true,
            initiatingEventId: initiatingEventId || uuidv4(),
            toolId,
            userInputPrompt: finalTweakedParams.input_prompt,
        };

        // --- Refactored: Use centralized execution endpoint ---
        const executionPayload = {
            toolId,
            inputs: servicePayload,
            user: {
                masterAccountId,
                platform: 'telegram',
                platformId: masterAccountId, // Telegram user ID
                platformContext: platformContext || {},
            },
            sessionId: originalRecord.sessionId,
            eventId: initiatingEventId || uuidv4(),
            metadata: newGenMetadata
        };

        const tool = dependencies.toolRegistry.getToolById(toolId);
        if (!tool) throw new Error(`Tool definition not found for toolId: ${toolId}`);

        let executionResponse;
        try {
            executionResponse = await internal.client.post('/internal/v1/data/execute', executionPayload);
            logger.info(`[TweakManager] Tweaked generation submitted via centralized execution endpoint. GenID: ${executionResponse.data.generationId}, RunID: ${executionResponse.data.runId}`);
        } catch (err) {
            logger.error(`[TweakManager] Error submitting tweaked generation to execution endpoint: ${err.message}`);
            await bot.editMessageText("Error: Failed to submit your tweak. Please try again later.", {
                chat_id: message.chat.id,
                message_id: message.message_id,
                reply_markup: null
            });
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Submission failed.", show_alert: true });
            return;
        }

        // Use deliveryMode to determine how to respond
        if (tool.deliveryMode === 'immediate' && executionResponse.data && executionResponse.data.response) {
            await bot.editMessageText(executionResponse.data.response, {
                chat_id: message.chat.id,
                message_id: message.message_id,
                reply_markup: null
            });
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Tweak complete!", show_alert: false });
        } else {
            await bot.editMessageText("🚀 Your tweaked generation is on its way!", {
                chat_id: message.chat.id,
                message_id: message.message_id,
                reply_markup: null
            });
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Applying tweaks...", show_alert: false });
        }
        delete pendingTweaks[sessionKey];
        logger.info(`[TweakManager] Cleared pendingTweaks for sessionKey: ${sessionKey}`);

    } catch (error) {
        logger.error(`[TweakManager] Error in tweak_apply for session ${sessionKey}:`, error.stack);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Error applying tweaks.", show_alert: true });
    }
}

// --- Main Callback Handler ---

async function handleTweakGenCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal, toolRegistry } = dependencies;
    const { data, message } = callbackQuery;

    logger.info(`[TweakManager] handleTweakGenCallback triggered with data: ${data}`);

    try {
        if (data.startsWith('tweak_gen_menu_render:')) {
            // This is for refreshing the menu, not implemented via this handler yet.
            // Let's forward to the main logic which can handle session loss.
        }

        const parts = data.split(':');
        const generationId = parts[1];

        // 1. Fetch the original generation record
        const genResponse = await internal.client.get(`/internal/v1/data/generations/${generationId}`);
        const generationRecord = genResponse.data;
        if (!generationRecord) throw new Error(`Generation record ${generationId} not found.`);

        // 2. Extract necessary info
        const originalParams = generationRecord.requestPayload || {};
        const toolId = generationRecord.metadata?.toolId || originalParams.invoked_tool_id || originalParams.tool_id || generationRecord.serviceName;
        const originalUserCommandMessageId = generationRecord.metadata?.telegramMessageId;
        const originalUserCommandChatId = generationRecord.metadata?.telegramChatId;

        if (!originalUserCommandMessageId || !originalUserCommandChatId) {
            throw new Error(`Original command context missing in metadata for ${generationId}.`);
        }

        // 3. Initialize pendingTweaks for this session
        const tweakSessionKey = `${generationId}_${masterAccountId}`;
        const userFacingPrompt = generationRecord.metadata?.userInputPrompt || originalParams.input_prompt;
        
        pendingTweaks[tweakSessionKey] = { 
            ...originalParams,
            input_prompt: userFacingPrompt,
        }; 
        logger.info(`[TweakManager] Initialized pendingTweaks for sessionKey: ${tweakSessionKey}`);

        // 4. Build and send the Tweak UI Menu
        const tweakMenu = buildTweakUIMenu(generationId, masterAccountId, pendingTweaks[tweakSessionKey], dependencies);

        if (tweakMenu && tweakMenu.text && tweakMenu.reply_markup) {
            await bot.sendMessage(originalUserCommandChatId, tweakMenu.text, { 
                parse_mode: 'MarkdownV2',
                reply_markup: tweakMenu.reply_markup,
                reply_to_message_id: originalUserCommandMessageId 
            });
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Opening tweak menu..." });
        } else {
            delete pendingTweaks[tweakSessionKey];
            throw new Error('Failed to build tweak UI menu.');
        }

    } catch (error) {
        logger.error(`[TweakManager] Error in handleTweakGenCallback for data ${data}:`, error.stack);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Error initiating tweak mode.", show_alert: true });
    }
}


function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;
    const { logger } = dependencies;

    callbackQueryDispatcher.register('tweak_gen:', handleTweakGenCallback);
    callbackQueryDispatcher.register('tweak_gen_menu_render:', (bot, cbq, maid) => handleRenderTweakMenuCallback(bot, cbq, maid, dependencies));
    
    // Stubs for future logic
    callbackQueryDispatcher.register('tweak_param_edit_start:', async (bot, cbq) => {
        logger.warn(`[TweakManager] 'tweak_param_edit_start' not fully implemented.`);
        await bot.answerCallbackQuery(cbq.id, {text: "Editing not implemented yet.", show_alert: true});
    });
    callbackQueryDispatcher.register('tweak_apply:', (bot, cbq, maid) => handleApplyTweaks(bot, cbq, maid, dependencies));
    callbackQueryDispatcher.register('tweak_cancel:', async (bot, callbackQuery, masterAccountId, dependencies) => {
        const { data } = callbackQuery;
        const parts = data.split(':');
        const sessionKey = parts[1];
        const [generationId] = sessionKey.split('_');

        // Re-route to the render function to show the main menu again
        const renderData = `tweak_gen_menu_render:${generationId}`;
        const newCallbackQuery = { ...callbackQuery, data: renderData };
        await handleRenderTweakMenuCallback(bot, newCallbackQuery, masterAccountId, dependencies);
    });

    logger.info('[TweakManager] All handlers registered.');
}

module.exports = {
    registerHandlers,
}; 