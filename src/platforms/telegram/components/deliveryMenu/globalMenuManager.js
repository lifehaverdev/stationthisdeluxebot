/**
 * @file globalMenuManager.js
 * @description Handles global menu actions that don't fit into other categories.
 */

/**
 * Handles the 'hide_menu' callback to remove the inline keyboard from a message.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The master account ID of the user.
 * @param {object} dependencies - Shared dependencies.
 */
async function handleHideMenuCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const { message } = callbackQuery;

    logger.info(`[GlobalMenuManager] hide_menu callback received for messageId: ${message.message_id} in chatId: ${message.chat.id}`);
    
    try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: message.chat.id, message_id: message.message_id });
        await bot.answerCallbackQuery(callbackQuery.id, { text: "🤫🫡" });
    } catch (error) {
        logger.error(`[GlobalMenuManager] Error hiding menu for messageId: ${message.message_id}:`, error.message);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't hide menu.", show_alert: true });
    }
}


function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger } = dependencies;

    callbackQueryDispatcher.register('hide_menu', handleHideMenuCallback);

    logger.debug('[GlobalMenuManager] Handlers registered for global callbacks.');
}

module.exports = {
    registerHandlers,
}; 