/**
 * @file rateManager.js
 * @description Handles rating-related callbacks for generations.
 */

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger, internal } = dependencies;

    /**
     * Handles the 'rate_gen:' callback.
     * The masterAccountId is for the user who clicked the button, which is what we want for rating.
     */
    const handleRateGenCallback = async (bot, callbackQuery, masterAccountId) => {
        const { data } = callbackQuery;
        const parts = data.split(':');
        const generationId = parts[1];
        const ratingType = parts[2];

        logger.info(`[RateManager] rate_gen callback for generationId: ${generationId}, ratingType: ${ratingType}, from MAID: ${masterAccountId}`);

        try {
          // Call the internal API to add the rating using the correct endpoint
          await internal.client.post(`/internal/v1/data/generations/rate_gen/${generationId}`, {
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
          await bot.answerCallbackQuery(callbackQuery.id, { text: emoji, show_alert: false });

        } catch (error) {
          const errorMessage = error.response?.data?.message || "Failed to update rating.";
          logger.error(`[RateManager] Error in rate_gen callback for generationId: ${generationId} (MAID: ${masterAccountId}):`, errorMessage, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Failed to update rating.", show_alert: true });
        }
    };

    // Register the handler for the specific 'rate_gen:' prefix.
    callbackQueryDispatcher.register('rate_gen:', handleRateGenCallback);
    
    logger.info('[RateManager] Handler registered for "rate_gen:" callbacks.');
}

module.exports = {
    registerHandlers,
}; 