/**
 * @file infoManager.js
 * @description Handles callbacks for viewing generation and spell info.
 */

const { escapeMarkdownV2 } = require('../../../../utils/stringUtils');

async function handleViewGenInfoCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal, toolRegistry } = dependencies;
    const { data, message } = callbackQuery;
    
    const parts = data.split(':');
    const generationId = parts[1];
    logger.info(`[InfoManager] view_gen_info callback for generationId: ${generationId}`);

    try {
        const response = await internal.client.get(`/internal/v1/data/generations/${generationId}`);
        const generationRecord = response.data;

        if (!generationRecord) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Generation info not found.", show_alert: true });
            return;
        }

        // Handle Spells
        if (generationRecord.metadata?.isSpell && Array.isArray(generationRecord.metadata?.stepGenerationIds)) {
            logger.info(`[InfoManager] Generation ${generationId} is a spell. Displaying spell info view.`);
            
            const spellName = generationRecord.metadata.spellName || 'Unnamed Spell';
            const userInput = generationRecord.metadata.userInputPrompt || 'No initial prompt.';
            
            let text = `*Spell: ${escapeMarkdownV2(spellName)}*\\n\\n`;
            if (userInput) {
              text += `*Initial Input:*\n\`\`\`\n${escapeMarkdownV2(userInput)}\n\`\`\``;
            }

            const stepPromises = generationRecord.metadata.stepGenerationIds.map(stepGenId => 
              internal.client.get(`/internal/v1/data/generations/${stepGenId}`).catch(e => {
                logger.error(`[InfoManager] Failed to fetch step generation ${stepGenId} for spell view.`, e);
                return null;
              })
            );
            const stepResponses = await Promise.all(stepPromises);

            const stepButtons = stepResponses.map((stepResponse, index) => {
              if (stepResponse && stepResponse.data) {
                const stepGen = stepResponse.data;
                const toolDef = toolRegistry.getToolById(stepGen.metadata?.toolId);
                const toolDisplayName = toolDef?.displayName || stepGen.metadata?.toolId || 'Unknown Tool';
                return { text: `Step ${index + 1}: ${toolDisplayName}`, callback_data: `view_spell_step:${generationId}:${index}` };
              }
              return { text: `Step ${index + 1}: (Error)`, callback_data: 'no_op' };
            });
            
            const keyboard = [];
            for (let i = 0; i < stepButtons.length; i += 2) keyboard.push(stepButtons.slice(i, i + 2));
            keyboard.push([{ text: '⬅️ Back to Delivery', callback_data: `restore_delivery:${generationId}` }]);

            if (callbackQuery.message.photo || callbackQuery.message.animation) {
                await bot.deleteMessage(message.chat.id, message.message_id);
                const replyToId = generationRecord.metadata?.notificationContext?.replyToMessageId || message.reply_to_message?.message_id;
                await bot.sendMessage(message.chat.id, text, { parse_mode: 'MarkdownV2', reply_to_message_id: replyToId, reply_markup: { inline_keyboard: keyboard } });
            } else {
                await bot.editMessageText(text, { chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
            }

            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // Handle Regular Generations
        let infoMessage = `*Generation Info*\\n`;
        const toolId = generationRecord.metadata?.toolId || generationRecord.requestPayload?.invoked_tool_id || generationRecord.requestPayload?.tool_id || generationRecord.serviceName;
        const toolDef = toolRegistry.getToolById(toolId);
        const toolDisplayName = toolDef?.displayName || toolId;

        infoMessage += `Tool: \`${escapeMarkdownV2(String(toolDisplayName))}\`\\n`;

        if (generationRecord.requestPayload) {
            infoMessage += `\\n*Parameters Used:*\\n`;
            for (const [key, value] of Object.entries(generationRecord.requestPayload)) {
                if (key === 'invoked_tool_id' || key === 'tool_id') continue;
                
                let displayKey = key.startsWith('input_') ? key.substring(6) : key;
                const valueToShow = (key === 'input_prompt' && generationRecord.metadata?.userInputPrompt) ? generationRecord.metadata.userInputPrompt : value;
                const displayValue = typeof valueToShow === 'object' ? JSON.stringify(valueToShow) : String(valueToShow);

                infoMessage += `  • *${escapeMarkdownV2(displayKey)}*: \`${escapeMarkdownV2(displayValue)}\`\\n`;
            }
        }
        
        await bot.sendMessage(message.chat.id, infoMessage.trim(), { parse_mode: 'MarkdownV2', reply_to_message_id: message.message_id });
        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        logger.error(`[InfoManager] Error fetching info for ${generationId}:`, error.stack);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch generation info.", show_alert: true });
    }
}

async function handleViewSpellStepCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal, toolRegistry } = dependencies;
    const { data, message } = callbackQuery;

    const [, spellGenId, stepIndexStr] = data.split(':');
    const stepIndex = parseInt(stepIndexStr, 10);
    logger.info(`[InfoManager] view_spell_step callback for spell ${spellGenId}, step index ${stepIndex}`);

    try {
        const spellGenResponse = await internal.client.get(`/internal/v1/data/generations/${spellGenId}`);
        const spellGen = spellGenResponse.data;
        if (!spellGen || !spellGen.metadata?.stepGenerationIds) {
            throw new Error("Spell info not found.");
        }

        const stepGenId = spellGen.metadata.stepGenerationIds[stepIndex];
        if (!stepGenId) {
            throw new Error("Spell step info not found.");
        }

        const stepGenResponse = await internal.client.get(`/internal/v1/data/generations/${stepGenId}`);
        const stepGen = stepGenResponse.data;

        let infoCaption = `*Spell: ${escapeMarkdownV2(spellGen.metadata.spellName)}* \\| *Step ${stepIndex + 1}*\\n`;
        const toolDef = toolRegistry.getToolById(stepGen.metadata?.toolId);
        const toolDisplayName = toolDef?.displayName || stepGen.metadata?.toolId || 'Unknown Tool';
        infoCaption += `Tool: \`${escapeMarkdownV2(toolDisplayName)}\`\\n`;

        const buildParamsString = (params) => {
            let text = '';
            if (!params) return text;
            for (const [key, value] of Object.entries(params)) {
                if (['invoked_tool_id', 'tool_id', 'input_image', 'image', 'images', 'animations', 'videos'].includes(key)) continue;
                let displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                if (typeof displayValue === 'string' && (displayValue.startsWith('http://') || displayValue.startsWith('https://'))) continue;
                let displayKey = key.startsWith('input_') ? key.substring(6) : key;
                text += `  • *${escapeMarkdownV2(displayKey)}*: \`${escapeMarkdownV2(displayValue)}\`\\n`;
            }
            return text;
        };
        
        let paramsText = '';
        if (stepGen.requestPayload) {
            paramsText += `\\n*Inputs:*\\n` + buildParamsString(stepGen.requestPayload);
        }
        if (stepGen.responsePayload?.[0]?.data) {
            paramsText += `\\n*Outputs:*\\n` + buildParamsString(stepGen.responsePayload[0].data);
        }
        
        infoCaption += paramsText;

        const keyboard = [[{ text: '⬅️ Back to Spell', callback_data: `view_gen_info:${spellGenId}` }]];
        
        let mediaUrl, isAnimation = false;
        const stepOutput = stepGen.responsePayload?.[0];
        if (stepOutput?.data) {
            if (stepOutput.data.images?.[0]?.url) mediaUrl = stepOutput.data.images[0].url;
            else if (stepOutput.data.animations?.[0]?.url) { mediaUrl = stepOutput.data.animations[0].url; isAnimation = true; }
            else if (stepOutput.data.videos?.[0]?.url) { mediaUrl = stepOutput.data.videos[0].url; isAnimation = true; }
        }

        await bot.deleteMessage(message.chat.id, message.message_id);
        const replyToId = spellGen.metadata?.notificationContext?.replyToMessageId || message.reply_to_message?.message_id;

        if (mediaUrl) {
            const sendAction = isAnimation ? bot.sendAnimation.bind(bot) : bot.sendPhoto.bind(bot);
            await sendAction(message.chat.id, mediaUrl, {
                caption: infoCaption.trim(),
                parse_mode: 'MarkdownV2',
                reply_to_message_id: replyToId,
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await bot.sendMessage(message.chat.id, infoCaption.trim(), {
                parse_mode: 'MarkdownV2',
                reply_to_message_id: replyToId,
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        logger.error(`[InfoManager] Error in view_spell_step for spell ${spellGenId}:`, error.stack);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch step info.", show_alert: true });
    }
}

async function handleRestoreDeliveryCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal } = dependencies;
    const { data, message } = callbackQuery;

    const generationId = data.split(':')[1];
    logger.info(`[InfoManager] restore_delivery callback for generationId: ${generationId}`);

    try {
        const response = await internal.client.get(`/internal/v1/data/generations/${generationId}`);
        const generationRecord = response.data;
        if (!generationRecord) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Delivery info not found.", show_alert: true });
            return;
        }

        const chatId = message.chat.id;
        const msgId = message.message_id;
        const replyToId = generationRecord.metadata?.notificationContext?.replyToMessageId;

        const options = {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: replyToId,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '😻', callback_data: `rate_gen:${generationId}:beautiful` },
                        { text: '😹', callback_data: `rate_gen:${generationId}:funny` },
                        { text: '😿', callback_data: `rate_gen:${generationId}:negative` }
                    ],
                    [
                        { text: '-', callback_data: 'hide_menu' },
                        { text: 'ℹ︎', callback_data: `view_gen_info:${generationId}` },
                        { text: '✎', callback_data: `tweak_gen:${generationId}` },
                        { text: (generationRecord.metadata?.rerunCount || 0) > 0 ? `↻${generationRecord.metadata.rerunCount}` : '↻', callback_data: `rerun_gen:${generationId}` }
                    ]
                ]
            }
        };

        let imageUrl, animationUrl, textOutput;
        const firstOutput = generationRecord.responsePayload?.[0];
        if (firstOutput?.data) {
            if (firstOutput.data.text) textOutput = firstOutput.data.text;
            if (firstOutput.data.images?.[0]?.url) imageUrl = firstOutput.data.images[0].url;
            else if (firstOutput.data.animations?.[0]?.url) animationUrl = firstOutput.data.animations[0].url;
            else if (firstOutput.data.videos?.[0]?.url) animationUrl = firstOutput.data.videos[0].url;
        }

        await bot.deleteMessage(chatId, msgId);

        if (imageUrl) {
            await bot.sendPhoto(chatId, imageUrl, { caption: textOutput || '', ...options });
        } else if (animationUrl) {
            await bot.sendAnimation(chatId, animationUrl, { caption: textOutput || '', ...options });
        } else {
            const finalMessageText = textOutput || '✅ Generation completed.';
            await bot.sendMessage(chatId, finalMessageText, { ...options });
        }
        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        logger.error(`[InfoManager] Error in restore_delivery for ${generationId}:`, error.stack);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't restore delivery.", show_alert: true });
    }
}


function registerHandlers(dispatchers, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        throw new Error('[InfoManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;

    const { callbackQueryDispatcher } = dispatchers;
    const { logger } = dependencies;

    callbackQueryDispatcher.register('view_gen_info:', handleViewGenInfoCallback);
    
    // Stubs for spell-related callbacks generated by this handler
    callbackQueryDispatcher.register('view_spell_step:', handleViewSpellStepCallback);
    callbackQueryDispatcher.register('restore_delivery:', handleRestoreDeliveryCallback);
    
    logger.info('[InfoManager] Handlers registered for info callbacks.');
}

module.exports = {
    registerHandlers,
}; 