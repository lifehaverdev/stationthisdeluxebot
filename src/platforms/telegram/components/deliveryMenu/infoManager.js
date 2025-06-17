/**
 * @file infoManager.js
 * @description Handles callbacks for viewing generation and spell info.
 */

const { escapeMarkdownV2 } = require('../../../../utils/stringUtils');

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger, internalApiClient, toolRegistry, bot } = dependencies;

    // --- Handler for view_gen_info: ---
    callbackQueryDispatcher.register('view_gen_info:', async (bot, callbackQuery, masterAccountId, deps) => {
        const { data, message } = callbackQuery;
        const generationId = data.split(':')[1];
        logger.info(`[InfoManager] view_gen_info for genId: ${generationId}`);

        try {
            const response = await internalApiClient.get(`/generations/${generationId}`);
            const generationRecord = response.data;
            if (!generationRecord) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Generation info not found.", show_alert: true });
                return;
            }

            // If it's a spell, redirect to the spell step viewer logic
            if (generationRecord.metadata?.isSpell) {
                await viewSpellInfo(bot, callbackQuery, generationId, generationRecord, deps);
                return;
            }

            let infoMessage = `*Generation Info*\\n`;
            let toolId = generationRecord.metadata?.toolId || generationRecord.requestPayload?.invoked_tool_id || generationRecord.requestPayload?.tool_id || generationRecord.serviceName;
            
            const tool = toolRegistry.getToolById(toolId);
            let toolDisplayName = tool?.displayName || toolId;
            infoMessage += `Tool: \`${escapeMarkdownV2(String(toolDisplayName))}\`\\n`;

            if (generationRecord.requestPayload) {
                infoMessage += `\\n*Parameters Used:*\\n`;
                const promptInputKey = tool?.metadata?.telegramPromptInputKey;

                for (const [key, value] of Object.entries(generationRecord.requestPayload)) {
                    if (['invoked_tool_id', 'tool_id'].includes(key)) continue;
                    let displayKey = key.replace('input_', '');
                    
                    let valueToShow = value;
                    
                    const isPromptField = promptInputKey 
                        ? key === promptInputKey 
                        : key.toLowerCase().includes('prompt');
                    
                    if (isPromptField && generationRecord.metadata?.rawPrompt) {
                        valueToShow = generationRecord.metadata.rawPrompt;
                    }

                    infoMessage += `  • *${escapeMarkdownV2(displayKey)}*: \`${escapeMarkdownV2(String(valueToShow))}\`\\n`;
                }
            }

            await bot.sendMessage(message.chat.id, infoMessage.trim(), { parse_mode: 'MarkdownV2', reply_to_message_id: message.message_id });
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            logger.error(`[InfoManager] Error fetching gen info for ${generationId}:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch generation info.", show_alert: true });
        }
    });
    
    // --- Logic for viewing spell info (called from view_gen_info) ---
    async function viewSpellInfo(bot, callbackQuery, spellGenId, spellGenRecord, deps) {
        const { message } = callbackQuery;
        logger.info(`[InfoManager] Displaying spell info view for genId: ${spellGenId}.`);
        
        const spellName = spellGenRecord.metadata.spellName || 'Unnamed Spell';
        const userInput = spellGenRecord.metadata.userInputPrompt || 'No initial prompt.';
        let text = `*Spell: ${escapeMarkdownV2(spellName)}*\n\n*Initial Input:*\n\`\`\`\n${escapeMarkdownV2(userInput)}\n\`\`\``;

        const stepGenIds = spellGenRecord.metadata.stepGenerationIds || [];
        const stepPromises = stepGenIds.map(id => internalApiClient.get(`/generations/${id}`).catch(e => null));
        const stepResponses = await Promise.all(stepPromises);

        const stepButtons = stepResponses.map((res, i) => {
            const toolDisplayName = res?.data?.metadata?.toolId ? (toolRegistry.getToolById(res.data.metadata.toolId)?.displayName || res.data.metadata.toolId) : 'Unknown Tool';
            return { text: `Step ${i + 1}: ${toolDisplayName}`, callback_data: `view_spell_step:${spellGenId}:${i}` };
        });
        
        const keyboard = [];
        for (let i = 0; i < stepButtons.length; i += 2) { keyboard.push(stepButtons.slice(i, i + 2)); }
        keyboard.push([{ text: '⬅️ Back to Delivery', callback_data: `restore_delivery:${spellGenId}` }]);

        if (message.photo || message.animation) {
            await bot.deleteMessage(message.chat.id, message.message_id);
            await bot.sendMessage(message.chat.id, text, { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
        } else {
            await bot.editMessageText(text, { chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
        }
        await bot.answerCallbackQuery(callbackQuery.id);
    }


    // --- Handler for view_spell_step: ---
    callbackQueryDispatcher.register('view_spell_step:', async (bot, callbackQuery, masterAccountId, deps) => {
         const { data, message } = callbackQuery;
         const [, spellGenId, stepIndexStr] = data.split(':');
         const stepIndex = parseInt(stepIndexStr, 10);
         logger.info(`[InfoManager] view_spell_step for spell ${spellGenId}, step ${stepIndex}`);

         try {
            const spellGenResponse = await internalApiClient.get(`/generations/${spellGenId}`);
            const stepGenId = spellGenResponse.data?.metadata?.stepGenerationIds?.[stepIndex];
            if (!stepGenId) throw new Error('Spell or step info not found.');

            const stepGenResponse = await internalApiClient.get(`/generations/${stepGenId}`);
            const stepGen = stepGenResponse.data;
            
            let infoCaption = `*Spell: ${escapeMarkdownV2(spellGenResponse.data.metadata.spellName)}* \\| *Step ${stepIndex + 1}*\\n`;
            infoCaption += `Tool: \`${escapeMarkdownV2(toolRegistry.getToolById(stepGen.metadata?.toolId)?.displayName || stepGen.metadata?.toolId)}\`\\n`;
            
            const keyboard = [[{ text: '⬅️ Back to Spell', callback_data: `view_gen_info:${spellGenId}` }]];
            
            const firstOutput = stepGen.responsePayload?.[0];
            let mediaUrl;
            if (firstOutput?.data?.images?.[0]?.url) mediaUrl = firstOutput.data.images[0].url;
            else if (firstOutput?.data?.animations?.[0]?.url) mediaUrl = firstOutput.data.animations[0].url;
            
            await bot.deleteMessage(message.chat.id, message.message_id);
            if (mediaUrl) {
                await bot.sendPhoto(message.chat.id, mediaUrl, { caption: infoCaption, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
            } else {
                await bot.sendMessage(message.chat.id, infoCaption, { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
            }
            await bot.answerCallbackQuery(callbackQuery.id);
         } catch(error) {
            logger.error(`[InfoManager] Error in view_spell_step for spell ${spellGenId}:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch step info.", show_alert: true });
         }
    });


    // --- Handler for restore_delivery: ---
    callbackQueryDispatcher.register('restore_delivery:', async (bot, callbackQuery, masterAccountId, deps) => {
        const { data, message } = callbackQuery;
        const generationId = data.split(':')[1];
        logger.info(`[InfoManager] restore_delivery for genId: ${generationId}`);
        try {
            const response = await internalApiClient.get(`/generations/${generationId}`);
            const genRecord = response.data;
            if (!genRecord) throw new Error('Generation record not found.');

            const replyToId = genRecord.metadata?.notificationContext?.replyToMessageId;
            const options = {
                parse_mode: 'MarkdownV2',
                reply_to_message_id: replyToId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '😻', callback_data: `rate_gen:${generationId}:beautiful` }, { text: '😹', callback_data: `rate_gen:${generationId}:funny` }, { text: '😿', callback_data: `rate_gen:${generationId}:negative` }],
                        [{ text: '-', callback_data: 'hide_menu'}, { text: 'ℹ︎', callback_data: `view_gen_info:${generationId}` }, { text: '✎', callback_data: `tweak_gen:${generationId}` }, { text: '↻', callback_data: `rerun_gen:${generationId}` }]
                    ]
                }
            };
            
            const firstOutput = genRecord.responsePayload?.[0];
            let imageUrl, animationUrl, textOutput;
            if (firstOutput?.data) {
                if (firstOutput.data.text) textOutput = firstOutput.data.text;
                if (firstOutput.data.images?.[0]?.url) imageUrl = firstOutput.data.images[0].url;
                else if (firstOutput.data.animations?.[0]?.url) animationUrl = firstOutput.data.animations[0].url;
            }

            await bot.deleteMessage(message.chat.id, message.message_id);

            if (imageUrl) {
                await bot.sendPhoto(message.chat.id, imageUrl, { caption: textOutput || '', ...options });
            } else if (animationUrl) {
                await bot.sendAnimation(message.chat.id, animationUrl, { caption: textOutput || '', ...options });
            } else {
                await bot.sendMessage(message.chat.id, textOutput || '✅ Generation completed.', options);
            }
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            logger.error(`[InfoManager] Error in restore_delivery for ${generationId}:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't restore delivery.", show_alert: true });
        }
    });
}

module.exports = {
    registerHandlers,
}; 