/**
 * @file tweakManager.js
 * @description Handles all logic related to tweaking generations.
 */
const { v4: uuidv4 } = require('uuid');
const { buildTweakUIMenu } = require('../settingsMenuManager.js');

const pendingTweaks = {};

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher, messageReplyDispatcher } = dispatchers;
    const { logger, internalApiClient, toolRegistry, userSettingsService, comfyuiService, workflowsService } = dependencies;
    const depsWithTweaks = { ...dependencies, pendingTweaks };

    callbackQueryDispatcher.register('tweak_gen:', async (bot, cbq, maid) => {
        const generationId = cbq.data.split(':')[1];
        try {
            const genRes = await internalApiClient.get(`/generations/${generationId}`);
            const genRec = genRes.data;
            const { toolId, telegramMessageId, telegramChatId, userInputPrompt } = genRec.metadata;
            const originalParams = genRec.requestPayload || {};
            if (!toolId || !telegramMessageId || !telegramChatId) throw new Error("Missing critical context.");

            const sessionKey = `${generationId}_${maid}`;
            pendingTweaks[sessionKey] = { ...originalParams, input_prompt: userInputPrompt || originalParams.input_prompt, __canonicalToolId__: toolId };

            const menu = await buildTweakUIMenu(maid, toolId, pendingTweaks[sessionKey], telegramMessageId, telegramChatId, generationId, depsWithTweaks);
            await bot.sendMessage(telegramChatId, menu.text, { parse_mode: 'MarkdownV2', reply_markup: menu.reply_markup, reply_to_message_id: telegramMessageId });
            await bot.answerCallbackQuery(cbq.id, { text: "Opening tweak menu..." });
        } catch (e) {
            logger.error(`[TweakManager] Error in tweak_gen for ${generationId}:`, e);
            await bot.answerCallbackQuery(cbq.id, { text: "Error initiating tweak mode.", show_alert: true });
        }
    });
    
    callbackQueryDispatcher.register('tweak_apply:', async (bot, cbq, maid) => {
        const generationId = cbq.data.split(':')[1];
        const sessionKey = `${generationId}_${maid}`;
        const finalParams = pendingTweaks[sessionKey];
        if (!finalParams) {
            await bot.editMessageText("Error: Your tweak session has expired.", { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id, reply_markup: null });
            await bot.answerCallbackQuery(cbq.id, { text: "Session expired.", show_alert: true });
            return;
        }
        
        try {
            const genRes = await internalApiClient.get(`/generations/${generationId}`);
            const originalRec = genRes.data;
            const toolId = originalRec.metadata?.toolId;
            if (!toolId) throw new Error("Original generation has no toolId in metadata.");
            
            const { telegramMessageId, telegramChatId, platformContext } = originalRec.metadata;
            const initiatingEventId = originalRec.metadata.initiatingEventId || uuidv4();

            const newGenPayload = {
                toolId,
                requestPayload: { ...finalParams },
                masterAccountId: maid,
                platform: 'telegram',
                metadata: {
                    telegramMessageId, telegramChatId, platformContext, toolId,
                    parentGenerationId: generationId,
                    isTweaked: true,
                    initiatingEventId,
                    userInputPrompt: finalParams.input_prompt,
                }
            };
            
            const newGenRes = await internalApiClient.post('/generations', newGenPayload);
            const newGenId = newGenRes.data._id;
            
            let deploymentId = originalRec.metadata?.deploymentId || toolId;
            if (deploymentId.startsWith('comfy-')) deploymentId = deploymentId.substring(6);

            const submissionResult = await comfyuiService.submitRequest({ deploymentId, inputs: finalParams });
            const run_id = submissionResult?.run_id;
            if (!run_id) throw new Error("ComfyUI submission failed.");

            await internalApiClient.put(`/generations/${newGenId}`, { "metadata.run_id": run_id, status: 'processing' });
            
            await bot.editMessageText("🚀 Your tweaked generation is on its way!", { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id, reply_markup: null });
            await bot.answerCallbackQuery(cbq.id, { text: "Tweaked generation sent!" });
            delete pendingTweaks[sessionKey];
        } catch(e) {
             logger.error(`[TweakManager] Error in tweak_apply for ${generationId}:`, e);
             await bot.answerCallbackQuery(cbq.id, { text: "Error applying tweaks.", show_alert: true });
        }
    });

    messageReplyDispatcher.register('tweak_param_edit', async (bot, message, context, deps) => {
        const { generationId, masterAccountId, canonicalToolId, paramName } = context;
        const sessionKey = `${generationId}_${masterAccountId}`;
        const currentTweaks = pendingTweaks[sessionKey];
        if (!currentTweaks) {
            await bot.sendMessage(message.chat.id, "Error: Your tweak session has expired.", { reply_to_message_id: message.message_id });
            return;
        }
        
        // Basic validation placeholder
        currentTweaks[paramName] = message.text;
        
        await bot.deleteMessage(message.chat.id, message.message_id);

        const genRes = await internalApiClient.get(`/generations/${generationId}`);
        const { telegramMessageId, telegramChatId } = genRes.data.metadata;
        const refreshedMenu = await buildTweakUIMenu(masterAccountId, canonicalToolId, currentTweaks, telegramMessageId, telegramChatId, generationId, depsWithTweaks);
        
        await bot.editMessageText(refreshedMenu.text, { chat_id: message.reply_to_message.chat.id, message_id: message.reply_to_message.message_id, reply_markup: refreshedMenu.reply_markup, parse_mode: 'MarkdownV2' });
    });
}

module.exports = { registerHandlers }; 