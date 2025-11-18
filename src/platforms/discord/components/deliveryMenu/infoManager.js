/**
 * @file infoManager.js
 * @description Handles the info button (ℹ︎) to display generation details.
 */

const { EmbedBuilder } = require('discord.js');

/**
 * Handles the 'view_gen_info:' button interaction to display generation details.
 * @param {object} client - The Discord client instance.
 * @param {object} interaction - The Discord button interaction.
 * @param {string} masterAccountId - The master account ID of the user.
 * @param {object} dependencies - Shared dependencies.
 */
async function handleViewGenInfoCallback(client, interaction, masterAccountId, dependencies) {
    const { logger, internalApiClient } = dependencies;
    const { customId } = interaction;
    const parts = customId.split(':');
    const generationId = parts[1];

    logger.info(`[InfoManager] view_gen_info interaction for generationId: ${generationId}, from MAID: ${masterAccountId}`);

    try {
        // Fetch generation record from internal API
        const apiClient = internalApiClient || dependencies.internal?.client;
        if (!apiClient) {
            throw new Error('Internal API client not available');
        }

        const genResponse = await apiClient.get(`/internal/v1/data/generations/${generationId}`);
        const generationRecord = genResponse.data;

        if (!generationRecord) {
            throw new Error('Generation record not found');
        }

        // Build embed with generation details
        const embed = new EmbedBuilder()
            .setTitle('ℹ︎ Generation Information')
            .setColor(0x0099FF);
        
        // Set timestamp only if valid date
        const timestampValue = generationRecord.createdAt || generationRecord.timestamp;
        if (timestampValue) {
            try {
                const timestampDate = new Date(timestampValue);
                if (!isNaN(timestampDate.getTime())) {
                    embed.setTimestamp(timestampDate);
                }
            } catch (e) {
                logger.warn(`[InfoManager] Invalid timestamp value: ${timestampValue}`);
            }
        }

        // Add tool information
        if (generationRecord.toolDisplayName) {
            embed.addFields({ name: 'Tool', value: generationRecord.toolDisplayName, inline: true });
        }
        if (generationRecord.toolId) {
            embed.addFields({ name: 'Tool ID', value: `\`${generationRecord.toolId}\``, inline: true });
        }

        // Add status
        if (generationRecord.status) {
            const statusEmoji = generationRecord.status === 'completed' ? '✅' : 
                               generationRecord.status === 'failed' ? '❌' : '⏳';
            embed.addFields({ name: 'Status', value: `${statusEmoji} ${generationRecord.status}`, inline: true });
        }

        // Add generation ID
        embed.addFields({ name: 'Generation ID', value: `\`${generationId}\``, inline: false });

        // Add cost information if available
        if (generationRecord.cost !== undefined) {
            embed.addFields({ name: 'Cost', value: `${generationRecord.cost} points`, inline: true });
        }

        // Add rerun count if available
        if (generationRecord.metadata?.rerunCount) {
            embed.addFields({ name: 'Reruns', value: `${generationRecord.metadata.rerunCount}`, inline: true });
        }

        // Add parent generation ID if this is a rerun
        if (generationRecord.metadata?.parentGenerationId) {
            embed.addFields({ name: 'Parent Generation', value: `\`${generationRecord.metadata.parentGenerationId}\``, inline: false });
        }

        // Add key parameters (first few from requestPayload)
        if (generationRecord.requestPayload) {
            try {
                const params = Object.entries(generationRecord.requestPayload)
                    .filter(([key]) => !key.startsWith('__')) // Filter out internal params
                    .slice(0, 5)
                    .map(([key, value]) => {
                        // Handle different value types
                        let displayValue;
                        if (value === null || value === undefined) {
                            displayValue = 'null';
                        } else if (typeof value === 'object') {
                            displayValue = JSON.stringify(value).substring(0, 47);
                        } else {
                            displayValue = String(value);
                        }
                        
                        // Truncate if too long (Discord field value limit is 1024, but we'll be conservative)
                        if (displayValue.length > 50) {
                            displayValue = displayValue.substring(0, 47) + '...';
                        }
                        return `**${key}**: ${displayValue}`;
                    })
                    .join('\n');
                
                if (params && params.length > 0) {
                    // Discord field value limit is 1024 characters
                    const truncatedParams = params.length > 1000 ? params.substring(0, 997) + '...' : params;
                    embed.addFields({ name: 'Parameters', value: truncatedParams, inline: false });
                }
            } catch (paramsError) {
                logger.warn(`[InfoManager] Error formatting parameters: ${paramsError.message}`);
                // Continue without parameters field
            }
        }

        // Add footer with creation time
        if (generationRecord.createdAt) {
            embed.setFooter({ text: `Created at ${new Date(generationRecord.createdAt).toLocaleString()}` });
        }

        // Check if interaction is already deferred/replied (bot.js defers it)
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                embeds: [embed],
                flags: 64 // Ephemeral
            });
        } else {
            await interaction.reply({
                embeds: [embed],
                flags: 64 // Ephemeral
            });
        }

    } catch (error) {
        // Log full error details
        logger.error(`[InfoManager] Error fetching generation info for ${generationId}:`, {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
            response: error.response?.data,
            status: error.response?.status
        });
        
        const errorMessage = error.message || 'Unknown error occurred';
        const userFriendlyMessage = error.response?.status === 404 
            ? 'Generation record not found.'
            : `Failed to fetch generation information: ${errorMessage}`;
        
        try {
            // Check if interaction is already deferred/replied
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: userFriendlyMessage,
                    flags: 64 // Ephemeral
                });
            } else {
                await interaction.reply({
                    content: userFriendlyMessage,
                    flags: 64 // Ephemeral
                });
            }
        } catch (replyError) {
            logger.error(`[InfoManager] Failed to reply to interaction:`, replyError.message, replyError.stack);
        }
    }
}

function registerHandlers(dispatchers, dependencies) {
    const { buttonInteractionDispatcher } = dispatchers;
    const { logger } = dependencies;

    buttonInteractionDispatcher.register('view_gen_info:', handleViewGenInfoCallback);

    logger.info('[InfoManager] Handler registered for "view_gen_info:" interactions.');
}

module.exports = {
    registerHandlers,
};

