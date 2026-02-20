/**
 * @file rerunManager.js
 * @description Handles the rerun button (↻) to re-execute a generation.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Handles the 'rerun_gen:' button interaction.
 * This is a complex operation that involves:
 * 1. Identifying the user who clicked.
 * 2. Fetching the original generation to rerun.
 * 3. Logging a new user session and a specific 'rerun' event.
 * 4. Creating a *new* generation record in the database, linked to the original.
 * 5. Dispatching the job to the generation service (e.g., ComfyUI).
 * 6. Updating the UI to reflect the rerun action.
 */
async function handleRerunGenCallback(client, interaction, masterAccountId, dependencies) {
    const { logger, internalApiClient } = dependencies;
    const { customId, message, user } = interaction;

    const parts = customId.split(':');
    const originalGenerationId = parts[1];
    const pressCount = parseInt(parts[2] || '0', 10);
    
    logger.info(`[RerunManager] rerun_gen interaction for GenID: ${originalGenerationId}, Press Count: ${pressCount}, from MAID: ${masterAccountId}`);

    try {
        const apiClient = internalApiClient || dependencies.internal?.client;
        if (!apiClient) {
            throw new Error('Internal API client not available');
        }

        const genResponse = await apiClient.get(`/internal/v1/data/generations/${originalGenerationId}`);
        const originalRecord = genResponse.data;

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

        // Extract Discord channel and message IDs from metadata
        const discordMessageId = originalRecord.metadata.discordMessageId || originalRecord.metadata.platformContext?.messageId;
        const discordChannelId = originalRecord.metadata.discordChannelId || originalRecord.metadata.platformContext?.channelId;
        const { platformContext, userInputPrompt } = originalRecord.metadata;

        // Use current interaction context if original context is missing
        const channelId = discordChannelId || interaction.channel.id;
        const messageId = discordMessageId || interaction.message.id;

        const newRequestPayload = { ...originalRecord.requestPayload };
        // Shuffle seed if it exists
        if (newRequestPayload.input_seed !== undefined) {
            newRequestPayload.input_seed = Math.floor(Math.random() * 1000000000);
        }
        const userFacingPrompt = userInputPrompt || newRequestPayload.input_prompt;

        // Create an event record for this rerun action
        const eventResponse = await apiClient.post('/internal/v1/data/events', {
            masterAccountId,
            eventType: 'rerun_clicked',
            sourcePlatform: 'discord',
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
            const preferencesResponse = await apiClient.get(`/internal/v1/data/users/${masterAccountId}/preferences/${encodedDisplayName}`);
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
                platform: 'discord',
                platformId: user.id.toString(),
                platformContext: {
                    username: user.username,
                    discriminator: user.discriminator,
                    globalName: user.globalName,
                    channelId: channelId,
                    messageId: messageId,
                },
            },
            eventId: eventResponse.data._id,
            metadata: {
                platform: 'discord',
                notificationContext: {
                    channelId: channelId,
                    messageId: messageId,
                    userId: user.id.toString(),
                },
                parentGenerationId: originalGenerationId,
                isRerun: true,
                rerunCount: (originalRecord.metadata?.rerunCount || 0) + 1,
            }
        };

        // Execute via internal API
        const execResult = await apiClient.post('/internal/v1/data/execute', {
            ...executionPayload,
            toolDisplayName: currentTool.displayName // Ensure toolDisplayName is included
        });
        logger.info(`[RerunManager] Job submitted via execution service. Gen ID: ${execResult.data.generationId}`);
        
        // Update the rerun button to show new press count
        const newPressCount = pressCount + 1;
        const newRerunCount = (originalRecord.metadata?.rerunCount || 0) + 1;
        
        // Find and update the rerun button in the message components
        // Need to rebuild components as ActionRowBuilder/ButtonBuilder instances
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const originalComponents = message.components || [];
        const newComponents = [];
        let buttonUpdated = false;
        
        for (const row of originalComponents) {
            const newRow = new ActionRowBuilder();
            let rowUpdated = false;
            
            for (const component of row.components) {
                if (component.customId && component.customId.startsWith(`rerun_gen:${originalGenerationId}`)) {
                    // Rebuild the button with updated label
                    const newButton = new ButtonBuilder()
                        .setCustomId(`rerun_gen:${originalGenerationId}:${newPressCount}`)
                        .setLabel(newRerunCount > 0 ? `↻${newRerunCount}` : '↻')
                        .setStyle(component.style || ButtonStyle.Secondary);
                    newRow.addComponents(newButton);
                    buttonUpdated = true;
                    rowUpdated = true;
                } else {
                    // Copy other buttons as-is
                    if (component.type === 2) { // Button component
                        const button = new ButtonBuilder()
                            .setCustomId(component.customId)
                            .setLabel(component.label || '')
                            .setStyle(component.style || ButtonStyle.Secondary);
                        if (component.emoji) button.setEmoji(component.emoji);
                        if (component.disabled !== undefined) button.setDisabled(component.disabled);
                        if (component.url) button.setURL(component.url);
                        newRow.addComponents(button);
                    }
                }
            }
            
            if (rowUpdated || newRow.components.length > 0) {
                newComponents.push(newRow);
            }
        }

        if (buttonUpdated && newComponents.length > 0) {
            await interaction.message.edit({
                components: newComponents
            });
        } else {
            logger.warn(`[RerunManager] Could not find rerun button on message to update press count.`);
        }

        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: 'Rerun initiated!',
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                content: 'Rerun initiated!',
                flags: 64 // Ephemeral
            });
        }

    } catch (error) {
        logger.error(`[RerunManager] Error in rerun_gen for GenID ${originalGenerationId}. Error: ${error.message}`, error.stack);
        try {
            // Check if interaction is already deferred/replied
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: 'Error rerunning generation.',
                    flags: 64 // Ephemeral
                });
            } else {
                await interaction.reply({
                    content: 'Error rerunning generation.',
                    flags: 64 // Ephemeral
                });
            }
        } catch (replyError) {
            logger.error(`[RerunManager] Failed to reply to interaction:`, replyError.message);
        }
    }
}

function registerHandlers(dispatchers, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        throw new Error('[RerunManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;

    const { buttonInteractionDispatcher } = dispatchers;
    const { logger } = dependencies;

    buttonInteractionDispatcher.register('rerun_gen:', handleRerunGenCallback);
    
    logger.debug('[RerunManager] Handler registered for "rerun_gen:" interactions.');
}

module.exports = {
    registerHandlers,
};

