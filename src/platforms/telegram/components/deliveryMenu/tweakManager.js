/**
 * @file tweakManager.js
 * @description Handles callbacks for tweaking a generation's parameters.
 * This manager introduces a temporary, in-memory session to hold parameter changes.
 */

const { escapeMarkdownV2, stripHtml } = require('../../../../utils/stringUtils');
const { v4: uuidv4 } = require('uuid');

// Map short tokens to sessionKeys to keep callback_data under Telegram's 64-byte limit
const tokenToSessionKey = new Map();
const sessionKeyToToken = new Map();
function getSessionToken(sessionKey) {
    if (sessionKeyToToken.has(sessionKey)) return sessionKeyToToken.get(sessionKey);
    const token = uuidv4().split('-')[0]; // 8 chars
    tokenToSessionKey.set(token, sessionKey);
    sessionKeyToToken.set(sessionKey, token);
    return token;
}
function resolveSessionKey(token) {
    return tokenToSessionKey.get(token);
}

// In-memory store for pending tweaks. Key: `generationId_masterAccountId`
const pendingTweaks = {};

function formatParamName(param) {
    return param.replace(/^input_/, '').replace(/_/g, ' ');
}

// --- UI Builder ---

/**
 * Builds the text and keyboard for the Tweak UI menu.
 * @param {string} generationId - The original generation ID.
 * @param {object} currentParams - The current state of parameters for the tweak.
 * @param {object} dependencies - Shared dependencies.
 * @returns {object} - { text, reply_markup }
 */
function buildTweakUIMenu(generationId, masterAccountId, currentParams, toolDef, hasPendingChanges = false, dependencies = {}) {
    const sessionKey = `${generationId}_${masterAccountId}`;
    const token = getSessionToken(sessionKey);

    const keyboard = [];

    const { logger } = dependencies;
    if (!toolDef) {
        logger?.warn(`[TweakManager] buildTweakUIMenu: toolDef null for generation ${generationId}`);
    } else {
        logger?.info(`[TweakManager] buildTweakUIMenu: tool ${toolDef.displayName} params ${Object.keys(toolDef.inputSchema||{}).join(',')}`);
    }

    if (toolDef && toolDef.inputSchema) {
        for (const param of Object.keys(toolDef.inputSchema)) {
            logger?.info(`[TweakManager] adding param button ${param} value=${currentParams[param]}`);
            const rawVal = currentParams[param];
            let label;
            if (typeof rawVal === 'string' && rawVal.startsWith('http')) {
                label = `${formatParamName(param)}: link`;
            } else if (rawVal === undefined || rawVal === null || rawVal === '') {
                label = `${formatParamName(param)}: (none)`;
            } else {
                const str = String(rawVal);
                label = `${formatParamName(param)}: ${str.length>15?str.slice(0,12)+'…':str}`;
            }
            keyboard.push([{ text: label, callback_data: `tpe_${token}_${param}` }]);
        }
    }

    if (hasPendingChanges) {
        keyboard.push([{ text: 'Send', callback_data: `tweak_apply:${token}` }]);
    }
    keyboard.push([{ text: '❌ Cancel', callback_data: `tweak_cancel:${token}` }]);

    return { text: '🔧 Tweak parameters', reply_markup: { inline_keyboard: keyboard } };
}


// --- Action-specific Logic Functions ---

