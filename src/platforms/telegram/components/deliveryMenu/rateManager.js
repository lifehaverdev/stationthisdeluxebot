/**
 * @file rateManager.js
 * @description Handles rating-related callbacks for generations.
 */

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger, internalApiClient } = dependencies;

    callbackQueryDispatcher.register('rate_gen:', async (bot, callbackQuery, masterAccountId, deps) => {
        const { data } = callbackQuery;
        const parts = data.split(':');
        const generationId = parts[1];
        const ratingType = parts[2];

        logger.info(`[RateManager] rate_gen callback for generationId: ${generationId}, ratingType: ${ratingType}, from MAID: ${masterAccountId}`);

        try {
          // The masterAccountId is already resolved by the dispatcher, so no need to find/create user again.
          
          await internalApiClient.rateGeneration(generationId, ratingType, masterAccountId);
          
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
          await bot.answerCallbackQuery(callbackQuery.id, { text: `${emoji}`, show_alert: false });
        } catch (error) {
          logger.error(`[RateManager] Error in rate_gen callback for generationId: ${generationId} (MAID: ${masterAccountId}):`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Failed to update rating.", show_alert: true });
        }
    });
}

module.exports = {
    registerHandlers,
}; 