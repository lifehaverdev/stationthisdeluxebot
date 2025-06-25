/**
 * @file rerunManager.js
 * @description Handles the callback for re-running a generation.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Handles the 'rerun_gen:' callback.
 * This is a complex operation that involves:
 * 1. Identifying the user who clicked.
 * 2. Fetching the original generation to rerun.
 * 3. Logging a new user session and a specific 'rerun' event.
 * 4. Creating a *new* generation record in the database, linked to the original.
 * 5. Dispatching the job to the generation service (e.g., ComfyUI).
 * 6. Updating the UI to reflect the rerun action.
 */
async function handleRerunGenCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal, services } = dependencies;
    const { data, message } = callbackQuery;

    const parts = data.split(':');
    const originalGenerationId = parts[1];
    const pressCount = parseInt(parts[2] || '0', 10);
    
    logger.info(`[RerunManager] rerun_gen callback for GenID: ${originalGenerationId}, Press Count: ${pressCount}, from MAID: ${masterAccountId}`);

    try {
        const genResponse = await internal.client.get(`/internal/v1/data/generations/${originalGenerationId}`);
        const originalRecord = genResponse.data;

        // Add logging to inspect the fetched record for easier debugging.
        logger.debug({ originalRecord }, '[RerunManager] Fetched original generation record for rerun.');

        if (!originalRecord || !originalRecord.requestPayload) {
            throw new Error("Original generation details or requestPayload are missing for rerun.");
        }

        // Critical Check: Ensure metadata exists before trying to destructure it.
        if (!originalRecord.metadata) {
            logger.error({ originalRecord }, "Original generation record is missing the 'metadata' object, which is required for a rerun.");
            throw new Error("Original generation record is missing the 'metadata' object.");
        }

        // Robustly resolve toolId
        const toolId = originalRecord.metadata?.toolId || originalRecord.requestPayload?.invoked_tool_id || originalRecord.requestPayload?.tool_id || originalRecord.serviceName;
        if (!toolId) {
            throw new Error('Could not resolve toolId for original generation.');
        }

        const { telegramMessageId, telegramChatId, platformContext, userInputPrompt } = originalRecord.metadata;
        if (!telegramMessageId || !telegramChatId) {
            throw new Error("Critical context (messageId, chatId) missing from original generation.");
        }

        const newRequestPayload = { ...originalRecord.requestPayload, input_seed: Math.floor(Math.random() * 1000000000) };
        const userFacingPrompt = userInputPrompt || newRequestPayload.input_prompt;

        const rerunMetadata = {
            telegramMessageId, telegramChatId, platformContext, toolId,
            parentGenerationId: originalGenerationId,
            isRerun: true,
            initiatingEventId: originalRecord.metadata.initiatingEventId || uuidv4(),
            userInputPrompt: userFacingPrompt,
            rerunCount: (originalRecord.metadata?.rerunCount || 0) + 1,
        };

        const newGenPayload = {
            toolId,
            requestPayload: newRequestPayload,
            masterAccountId,
            platform: 'telegram',
            status: 'pending',
            deliveryStatus: 'pending',
            notificationPlatform: 'telegram',
            serviceName: originalRecord.serviceName,
            metadata: rerunMetadata
        };

        const newGenResponse = await internal.client.post('/internal/v1/data/generations', newGenPayload);
        const newGeneratedId = newGenResponse.data._id;
        logger.info(`[RerunManager] New generation (rerun) logged with ID: ${newGeneratedId}`);
        
        let deploymentId = originalRecord.metadata?.deploymentId || toolId;
        if (deploymentId.startsWith('comfy-')) {
            deploymentId = deploymentId.substring(6);
        }

        const submissionResult = await services.comfyui.submitRequest({ deploymentId, inputs: newRequestPayload });
        const run_id = submissionResult?.run_id;
        if (!run_id) {
            throw new Error(`ComfyUI submission failed for rerun. Reason: ${submissionResult?.error || 'Unknown'}`);
        }
        logger.info(`[RerunManager] ComfyUI submission successful for new GenID ${newGeneratedId}. Run ID: ${run_id}`);
        
        await internal.client.put(`/internal/v1/data/generations/${newGeneratedId}`, { "metadata.run_id": run_id, status: 'processing' });
        
        const newPressCount = pressCount + 1;
        const newKeyboard = JSON.parse(JSON.stringify(message.reply_markup.inline_keyboard));
        
        let buttonUpdated = false;
        for (const row of newKeyboard) {
            for (const button of row) {
                if (button.callback_data.startsWith(`rerun_gen:${originalGenerationId}`)) {
                    button.text = `↻${newPressCount}`;
                    button.callback_data = `rerun_gen:${originalGenerationId}:${newPressCount}`;
                    buttonUpdated = true;
                    break;
                }
            }
            if (buttonUpdated) break;
        }

        if (buttonUpdated) {
            await bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, { chat_id: message.chat.id, message_id: message.message_id });
        } else {
            logger.warn(`[RerunManager] Could not find rerun button on message to update press count.`);
        }

        await bot.answerCallbackQuery(callbackQuery.id, { text: "Rerun initiated!" });

    } catch (error) {
        // Structured error logging for better diagnostics.
        logger.error({ 
            err: { 
                message: error.message, 
                stack: error.stack, 
                response: error.response?.data 
            } 
        }, `[RerunManager] Error in rerun_gen for GenID ${originalGenerationId}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Error rerunning generation.", show_alert: true });
    }
}

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger } = dependencies;

    callbackQueryDispatcher.register('rerun_gen:', handleRerunGenCallback);
    
    logger.info('[RerunManager] Handler registered for "rerun_gen:" callbacks.');
}

module.exports = {
    registerHandlers,
}; 