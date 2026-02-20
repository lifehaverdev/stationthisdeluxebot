/**
 * @file rerunManager.js
 * @description Handles the callback for re-running a generation.
 */

const { ObjectId } = require('mongodb');

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

        // Get the tool's displayName and current configuration
        const { toolRegistry } = dependencies;
        if (!toolRegistry) {
            throw new Error('toolRegistry dependency is missing');
        }

        // Get the tool's displayName from the generation record
        const toolDisplayName = originalRecord.toolDisplayName;
        if (!toolDisplayName) {
            throw new Error('Generation record is missing toolDisplayName');
        }
        
        logger.info(`[RerunManager] Looking for tool with displayName: ${toolDisplayName}`);
        const currentTool = toolRegistry.findByDisplayName(toolDisplayName);
        
        if (!currentTool) {
            throw new Error(`Could not find current tool with displayName: ${toolDisplayName}`);
        }
        
        logger.info(`[RerunManager] Found current tool by displayName: ${currentTool.displayName}`);
        const toolId = currentTool.toolId;

        // Extract message and chat IDs from either direct metadata or platformContext
        const telegramMessageId = originalRecord.metadata.telegramMessageId || originalRecord.metadata.platformContext?.messageId;
        const telegramChatId = originalRecord.metadata.telegramChatId || originalRecord.metadata.platformContext?.chatId;
        const { platformContext, userInputPrompt } = originalRecord.metadata;

        if (!telegramMessageId || !telegramChatId) {
            const error = new Error("Critical context (messageId, chatId) missing from original generation.");
            error.originalRecord = originalRecord;
            throw error;
        }

        const newRequestPayload = { ...originalRecord.requestPayload, input_seed: Math.floor(Math.random() * 1000000000) };
        const userFacingPrompt = userInputPrompt || newRequestPayload.input_prompt;

        // Create metadata with notificationContext for proper reply chain
        const rerunMetadata = {
            telegramMessageId, telegramChatId, platformContext, toolId,
            parentGenerationId: originalGenerationId,
            isRerun: true,
            userInputPrompt: userFacingPrompt,
            rerunCount: (originalRecord.metadata?.rerunCount || 0) + 1,
            notificationContext: {
                chatId: telegramChatId,
                messageId: telegramMessageId,
                replyToMessageId: originalRecord.metadata.notificationContext?.replyToMessageId || telegramMessageId
            }
        };

        // Create an event record for this rerun action
        const eventResponse = await internal.client.post('/internal/v1/data/events', {
            masterAccountId,
            eventType: 'rerun_clicked',
            sourcePlatform: 'telegram',
            eventData: {
                originalGenerationId: originalGenerationId,
                toolId: currentTool.toolId,
                toolDisplayName: currentTool.displayName
            }
        });

        // Get user preferences first
        let inputs = { ...newRequestPayload };
        try {
            const encodedDisplayName = encodeURIComponent(currentTool.displayName);
            const preferencesResponse = await internal.client.get(`/internal/v1/data/users/${masterAccountId}/preferences/${encodedDisplayName}`);
            if (preferencesResponse.data && typeof preferencesResponse.data === 'object') {
                // Merge preferences with our inputs, but let our inputs take precedence
                inputs = { ...preferencesResponse.data, ...inputs };
            }
        } catch (error) {
            if (!error.response || error.response.status !== 404) {
                logger.warn(`[RerunManager] Could not fetch user preferences for '${currentTool.displayName}': ${error.message}`);
            }
        }

        // Construct execution payload similar to dynamicCommands.js
        const executionPayload = {
            toolId: currentTool.toolId,
            inputs,
            user: {
                masterAccountId,
                platform: 'telegram',
                platformId: callbackQuery.from.id.toString(),
                platformContext: {
                    firstName: callbackQuery.from.first_name,
                    username: callbackQuery.from.username,
                    chatId: message.chat.id,
                    messageId: message.message_id,
                },
            },
            eventId: eventResponse.data._id,
            metadata: {
                notificationContext: {
                    chatId: message.chat.id,
                    messageId: message.message_id,
                    replyToMessageId: message.message_id,
                    userId: callbackQuery.from.id,
                },
                parentGenerationId: originalGenerationId,
                isRerun: true,
                rerunCount: (originalRecord.metadata?.rerunCount || 0) + 1,
            }
        };

        // Execute via internal API
        const execResult = await internal.client.post('/internal/v1/data/execute', {
            ...executionPayload,
            toolDisplayName: currentTool.displayName // Ensure toolDisplayName is included
        });
        logger.info(`[RerunManager] Job submitted via execution service. Gen ID: ${execResult.data.generationId}`);
        
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
                response: error.response?.data,
                submissionResult: error.submissionResult,
                originalRecord: error.originalRecord,
                newRequestPayload: error.newRequestPayload
            } 
        }, `[RerunManager] Error in rerun_gen for GenID ${originalGenerationId}. Error: ${error.message}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Error rerunning generation.", show_alert: true });
    }
}

function registerHandlers(dispatchers, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        throw new Error('[RerunManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;

    const { callbackQueryDispatcher } = dispatchers;
    const { logger } = dependencies;

    callbackQueryDispatcher.register('rerun_gen:', handleRerunGenCallback);
    
    logger.debug('[RerunManager] Handler registered for "rerun_gen:" callbacks.');
}

module.exports = {
    registerHandlers,
}; 