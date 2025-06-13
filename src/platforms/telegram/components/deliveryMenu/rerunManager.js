/**
 * @file rerunManager.js
 * @description Handles the callback for re-running a generation.
 */

const { v4: uuidv4 } = require('uuid');

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger, internalApiClient, workflowsService, comfyuiService } = dependencies;

    callbackQueryDispatcher.register('rerun_gen:', async (bot, callbackQuery, masterAccountId, deps) => {
        const { data, message } = callbackQuery;
        const parts = data.split(':');
        const originalGenerationId = parts[1];
        const pressCount = parseInt(parts[2] || '0', 10);

        logger.info(`[RerunManager] rerun_gen for GenID: ${originalGenerationId}, MAID: ${masterAccountId}`);

        try {
            const genResponse = await internalApiClient.get(`/generations/${originalGenerationId}`);
            const originalRecord = genResponse.data;
            if (!originalRecord || !originalRecord.requestPayload) throw new Error("Original generation details missing.");

            const { toolId, telegramMessageId, telegramChatId, platformContext, userInputPrompt } = originalRecord.metadata;
            if (!toolId || !telegramMessageId || !telegramChatId) throw new Error("Critical context missing from original generation.");

            const newRequestPayload = { ...originalRecord.requestPayload, input_seed: Math.floor(Math.random() * 1000000000) };
            
            const rerunMetadata = {
                telegramMessageId, telegramChatId, platformContext, toolId,
                parentGenerationId: originalGenerationId,
                isRerun: true,
                initiatingEventId: originalRecord.metadata.initiatingEventId || uuidv4(),
                userInputPrompt: userInputPrompt || newRequestPayload.input_prompt,
                rerunCount: (originalRecord.metadata?.rerunCount || 0) + 1,
            };

            const newGenPayload = {
                toolId,
                requestPayload: newRequestPayload,
                masterAccountId,
                platform: 'telegram',
                metadata: rerunMetadata
            };

            const newGenResponse = await internalApiClient.post('/generations', newGenPayload);
            const newGeneratedId = newGenResponse.data._id;
            
            let deploymentId = originalRecord.metadata?.deploymentId || toolId;
            if (deploymentId.startsWith('comfy-')) deploymentId = deploymentId.substring(6);

            const submissionResult = await comfyuiService.submitRequest({ deploymentId, inputs: newRequestPayload });
            const run_id = submissionResult?.run_id;
            if (!run_id) throw new Error("ComfyUI submission failed for rerun.");

            await internalApiClient.put(`/generations/${newGeneratedId}`, { "metadata.run_id": run_id, status: 'processing' });
            
            // Update the keyboard to reflect the new press count
            const newPressCount = pressCount + 1;
            const newKeyboard = JSON.parse(JSON.stringify(message.reply_markup.inline_keyboard));
            // This is a simplified update, assumes a specific keyboard structure
            newKeyboard[1][3].text = `↻${newPressCount}`;
            newKeyboard[1][3].callback_data = `rerun_gen:${originalGenerationId}:${newPressCount}`;
            await bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, { chat_id: message.chat.id, message_id: message.message_id });

            await bot.answerCallbackQuery(callbackQuery.id, { text: "Rerun initiated!" });
        } catch (error) {
            logger.error(`[RerunManager] Error in rerun_gen for GenID ${originalGenerationId}:`, error.response?.data || error.message, error.stack);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error rerunning generation.", show_alert: true });
        }
    });
}

module.exports = {
    registerHandlers,
}; 