async function handleRenderTweakMenuCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal } = dependencies;
    const { data, message } = callbackQuery;

    const parts = data.split(':');
    const generationId = parts[1];
    const token = parts[1];
    const sessionKey = resolveSessionKey(token);

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
            const toolDisplayName = generationRecord.toolDisplayName || generationRecord.metadata?.toolDisplayName;
            const toolDefForInit = dependencies.toolRegistry.findByDisplayName(toolDisplayName);
            pendingTweaks[sessionKey] = { 
                ...(generationRecord.requestPayload || {}),
                input_prompt: userFacingPrompt,
                toolDisplayName,
                __canonicalToolId__: toolDefForInit ? toolDefForInit.toolId : generationRecord.metadata?.toolId,
            };
            logger.info(`[TweakManager] Re-initialized lost session: ${sessionKey}`);
        }

        const toolDisplayName = generationRecord.toolDisplayName || generationRecord.metadata?.toolDisplayName;
        const toolDef = dependencies.toolRegistry.findByDisplayName(toolDisplayName);
        const refreshedMenu = buildTweakUIMenu(generationId, masterAccountId, pendingTweaks[sessionKey], toolDef, false, dependencies);

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
    const token = parts[1];
    const sessionKey = resolveSessionKey(token);
    const [generationId] = sessionKey ? sessionKey.split('_') : [];

    const finalTweakedParams = sessionKey ? pendingTweaks[sessionKey] : undefined;
    logger.info(`[TweakManager] Applying tweaks for session: ${sessionKey}`);

    if (!sessionKey || !finalTweakedParams) {
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

        const displayName = finalTweakedParams.toolDisplayName || originalRecord.toolDisplayName || originalRecord.metadata?.toolDisplayName;
        if (!displayName) throw new Error('Could not resolve toolDisplayName for tweaked generation.');

        const toolDef = dependencies.toolRegistry.findByDisplayName(displayName);
        if (!toolDef) throw new Error(`Tool definition not found for displayName: ${displayName}`);

        const toolId = toolDef.toolId;
        // refresh canonical id in session store for future actions
        finalTweakedParams.__canonicalToolId__ = toolId;

        const { telegramMessageId, telegramChatId, platformContext, initiatingEventId } = originalRecord.metadata;

        // Build payload containing only valid input params (no internal metadata)
        const permittedKeys = new Set(Object.keys(toolDef.inputSchema || {}));
        const servicePayload = {};
        for (const [k,v] of Object.entries(finalTweakedParams)) {
            if (permittedKeys.has(k)) servicePayload[k]=v;
        }

        // Build notificationContext so finished generation can reply correctly
        let notificationContext;
        const fallbackChatId = platformContext?.chatId || telegramChatId || finalTweakedParams.__menuChatId;
        const fallbackMsgId = platformContext?.messageId || telegramMessageId || finalTweakedParams.__menuMsgId;
        notificationContext = {
            chatId: fallbackChatId,
            messageId: fallbackMsgId,
            replyToMessageId: fallbackMsgId,
        };

        const newGenMetadata = {
            telegramMessageId, telegramChatId, platformContext,
            parentGenerationId: generationId,
            isTweaked: true,
            initiatingEventId: initiatingEventId || uuidv4(),
            toolId,
            userInputPrompt: finalTweakedParams.input_prompt,
            notificationContext,
        };

        // --- Refactored: Use centralized execution endpoint ---
        // --- Create an event so we have a valid ObjectId ---
        let eventId;
        try {
            const evResp = await internal.client.post('/internal/v1/data/events', {
                masterAccountId,
                eventType: 'tweak_submitted',
                sourcePlatform: 'telegram',
                eventData: { parentGenerationId: generationId, toolId }
            });
            eventId = evResp.data._id;
        } catch (e) {
            logger.warn('[TweakManager] failed to create event for tweak submission:', e.message);
        }

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
            ...(eventId ? { eventId } : {}),
            metadata: newGenMetadata
        };

        const tool = toolDef;
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

        // Restore or delete menu
        const { __menuChatId, __menuMsgId, __origKeyboard, __isNewMenu } = finalTweakedParams;
        if (__isNewMenu && __menuChatId && __menuMsgId) {
            try { await bot.deleteMessage(__menuChatId, __menuMsgId); } catch(e){ logger.warn('Failed to delete tweak menu:', e.message);}    
        } else if (!__isNewMenu && __menuChatId && __menuMsgId) {
            const baseKb = __origKeyboard || message.reply_markup?.inline_keyboard || [];
            const newKb = JSON.parse(JSON.stringify(baseKb));
            let updated=false;
            for (const row of newKb) {
                for (const btn of row) {
                    if (btn.callback_data && btn.callback_data.startsWith('tweak_gen:')) {
                        const match = btn.text.match(/^✎\s*(\d+)?/);
                        dependencies.logger?.info(`[TweakManager] Incrementing tweak counter. Before: ${btn.text}`);
                        if (match) {
                            const n = parseInt(match[1]||'0',10)+1;
                            btn.text = `✎${n}`;
                        } else {
                            btn.text = '✎1';
                        }
                        updated=true; break;
                    }
                }
                if(updated) break;
            }
            try { await bot.editMessageReplyMarkup({ inline_keyboard: newKb }, { chat_id: __menuChatId, message_id: __menuMsgId }); } catch(e) { logger.warn('Failed to restore delivery menu:', e.message);}        
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
        const toolDisplayName = generationRecord.toolDisplayName || generationRecord.metadata?.toolDisplayName;
        // Resolve the original Telegram message/chat IDs from multiple possible metadata locations
        const originalUserCommandMessageId =
            generationRecord.metadata?.telegramMessageId ??
            generationRecord.metadata?.notificationContext?.messageId ??
            generationRecord.metadata?.platformContext?.messageId;

        const originalUserCommandChatId =
            generationRecord.metadata?.telegramChatId ??
            generationRecord.metadata?.notificationContext?.chatId ??
            generationRecord.metadata?.platformContext?.chatId;

        if (!originalUserCommandMessageId || !originalUserCommandChatId) {
            throw new Error(`Original command context missing in metadata for ${generationId}.`);
        }

        // 3. Initialize pendingTweaks for this session
        const tweakSessionKey = `${generationId}_${masterAccountId}`;
        const userFacingPrompt = generationRecord.metadata?.userInputPrompt || originalParams.input_prompt;
        
        const toolDefForInit = dependencies.toolRegistry.findByDisplayName(toolDisplayName);
        pendingTweaks[tweakSessionKey] = { 
            ...originalParams,
            input_prompt: userFacingPrompt,
            toolDisplayName,
            __canonicalToolId__: toolDefForInit ? toolDefForInit.toolId : generationRecord.metadata?.toolId
        }; 
        logger.info(`[TweakManager] Initialized pendingTweaks for sessionKey: ${tweakSessionKey}`);

        // 4. Build and send the Tweak UI Menu
        const toolDef = dependencies.toolRegistry.findByDisplayName(
            pendingTweaks[tweakSessionKey].toolDisplayName || toolDisplayName
        );
        const tweakMenu = buildTweakUIMenu(
            generationId,
            masterAccountId,
            pendingTweaks[tweakSessionKey],
            toolDef,
            false,
            dependencies
        );

        if (tweakMenu && tweakMenu.reply_markup) {
            try {
                // Store original keyboard before overwrite
                pendingTweaks[tweakSessionKey].__origKeyboard = message.reply_markup?.inline_keyboard;
                await bot.editMessageReplyMarkup(tweakMenu.reply_markup, {
                    chat_id: originalUserCommandChatId,
                    message_id: originalUserCommandMessageId,
                });
                pendingTweaks[tweakSessionKey].__menuChatId = originalUserCommandChatId;
                pendingTweaks[tweakSessionKey].__menuMsgId = originalUserCommandMessageId;
                pendingTweaks[tweakSessionKey].__isNewMenu = false;
            } catch (err) {
                const msg = err.response?.body?.description || err.message;
                if (msg.includes("can't be edited")) {
                    logger.info('[TweakManager] Message too old to edit, sending new tweak menu');
                    const sent = await bot.sendMessage(originalUserCommandChatId, '🔧 Tweak parameters', {
                        reply_markup: tweakMenu.reply_markup,
                        reply_to_message_id: originalUserCommandMessageId,
                    });
                    pendingTweaks[tweakSessionKey].__menuChatId = sent.chat.id;
                    pendingTweaks[tweakSessionKey].__menuMsgId = sent.message_id;
                    pendingTweaks[tweakSessionKey].__isNewMenu = true;
                } else {
                    logger.error('[TweakManager] editMessageReplyMarkup error:', msg);
                    throw err;
                }
            }
            await bot.answerCallbackQuery(callbackQuery.id);
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
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        throw new Error('[TweakManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;

    const { callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;
    const { logger } = dependencies;

    callbackQueryDispatcher.register('tweak_gen:', handleTweakGenCallback);
    callbackQueryDispatcher.register('tweak_gen_menu_render:', (bot, cbq, maid) => handleRenderTweakMenuCallback(bot, cbq, maid, dependencies));
    
    callbackQueryDispatcher.register('tpe_', async (bot, cbq) => {
        await handleParamEditStart(bot, cbq, dependencies);
    });
    callbackQueryDispatcher.register('tweak_apply:', (bot, cbq, maid) => handleApplyTweaks(bot, cbq, maid, dependencies));
    // register reply handler for param edit
    messageReplyDispatcher.register('tweak_param_edit', (bot, msg, ctx) => handleParamEditReply(bot, msg, ctx, dependencies));

    callbackQueryDispatcher.register('tweak_cancel:', async (bot, callbackQuery, masterAccountId, dependencies) => {
        const { data } = callbackQuery;
        const parts = data.split(':');
        const token = parts[1];
        const sessionKey = resolveSessionKey(token);
        const generationId = sessionKey ? sessionKey.split('_')[0] : undefined;

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

// --- Param Edit Handlers ---

async function handleParamEditStart(bot, callbackQuery, dependencies) {
    const { logger, replyContextManager, toolRegistry } = dependencies;
    const { data, message } = callbackQuery;

    // data format: tpe_<token>_<paramName> where paramName may contain underscores
    const match = data.match(/^tpe_([^_]+)_(.+)$/);
    if (!match) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Invalid callback.', show_alert: true });
        return;
    }
    const [, token, paramName] = match;
    const sessionKey = resolveSessionKey(token);
    if (!sessionKey) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Session expired.', show_alert: true });
        return;
    }
    const [generationId, masterAccountId] = sessionKey.split('_');
    const currentParams = pendingTweaks[sessionKey] || {};

    const menuChatId = currentParams.__menuChatId;
    const menuMsgId = currentParams.__menuMsgId;

    const generationResp = await dependencies.internal.client.get(`/internal/v1/data/generations/${generationId}`);
    const generationRecord = generationResp.data;
    const toolDisplayName = generationRecord.toolDisplayName || generationRecord.metadata?.toolDisplayName;
    const toolDef = toolRegistry.findByDisplayName(toolDisplayName);

    let currentVal = currentParams[paramName];
    if (currentVal === undefined) {
        // fallback to original request payload from generation record
        currentVal = generationRecord.requestPayload?.[paramName];
    }
    // Redact Telegram file links containing bot token
    if (typeof currentVal === 'string' && currentVal.startsWith('https://api.telegram.org')) {
        currentVal = '(telegram file)';
    }
    const { escapeMarkdownV2ForCode } = require('../../../../utils/stringUtils');
    const safeLabel = escapeMarkdownV2(paramName);
    const safeValCode = currentVal !== undefined ? escapeMarkdownV2ForCode(String(currentVal)) : '(none)';
    const promptText = `Current value for *${safeLabel}*:\n\`${safeValCode}\`\n\nReply with the new value`;

    const sent = await bot.sendMessage(message.chat.id, promptText, { parse_mode: 'MarkdownV2', reply_to_message_id: message.message_id });

    replyContextManager.addContext(sent, { type: 'tweak_param_edit', token, paramName, sessionKey, generationId, masterAccountId, menuChatId, menuMsgId });

    await bot.answerCallbackQuery(callbackQuery.id);
}

async function handleParamEditReply(bot, msg, context, dependencies) {
    const { logger, replyContextManager } = dependencies;
    const { token, paramName, sessionKey, generationId, masterAccountId, menuChatId, menuMsgId } = context;
    const newValue = msg.text?.trim();
    if (!sessionKey || !pendingTweaks[sessionKey]) {
        await bot.sendMessage(msg.chat.id, 'Session expired.', { reply_to_message_id: msg.message_id });
        return;
    }
    pendingTweaks[sessionKey][paramName] = newValue;

    // Delete the instruction prompt (reply_to_message) and clear context
    if (msg.reply_to_message) {
        try { await bot.deleteMessage(msg.chat.id, msg.reply_to_message.message_id); } catch(e){ logger?.warn('Failed to delete prompt:', e.message);} 
    }
    replyContextManager.removeContext(msg.reply_to_message);

    // Rebuild menu with Send button
    const toolDisplayName = pendingTweaks[sessionKey].toolDisplayName;
    const toolDef = dependencies.toolRegistry.findByDisplayName(toolDisplayName);
    const tweakMenu = buildTweakUIMenu(generationId, masterAccountId, pendingTweaks[sessionKey], toolDef, true, dependencies);

    if (menuChatId && menuMsgId) {
        try {
            await bot.editMessageReplyMarkup(tweakMenu.reply_markup, { chat_id: menuChatId, message_id: menuMsgId });
        } catch (e) {
            logger.error('[TweakManager] failed to refresh menu:', e.message);
        }
    }
} 