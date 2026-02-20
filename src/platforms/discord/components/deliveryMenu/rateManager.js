/**
 * @file rateManager.js
 * @description Handles rating-related button interactions for generations.
 */

function registerHandlers(dispatchers, dependencies) {
    const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
    if (!apiClient) {
        throw new Error('[RateManager] internalApiClient dependency missing');
    }
    if (!dependencies.internal) dependencies.internal = {};
    dependencies.internal.client = apiClient;
    const { buttonInteractionDispatcher } = dispatchers;
    const { logger } = dependencies;

    /**
     * Handles the 'rate_gen:' button interaction.
     * The masterAccountId is for the user who clicked the button, which is what we want for rating.
     */
    const handleRateGenCallback = async (client, interaction, masterAccountId) => {
        const { customId } = interaction;
        const parts = customId.split(':');
        const generationId = parts[1];
        const ratingType = parts[2];

        logger.info(`[RateManager] rate_gen interaction for generationId: ${generationId}, ratingType: ${ratingType}, from MAID: ${masterAccountId}`);

        try {
            // Call the internal API to add the rating using the correct endpoint
            await apiClient.post(`/internal/v1/data/generations/rate_gen/${generationId}`, {
                ratingType: ratingType,
                masterAccountId: masterAccountId,
            });
            
            let emoji = '😶😶😶';
            switch (ratingType) {
                case 'beautiful':
                    emoji = '😻😻😻';
                    break;
                case 'funny':
                    emoji = '😹😹😹';
                    break;
                case 'sad':
                case 'negative': // Handle legacy and new rating types
                    emoji = '😿😿😿';
                    break;
            }
            
            // Check if interaction is already deferred/replied (bot.js defers it)
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: emoji,
                    flags: 64 // Ephemeral
                });
            } else {
                await interaction.reply({
                    content: emoji,
                    flags: 64 // Ephemeral
                });
            }

        } catch (error) {
            logger.error(`[RateManager] Error rating generation ${generationId}:`, error.message, error.stack);
            try {
                // Check if interaction is already deferred/replied
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({
                        content: 'Failed to record rating. Please try again.',
                        flags: 64 // Ephemeral
                    });
                } else {
                    await interaction.reply({
                        content: 'Failed to record rating. Please try again.',
                        flags: 64 // Ephemeral
                    });
                }
            } catch (replyError) {
                logger.error(`[RateManager] Failed to reply to interaction:`, replyError.message);
            }
        }
    };

    buttonInteractionDispatcher.register('rate_gen:', handleRateGenCallback);

    logger.debug('[RateManager] Handler registered for "rate_gen:" interactions.');
}

module.exports = {
    registerHandlers,
};

