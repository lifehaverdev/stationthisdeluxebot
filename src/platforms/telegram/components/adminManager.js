/**
 * @file adminManager.js
 * @description Handles admin-only commands and callbacks.
 */

const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

function registerHandlers(dispatchers, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher } = dispatchers;
    const { logger, bot, internalApiClient } = dependencies;

    const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '5472638766';

    // Command to clear chat-specific commands
    commandDispatcher.register(/^\/clear_my_chat_commands(?:@\w+)?/i, async (message, match) => {
        const chatId = message.chat.id;
        const userId = message.from.id.toString();

        if (userId !== ADMIN_TELEGRAM_ID) {
            return bot.sendMessage(chatId, "This command is for admins only.");
        }

        try {
            logger.info(`[AdminManager] Attempting to clear commands for chat_id: ${chatId}`);
            await bot.setMyCommands([], { scope: { type: 'chat', chat_id: chatId } });
            logger.info(`[AdminManager] Successfully cleared commands for chat_id: ${chatId}`);
            bot.sendMessage(chatId, "Your chat-specific command list has been cleared.", { reply_to_message_id: message.message_id });
        } catch (error) {
            logger.error(`[AdminManager] Failed to clear commands for chat_id: ${chatId}`, error);
            bot.sendMessage(chatId, `Failed to clear your chat-specific commands: ${error.message}`, { reply_to_message_id: message.message_id });
        }
    });

    // Handler for all admin:mod:* callbacks
    const handleAdminModCallback = async (bot, callbackQuery, masterAccountId, deps) => {
        const callbackUserIdStr = callbackQuery.from.id.toString();
        
        if (callbackUserIdStr !== ADMIN_TELEGRAM_ID) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "🚫 This action is for admins only.", show_alert: true });
            return;
        }

        const { data, message } = callbackQuery;
        const parts = data.split(':');
        const action = parts[0]; // e.g., 'admin_mod_approve'
        const loraIdentifier = parts[1];

        let apiEndpoint = '';
        let successMessage = '';
        let failureMessage = '';

        if (action === 'admin_mod_approve') {
          apiEndpoint = `/loras/${loraIdentifier}/admin-approve`;
          successMessage = '✅ Mod Approved & Deployment Initiated';
          failureMessage = '⚠️ Error approving Mod';
        } else if (action === 'admin_mod_reject') {
          apiEndpoint = `/loras/${loraIdentifier}/admin-reject`;
          successMessage = '❌ Mod Rejected';
          failureMessage = '⚠️ Error rejecting Mod';
        } else if (action === 'admin_mod_approve_private') {
           apiEndpoint = `/loras/${loraIdentifier}/admin-approve-private`;
           successMessage = '🔒 Mod Approved Privately';
           failureMessage = '⚠️ Error privately approving Mod';
        } else {
            logger.warn(`[AdminManager] Unknown admin mod action: ${action}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Unknown admin action.", show_alert: true });
            return;
        }

        try {
            logger.info(`[AdminManager] Calling internal API: POST ${apiEndpoint}`);
            const response = await internalApiClient.post(apiEndpoint, {});

            if (response.status === 200 || response.status === 202) {
                await bot.editMessageText(
                    escapeMarkdownV2(message.text + `\n\n---\n*Action Taken: ${successMessage}*`),
                    { chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'MarkdownV2', reply_markup: null }
                );
                await bot.answerCallbackQuery(callbackQuery.id, { text: response.data.message || successMessage });
            } else {
                const errorDetail = response.data?.details || response.data?.error || 'Unknown API error';
                logger.error(`[AdminManager] API call failed for ${loraIdentifier}. Status: ${response.status}, Error: ${errorDetail}`);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `${failureMessage}: ${errorDetail}`, show_alert: true });
            }
        } catch (error) {
            const errorDetail = error.response?.data?.details || error.response?.data?.error || error.message;
            logger.error(`[AdminManager] Error in admin action for ${loraIdentifier} (${action}):`, errorDetail, error.stack);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `${failureMessage}. Details: ${errorDetail}`, show_alert: true });
        }
    };
    
    callbackQueryDispatcher.register('admin_mod_approve:', handleAdminModCallback);
    callbackQueryDispatcher.register('admin_mod_reject:', handleAdminModCallback);
    callbackQueryDispatcher.register('admin_mod_approve_private:', handleAdminModCallback);
}

module.exports = {
    registerHandlers,
}; 