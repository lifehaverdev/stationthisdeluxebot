/**
 * @file globalMenuManager.js
 * @description Handles generic menu callbacks like hide, close, etc.
 */

function registerHandlers(dispatchers, dependencies) {
    const { callbackQueryDispatcher } = dispatchers;
    const { logger, bot } = dependencies;

    callbackQueryDispatcher.register('hide_menu', async (bot, callbackQuery, masterAccountId, deps) => {
        const { message } = callbackQuery;
        logger.info(`[GlobalMenuManager] hide_menu callback received for messageId: ${message.message_id} in chatId: ${message.chat.id}`);
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: message.chat.id, message_id: message.message_id });
          await bot.answerCallbackQuery(callbackQuery.id, { text: "🤫🫡" });
        } catch (error) {
          logger.error(`[GlobalMenuManager] Error hiding menu for messageId: ${message.message_id}:`, error.message);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't hide menu.", show_alert: true });
        }
    });
}

module.exports = {
    registerHandlers,
}; 