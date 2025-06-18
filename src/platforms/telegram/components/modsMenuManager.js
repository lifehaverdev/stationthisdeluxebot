/**
 * Mod Menu Manager for Telegram
 * 
 * Handles the display and interaction logic for Mod-related menus.
 */

// Dependencies will be passed in by the main bot.js, typically including:
// bot, logger

const AVAILABLE_CHECKPOINTS = ['All', 'SDXL', 'SD1.5', 'FLUX']; // Example, could be dynamic
const VALID_CHECKPOINTS = ['SD1.5', 'SDXL', 'FLUX', 'SD3'];
const { ObjectId } = require('../../../core/services/db/BaseDB');
const { 
    sendEscapedMessage,
    editEscapedMessageText,
    editEscapedMessageCaption,
    editEscapedMessageMedia,
    sendPhotoWithEscapedCaption,
} = require('../utils/messaging');
const { stripHtml } = require('../../../utils/stringUtils');
 
// Map for shortening callback data to fit within Telegram's 64-byte limit
const FILTER_SHORTCODE_MAP = {
  'type_character': 'char',
  'type_style': 'style',
  'popular': 'pop',
  'recent': 'rec',
  'favorites': 'fav',
};
// Create reverse map for easy lookup
const FILTER_FROM_SHORTCODE_MAP = Object.fromEntries(Object.entries(FILTER_SHORTCODE_MAP).map(([key, value]) => [value, key]));

const ADMIN_ACTION_SHORTCODE_MAP = {
  'menu': 'm',
  'change_checkpoint_menu': 'ccm',
  'set_checkpoint': 'sc',
  'delete_confirm': 'delc',
  'delete_execute': 'dele',
  'grant_owner_permission': 'gop',
  'edit_nyi': 'nyi',
};
const ADMIN_ACTION_FROM_SHORTCODE_MAP = Object.fromEntries(Object.entries(ADMIN_ACTION_SHORTCODE_MAP).map(([key, value]) => [value, key]));

function getFilterShortcode(filterType) {
  return FILTER_SHORTCODE_MAP[filterType] || filterType;
}

function getFilterFromShortcode(shortcode) {
  return FILTER_FROM_SHORTCODE_MAP[shortcode] || shortcode;
}

// const MAX_LORAS_PER_PAGE = 5; // Default, can be overridden by API call

/**
 * Handles the /mods command.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} message - The incoming message object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies (logger, etc.).
 */
async function handleModsCommand(bot, msg, masterAccountId, dependencies) {
  const { logger } = dependencies;
  logger.info(`[ModsMenuManager] /mods command received from MAID: ${masterAccountId}`);
  await displayModsMainMenu(bot, msg, masterAccountId, dependencies, false);
}

/**
 * Handles callback queries for Mod menus.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 */
async function handleModsCallback(bot, callbackQuery, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const data = callbackQuery.data;
  const [action, ...params] = data.split(':');

  logger.info(`[ModsMenuManager] handleModsCallback received: ${data} from MAID: ${masterAccountId}`);

  try {
    if (action === 'mods') {
      const subAction = params[0];
      if (subAction === 'main_menu') {
        await displayModsMainMenu(bot, callbackQuery, masterAccountId, dependencies, true);
      } else if (subAction === 'category') {
        const [filterShortcode, checkpoint, pageStr] = params.slice(1);
        const page = parseInt(pageStr, 10) || 1;
        const filterType = getFilterFromShortcode(filterShortcode);
        await displayModsByFilterScreen(bot, callbackQuery, masterAccountId, dependencies, true, filterType, checkpoint, page);
      } else if (subAction === 'detail') {
        const [loraIdentifier, backFilterShortcode, backCheckpoint, backPageStr] = params.slice(1);
        const backPage = parseInt(backPageStr, 10) || 1;
        const backFilterType = getFilterFromShortcode(backFilterShortcode);
        await displayModDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifier, backFilterType, backCheckpoint, backPage);
      } else if (subAction === 'toggle_favorite') {
        // Updated structure: IS_FAVORITE_STATUS:LORA_MONGO_ID:BACK_FILTER_SHORTCODE:BACK_CHECKPOINT:BACK_PAGE
        const favoriteParams = params.slice(1);
        const [currentFavoriteStatusStr, loraMongoId, backFilterShortcode, backCheckpoint, backPageStr] = favoriteParams;
        const isCurrentlyFavorite = currentFavoriteStatusStr === 'true';
        const backPage = parseInt(backPageStr, 10) || 1;
        // We need the full filter type to refresh the detail screen, which in turn needs it for its own back button.
        const backFilterType = getFilterFromShortcode(backFilterShortcode);

        // The lora identifier for refresh is now the mongo ID, which the detail screen can handle.
        const loraIdentifierForRefresh = loraMongoId;

        logger.info(`[ModsMenuManager] Toggling favorite for Mod (ID: ${loraMongoId}), Current Status: ${isCurrentlyFavorite}, MAID: ${masterAccountId}`);

        if (!loraMongoId) {
            logger.error(`[ModsMenuManager] No loraMongoId found in toggle_favorite callback.`);
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Could not identify Mod for favorite action.', show_alert: true });
          return;
        }

        try {
          if (isCurrentlyFavorite) {
            await dependencies.internal.client.delete(`/internal/v1/data/loras/${loraMongoId}/favorite`, { data: { masterAccountId } });
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Removed from favorites 💔' });
          } else {
            await dependencies.internal.client.post(`/internal/v1/data/loras/${loraMongoId}/favorite`, { masterAccountId });
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Added to favorites! ❤️' });
          }
          // Refresh the detail screen, passing the same context back.
          await displayModDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifierForRefresh, backFilterType, backCheckpoint, backPage);
        } catch (favError) {
          logger.error(`[ModsMenuManager] Error toggling favorite for LoRA _id ${loraMongoId}:`, {
            errorMsg: favError.message, errorResponse: favError.response ? favError.response.data : null
          });
          if (!callbackQuery.answered) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error updating favorites.', show_alert: true });
          }
        }
        return;
      } else if (subAction === 'set_checkpoint_main') {
        // This was for a global checkpoint setting on main menu, which we are not using for now
        // Instead, checkpoint is per category view. If needed, can re-implement userSettingsService part.
        logger.warn('[ModsMenuManager] set_checkpoint_main action is deprecated.');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Filter by checkpoint within categories.' });
      } else if (subAction === 'nvm') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🙂‍↕️🤫' });
        await bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
        return;
      } else if (subAction === 'request_form') {
        logger.info(`[ModsMenuManager] Mod import form requested by MAID: ${masterAccountId}`);
        const chatId = callbackQuery.message.chat.id;
        const originalMenuMessageId = callbackQuery.message.message_id; // The message with the "Import Mod" button

        // Simplified promptMessage without inline backticks for example URLs
        const promptMessage = 
`Please reply to this message with the direct URL to the Mod model you want to import.

Supported sources: Civitai or Hugging Face
Supported model types: FLUX (FLUX1-dev, FLUX-schnell), SDXL, SD3, SD1.5.

Example URLs:
https://civitai.com/models/12345/my-awesome-mod
https://huggingface.co/user/my-mod-model

Send '/cancel' if you change your mind.`;

        // Edit the current message (which is the Mod menu) to become the prompt.
        try {
          const sentMessage = await bot.editMessageText(promptMessage, {
            chat_id: chatId,
            message_id: originalMenuMessageId,
            reply_markup: { 
              inline_keyboard: [[{ text: 'Cancel Import', callback_data: 'mods:cancel_import_prompt' }]]
            }
          });

          // Store context for the reply
          if (dependencies.replyContextManager) {
            const context = {
              type: 'mod_import_url',
              masterAccountId: masterAccountId,
              originalMenuMessageId: originalMenuMessageId
            };
            dependencies.replyContextManager.addContext(sentMessage, context);
            logger.info(`[ModsMenuManager] Stored reply context for 'mod_import_url' for MAID ${masterAccountId}.`);
          } else {
            logger.error('[ModsMenuManager] ReplyContextManager not found. Cannot set context for import URL reply.');
          }

          await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
          logger.error(`[ModsMenuManager] Error displaying Mod import prompt for MAID ${masterAccountId}:`, error);
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error opening Mod import form.', show_alert: true });
        }
        return;
      } else if (subAction === 'cancel_import_prompt') {
        logger.info(`[ModsMenuManager] Mod import prompt cancelled by MAID: ${masterAccountId}`);
        // Re-display the main Mod menu by editing the message that showed the prompt
        await displayModsMainMenu(bot, callbackQuery, masterAccountId, dependencies, true);
        // displayModsMainMenu will call answerCallbackQuery
        return;
      } else if (subAction === 'admin') {
        const adminActionShortcode = params[1];
        const adminAction = ADMIN_ACTION_FROM_SHORTCODE_MAP[adminActionShortcode];
        logger.info(`[ModsMenuManager] Processing admin action: ${adminAction} (shortcode: ${adminActionShortcode})`);

        if (adminAction === 'menu') {
            const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(2);
            await displayModAdminMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
        } else if (adminAction === 'grant_owner_permission') {
            const [loraId] = params.slice(2);
            try {
                await dependencies.internal.client.post(`/internal/v1/data/loras/${loraId}/grant-owner-access`);
                await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Owner permission granted!' });
            } catch(err) {
                const errorDetail = err.response?.data?.details || err.response?.data?.error || err.message;
                logger.error(`[ModsMenuManager] Error granting owner permission for lora ${loraId}`, err);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `Error: ${errorDetail}`, show_alert: true });
            }
        } else if (adminAction === 'change_checkpoint_menu') {
            const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(2);
            await displayChangeCheckpointMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
        } else if (adminAction === 'set_checkpoint') {
            const [loraId, newCheckpoint, backFilterShortcode, backCheckpoint, backPage] = params.slice(2);
            try {
                await dependencies.internal.client.post(`/internal/v1/data/loras/${loraId}/checkpoint`, { checkpoint: newCheckpoint });
                await bot.answerCallbackQuery(callbackQuery.id, { text: `Checkpoint updated to ${newCheckpoint}!` });
                await displayChangeCheckpointMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
            } catch(err) {
                const errorDetail = err.response?.data?.details || err.response?.data?.error || err.message;
                logger.error(`[ModsMenuManager] Error setting checkpoint for lora ${loraId}`, err);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `Error updating checkpoint: ${errorDetail}`, show_alert: true });
            }
        } else if (adminAction === 'delete_confirm') {
            const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(2);
            const loraResponse = await dependencies.internal.client.get(`/internal/v1/data/loras/${loraId}`, {
                params: { isAdmin: true }
            });
            const loraName = loraResponse.data?.lora?.name || 'Unknown Mod';
            const text = `Are you sure you want to permanently delete Mod: *${loraName}* (ID: \`${loraId}\`)?\n\nThis action cannot be undone.`;
            const keyboard = [[
                { text: '❌ Yes, Delete Permanently ❌', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.delete_execute}:${loraId}` },
                { text: 'Cancel', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.menu}:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }
            ]];
            await editEscapedMessageText(bot, text, {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: keyboard }
            });
            await bot.answerCallbackQuery(callbackQuery.id);
        } else if (adminAction === 'delete_execute') {
            const [loraId] = params.slice(2);
            try {
                await dependencies.internal.client.delete(`/internal/v1/data/loras/${loraId}`);
                await editEscapedMessageText(bot, `Mod with ID \`${loraId}\` has been deleted.`, {
                    chat_id: callbackQuery.message.chat.id,
                    message_id: callbackQuery.message.message_id,
                    reply_markup: { inline_keyboard: [[{text: 'Back to Main Menu', callback_data: 'mods:main_menu'}]] }
                });
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Mod Deleted!' });
            } catch(err) {
                const errorDetail = err.response?.data?.details || err.response?.data?.error || err.message;
                logger.error(`[ModsMenuManager] Error deleting lora ${loraId}`, err);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `Error deleting Mod: ${errorDetail}`, show_alert: true });
            }
        } else if (adminAction === 'edit_nyi') {
             await bot.answerCallbackQuery(callbackQuery.id, { text: 'Edit functionality is not yet implemented.', show_alert: true });
        } else {
            logger.warn(`[ModsMenuManager] Unknown admin action shortcode: ${adminActionShortcode}`);
            await bot.answerCallbackQuery(callbackQuery.id);
        }
        return;
      } else if (subAction === 'admin_menu') {
        const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(1);
        await displayModAdminMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
        return;
      } else if (subAction === 'admin_grant_owner_permission') {
        const [loraId] = params.slice(1);
        try {
            await dependencies.internal.client.post(`/internal/v1/data/loras/${loraId}/grant-owner-access`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Owner permission granted!' });
        } catch(err) {
            const errorDetail = err.response?.data?.details || err.response?.data?.error || err.message;
            logger.error(`[ModsMenuManager] Error granting owner permission for lora ${loraId}`, err);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `Error: ${errorDetail}`, show_alert: true });
        }
        return;
      } else if (subAction === 'admin_change_checkpoint_menu') {
        const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(1);
        await displayChangeCheckpointMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
        return;
      } else if (subAction === 'admin_set_checkpoint') {
        const [loraId, newCheckpoint, backFilterShortcode, backCheckpoint, backPage] = params.slice(1);
        try {
            await dependencies.internal.client.post(`/internal/v1/data/loras/${loraId}/checkpoint`, { checkpoint: newCheckpoint });
            await bot.answerCallbackQuery(callbackQuery.id, { text: `Checkpoint updated to ${newCheckpoint}!` });
            // Refresh the change checkpoint menu to show the new state
            await displayChangeCheckpointMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
        } catch(err) {
            const errorDetail = err.response?.data?.details || err.response?.data?.error || err.message;
            logger.error(`[ModsMenuManager] Error setting checkpoint for lora ${loraId}`, err);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `Error updating checkpoint: ${errorDetail}`, show_alert: true });
        }
        return;
      } else if (subAction === 'admin_delete_confirm') {
        const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(1);
        const loraResponse = await dependencies.internal.client.get(`/internal/v1/data/loras/${loraId}`);
        const loraName = loraResponse.data?.lora?.name || 'Unknown Mod';
        const text = `Are you sure you want to permanently delete Mod: *${loraName}* (ID: \`${loraId}\`)?\n\nThis action cannot be undone.`;
        const keyboard = [[
            { text: '❌ Yes, Delete Permanently ❌', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.delete_execute}:${loraId}` },
            { text: 'Cancel', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.menu}:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }
        ]];
        await editEscapedMessageText(bot, text, {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      } else if (subAction === 'admin_delete_execute') {
        const [loraId] = params.slice(1);
        try {
            await dependencies.internal.client.delete(`/internal/v1/data/loras/${loraId}`);
            await editEscapedMessageText(bot, `Mod with ID \`${loraId}\` has been deleted.`, {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                reply_markup: { inline_keyboard: [[{text: 'Back to Main Menu', callback_data: 'mods:main_menu'}]] }
            });
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Mod Deleted!' });
        } catch(err) {
            const errorDetail = err.response?.data?.details || err.response?.data?.error || err.message;
            logger.error(`[ModsMenuManager] Error deleting lora ${loraId}`, err);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `Error deleting Mod: ${errorDetail}`, show_alert: true });
        }
        return;
      } else if (subAction === 'admin_edit_nyi') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Edit functionality is not yet implemented.', show_alert: true });
        return;
      } else {
        logger.warn(`[ModsMenuManager] Unknown mods subAction: ${subAction}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action.' });
      }
    } else if (action === 'mods_store') { // New action for Mod Store
      const subAction = params[0];
      if (subAction === 'main_menu') {
        // We will define this function next
        await displayModsStoreMainMenu(bot, callbackQuery, masterAccountId, dependencies, true); 
      } else if (subAction === 'category') {
        const [filterShortcode, checkpoint, pageStr] = params.slice(1);
        const page = parseInt(pageStr, 10) || 1;
        const filterType = getFilterFromShortcode(filterShortcode);
        await displayStoreModsByFilterScreen(bot, callbackQuery, masterAccountId, dependencies, true, filterType, checkpoint, page);
      } else if (subAction === 'my_listed') { // Placeholder for user's listed items
        const [checkpoint, pageStr] = params.slice(1);
        // await displayUserListedStoreLorasScreen(bot, callbackQuery, masterAccountId, dependencies, true, checkpoint, page);
        logger.info(`[ModsMenuManager] Placeholder for 'my_listed' Mods in store. MAID: ${masterAccountId}, CP: ${checkpoint}, Page: ${page}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Viewing your listed Mods (not implemented yet).' });
      } else if (subAction === 'my_purchases') { // Placeholder for user's purchases
        const [checkpoint, pageStr] = params.slice(1);
        // await displayUserPurchasedStoreLorasScreen(bot, callbackQuery, masterAccountId, dependencies, true, checkpoint, page);
        logger.info(`[ModsMenuManager] Placeholder for 'my_purchases' in store. MAID: ${masterAccountId}, CP: ${checkpoint}, Page: ${page}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Viewing your purchased Mods (not implemented yet).' });
      } else if (subAction === 'detail') {
        const [loraIdentifier, backFilterShortcode, backCheckpoint, backPageStr] = params.slice(1);
        const backPage = parseInt(backPageStr, 10) || 1;
        const backFilterType = getFilterFromShortcode(backFilterShortcode);
        await displayStoreModDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifier, backFilterType, backCheckpoint, backPage);
      } else if (subAction === 'purchase_confirm') { // Placeholder for purchase action
        const [loraIdentifier, price, backFilterShortcode, backCheckpoint, backPageStr] = params.slice(1);
        const backPage = parseInt(backPageStr, 10) || 1;
        const backFilterType = getFilterFromShortcode(backFilterShortcode);
        logger.info(`[ModsMenuManager] Placeholder for 'purchase_confirm' of Mod ${loraIdentifier} for ${price} points. MAID: ${masterAccountId}, backFilterType: ${backFilterType}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: `CONFIRM: Buy ${loraIdentifier} for ${price} points? (Not Implemented)`, show_alert: true });
        // Potentially, after this, we would call a function to show a final confirm/cancel message or proceed to purchase API
      } else {
        logger.warn(`[ModsMenuManager] Unknown mods_store subAction: ${subAction}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown store action.' });
      }
    } else {
      logger.warn(`[ModsMenuManager] Unknown action prefix: ${action}`);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown command.' });
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in handleModsCallback (data: ${data}):`, error);
    try {
      if (callbackQuery && !callbackQuery.answered) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error processing your request.', show_alert: true });
      }
    } catch (ackError) {
      logger.error('[ModsMenuManager] FATAL: Could not even acknowledge callback query after error:', ackError);
    }
  }
}

/**
 * Displays the main Mod categories menu.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} messageOrQuery - The incoming message or callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 * @param {boolean} isEdit - Whether to edit an existing message or send a new one.
 */
async function displayModsMainMenu(bot, messageOrQuery, masterAccountId, dependencies, isEdit = false) {
  const { logger } = dependencies;
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎭 Character', callback_data: `mods:category:${getFilterShortcode('type_character')}:All:1` },
          { text: '🖼 Style', callback_data: `mods:category:${getFilterShortcode('type_style')}:All:1` }
        ],
        [
          { text: '🔥 Popular', callback_data: `mods:category:${getFilterShortcode('popular')}:All:1` },
          { text: '⏳ Recent', callback_data: `mods:category:${getFilterShortcode('recent')}:All:1` }
        ],
        [
          { text: '🛍️ Mod Store', callback_data: 'mods_store:main_menu' },
          { text: '💖 Favorites', callback_data: `mods:category:${getFilterShortcode('favorites')}:All:1` }
        ],
        [{ text: '📝 Import Mod', callback_data: 'mods:request_form' }],
        [{ text: "Ⓧ", callback_data: 'mods:nvm' }]
      ]
    },
  };

  const menuMessage = 'Mod Categories \nSelect a category to explore:';

  try {
    if (isEdit) {
      const messageToEdit = messageOrQuery.message || messageOrQuery;
      await editEscapedMessageText(bot, menuMessage, {
        chat_id: messageToEdit.chat.id,
        message_id: messageToEdit.message_id,
        ...options
      });
      if (messageOrQuery.id && !messageOrQuery.answered) {
        await bot.answerCallbackQuery(messageOrQuery.id);
      }
    } else {
      await sendEscapedMessage(bot, messageOrQuery.chat.id, menuMessage, { ...options, reply_to_message_id: messageOrQuery.message_id });
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayModsMainMenu (MAID: ${masterAccountId}):`, error.response ? error.response.data : error.message, error.stack);
    if (isEdit && messageOrQuery.id && !messageOrQuery.answered) {
        await bot.answerCallbackQuery(messageOrQuery.id, {text: "Error showing Mod menu.", show_alert: true});
    } else if (!isEdit) {
        await sendEscapedMessage(bot, messageOrQuery.chat.id, "Sorry, couldn't open the Mod menu right now.");
    }
  }
}

/**
 * Displays Mods based on a filter type (category, popular, recent) and checkpoint.
 * @param {Object} bot
 * @param {Object} callbackQuery
 * @param {string} masterAccountId
 * @param {Object} dependencies
 * @param {boolean} isEdit
 * @param {string} filterType - e.g., 'type_meme', 'popular', 'recent'
 * @param {string} currentCheckpoint - e.g., 'All', 'SDXL', 'SD1.5'
 * @param {number} currentPage - e.g., 1
 */
async function displayModsByFilterScreen(bot, callbackQuery, masterAccountId, dependencies, isEdit, filterType, currentCheckpoint, currentPage) {
  const { logger } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  let messageId = callbackQuery.message.message_id; // Can be modified if we delete and resend

  // --- MODIFIED: Handle transition from photo detail view ---
  const originalMessageWasPhoto = callbackQuery.message.photo && callbackQuery.message.photo.length > 0;
  if (isEdit && originalMessageWasPhoto) {
    logger.debug(`[ModsMenuManager] displayModsByFilterScreen: Callback is from a photo message (ID: ${messageId}). Will attempt to edit it to text list, or send new if edit fails.`);
    // We won't delete. We'll try to edit. If edit fails, the main editMessageText later will fail,
    // and we'll proceed to sending a new message if that more robust error handling is in place.
    // For now, the existing editMessageText will be attempted. If it fails due to incompatible types,
    // the catch block for it should handle sending a new message.
  } 
  // --- END MODIFICATION ---

  // Sanitize/Beautify filterType for display
  let displayFilterName = filterType.replace(/^type_/, '');
  displayFilterName = displayFilterName.charAt(0).toUpperCase() + displayFilterName.slice(1);

  // Corrected title construction: Escape dynamic parts individually, build string.
  let title = `*${displayFilterName} Mods*`;
  if (currentCheckpoint !== 'All') {
    // Revert the diagnostic change and ensure parentheses are properly escaped
    title += ` (Checkpoint: ${currentCheckpoint})`;
  }

  const keyboard = [];
  const filterShortcode = getFilterShortcode(filterType);

  // Checkpoint filter buttons
  const checkpointButtons = AVAILABLE_CHECKPOINTS.map(cp => ({
    text: (cp === currentCheckpoint ? `✅ ${cp}` : cp),
    callback_data: `mods:category:${filterShortcode}:${cp}:1` // Reset to page 1 on checkpoint change
  })); 
  keyboard.push(checkpointButtons);

  let loraListText = `\n_Fetching Mods..._\n`;
  let totalPages = 1;

  const queryParams = new URLSearchParams({
    filterType: filterType,
    checkpoint: currentCheckpoint,
    page: currentPage.toString(),
    limit: '5', // Let's use a smaller limit for Telegram inline menus
    userId: masterAccountId // For potential permissioning/favorites in future API versions
  }).toString();

  try {
    logger.info(`[ModsMenuManager] Calling /internal/v1/data/loras/list with params: filterType=${filterType}&checkpoint=${currentCheckpoint}&page=${currentPage}&limit=5&userId=${masterAccountId}`);
    const response = await dependencies.internal.client.get('/internal/v1/data/loras/list', {
      params: {
        filterType: filterType,
        checkpoint: currentCheckpoint,
        page: currentPage,
        limit: 5,
        userId: masterAccountId
      }
    });
    const responseData = response.data; // Assuming response.data is the object { loras: [], pagination: {} }
    
    if (responseData && responseData.loras) {
      const fetchedLoras = responseData.loras;
      totalPages = responseData.pagination.totalPages || 1;
      title += ` - Page ${currentPage}/${totalPages}`;

      if (fetchedLoras.length > 0) {
        loraListText = '\n'; 
        fetchedLoras.forEach(lora => {
          // --- Request 3: Change LoRA Button Text ---
          let buttonDisplayName = '';
          if (lora.cognates && lora.cognates.length > 0 && lora.cognates[0] && typeof lora.cognates[0].word === 'string' && lora.cognates[0].word.trim() !== '') {
            buttonDisplayName = lora.cognates[0].word;
          } else if (lora.triggerWords && lora.triggerWords.length > 0 && typeof lora.triggerWords[0] === 'string' && lora.triggerWords[0].trim() !== '') {
            buttonDisplayName = lora.triggerWords[0];
          } else if (lora.name && typeof lora.name === 'string' && lora.name.trim() !== '') {
            buttonDisplayName = lora.name;
          } else {
            buttonDisplayName = lora.slug;
          }
          const escapedButtonText = buttonDisplayName;
          // --- End Request 3 ---
          
          // Using name for display, slug for callback
          // const displayName = escapeMarkdownV2(lora.name || lora.slug); // Old logic
          // Callback for detail: mods:detail:SLUG_OR_ID:filterType:checkpoint:page
          const detailCallback = `mods:detail:${lora._id}:${filterShortcode}:${currentCheckpoint}:${currentPage}`;
          keyboard.push([{ text: escapedButtonText, callback_data: detailCallback }]);
        });
      } else {
        loraListText = `\n_No Mods found matching your criteria._\n`;
      }
    } else {
      logger.warn('[ModsMenuManager] Invalid response structure from loras API:', responseData);
      loraListText = `\n_Error: Could not parse Mod list from server._\n`;
      if (!title.includes('Page ')) {
          title += ` - Page ${currentPage}/${totalPages}`;
      }
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Mods for ${filterType} (Checkpoint: ${currentCheckpoint}, Page: ${currentPage}):`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    loraListText = `\n_Sorry, there was an error fetching the Mods. Please try again later._\n`;
    if (!title.includes('Page ')) {
        title += ` - Page ${currentPage}/${totalPages}`;
    }
  }

  const navigationRow = [];
  if (currentPage > 1) {
    navigationRow.push({ text: "⇤", callback_data: `mods:category:${filterShortcode}:${currentCheckpoint}:${currentPage - 1}` });
  }
  navigationRow.push({ text: "⇱", callback_data: 'mods:main_menu' });
  if (currentPage < totalPages) { 
    navigationRow.push({ text: "⇥", callback_data: `mods:category:${filterShortcode}:${currentCheckpoint}:${currentPage + 1}` });
  }
  if (navigationRow.length > 0) {
      keyboard.push(navigationRow);
  }

  const fullMessage = `${title}${loraListText}`;
  logger.debug(`[ModsMenuManager] Full message for ${filterType} (before Telegram ops):\n${fullMessage}`);
  try {
    // If isEdit is true, try to edit. If originalMessageWasPhoto, this might fail if Telegram doesn't allow direct edit from photo to text.
    // If it fails, the catch block should ideally handle sending a new message.
    await editEscapedMessageText(bot, fullMessage, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayModsByFilterScreen (Filter: ${filterType}):`, error);
    // If editing failed (e.g. tried to edit a photo to text), send a new message with the category list.
    if (isEdit) {
        logger.info(`[ModsMenuManager] Editing failed for filter screen (Filter: ${filterType}), attempting to send as new message.`);
        try {
            await sendEscapedMessage(bot, chatId, fullMessage, {
                reply_markup: { inline_keyboard: keyboard },
            });
            if (callbackQuery && !callbackQuery.answered) await bot.answerCallbackQuery(callbackQuery.id);
            return; // Sent as new, so we are done.
        } catch (sendError) {
            logger.error(`[ModsMenuManager] Also failed to send filter screen as new message (Filter: ${filterType}):`, sendError);
        }
    }
    if (callbackQuery && !callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating Mod list.", show_alert: true});
    }
  }
}

/**
 * Displays the detailed screen for a single Mod.
 */
async function displayModDetailScreen(bot, callbackQuery, masterAccountId, dependencies, isEdit, loraIdentifier, backFilterType, backCheckpoint, backPage) {
  const { logger } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const originalMessageId = callbackQuery.message.message_id;

  let messageText = `*Mod Detail: ${loraIdentifier}*\n\n_Fetching details..._`;
  const keyboard = [];
  let photoUrl = null;
  const backFilterShortcode = getFilterShortcode(backFilterType);

  try {
    logger.info(`[ModsMenuManager] Calling /internal/v1/data/loras/${loraIdentifier}?userId=${masterAccountId}`);
    const response = await dependencies.internal.client.get(`/internal/v1/data/loras/${loraIdentifier}`, {
      params: { userId: masterAccountId }
    });
    const lora = response.data.lora;

    if (lora) {
      let tempName = lora.name || lora.slug;
      if (tempName.length > 64) tempName = tempName.substring(0, 61) + '...';
      messageText = `*${tempName}*\n`;

      if (lora.description) {
        const maxLength = 150;
        const cleanedDesc = stripHtml(lora.description); // Sanitize the description
        const desc = cleanedDesc.length > maxLength ? cleanedDesc.substring(0, maxLength) + '...' : cleanedDesc;
        messageText += `_${desc}_\n\n`;
      }

      messageText += `*Checkpoint:* ${lora.checkpoint || 'N/A'}\n`;

      if (lora.triggerWords && lora.triggerWords.length > 0) {
        let tempTriggers = lora.triggerWords.join(', ');
        if (tempTriggers.length > 100) tempTriggers = tempTriggers.substring(0, 97) + '...';
        messageText += `*Triggers:* \`${tempTriggers}\`\n`;
      }

      // Display cognates if they exist
      if (lora.cognates && lora.cognates.length > 0) {
        const cognateWords = lora.cognates.map(c => c.word).join(', ');
        if (cognateWords.length > 100) cognateWords = cognateWords.substring(0, 97) + '...';
        messageText += `*Shortcuts:* \`${cognateWords}\`\n`;
      }

      if (lora.tags && lora.tags.length > 0) {
        let tempTags = lora.tags.slice(0, 5).map(t => t.tag).join(', ');
        if (tempTags.length > 150) tempTags = tempTags.substring(0, 147) + '...';
        messageText += `*Tags:* _${tempTags}_\n`;
      }

      if (lora.defaultWeight) {
        messageText += `*Default Weight:* ${String(lora.defaultWeight)}\n`;
      }

      if (lora.previewImages && lora.previewImages.length > 0) {
        // Assuming previewImages[0] is an HTTP(S) URL
        if (typeof lora.previewImages[0] === 'string' && (lora.previewImages[0].startsWith('http://') || lora.previewImages[0].startsWith('https://'))) {
            photoUrl = lora.previewImages[0];
        logger.debug(`[ModsMenuManager] Photo URL for ${loraIdentifier}: ${photoUrl}`);
        } else {
            logger.warn(`[ModsMenuManager] Invalid or non-HTTP preview image URL for ${loraIdentifier}: ${lora.previewImages[0]}. Will display as text.`);
            photoUrl = null;
        }
      }

      // Shorten the filter type to prevent the callback data from exceeding 64 bytes.
      const toggleFavoriteCallback = `mods:toggle_favorite:${lora.isFavorite}:${lora._id}:${backFilterShortcode}:${backCheckpoint}:${backPage}`;

      keyboard.push([{
         text: (lora.isFavorite ? '💔 Unfavorite' : '❤️ Favorite'), callback_data: toggleFavoriteCallback
      }]);

      // Add admin button if user is an admin
      const ADMIN_TELEGRAM_USER_ID = 5472638766;
      if (callbackQuery.from.id === ADMIN_TELEGRAM_USER_ID) {
          keyboard.push([{ 
              text: '⚙️ Admin Actions', 
              callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.menu}:${lora._id}:${backFilterShortcode}:${backCheckpoint}:${backPage}`
          }]);
      }
    } else {
      messageText = `*Mod Detail: ${loraIdentifier}*\n\n_Could not find details for this Mod._`;
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Mod detail for ${loraIdentifier}:`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    messageText = `*Mod Detail: ${loraIdentifier}*\n\n_Sorry, there was an error fetching details. Please try again later._`;
    if (apiError.response && apiError.response.status === 404) {
      messageText = `*Mod Detail: ${loraIdentifier}*\n\n_This Mod could not be found._`;
    }
  }

  keyboard.push([{ text: "⇱", callback_data: `mods:category:${backFilterShortcode}:${backCheckpoint}:${backPage}` }]);
  
  logger.debug(`[ModsMenuManager] Final message text for ${loraIdentifier} (before Telegram ops):\n${messageText}`);
  logger.debug(`[ModsMenuManager] Final keyboard for ${loraIdentifier}:`, JSON.stringify(keyboard, null, 2));
  logger.debug(`[ModsMenuManager] Photo URL to be used: ${photoUrl}, isEdit: ${isEdit}`);

  try { // Try block for Telegram operations
    if (isEdit) {
      const originalMessageWasPhoto = callbackQuery.message.photo && callbackQuery.message.photo.length > 0;
    if (photoUrl) {
        try {
          await editEscapedMessageMedia(bot,
            { type: 'photo', media: photoUrl, caption: messageText },
            { chat_id: chatId, message_id: originalMessageId, reply_markup: { inline_keyboard: keyboard } }
          );
          logger.info(`[ModsMenuManager] editMessageMedia succeeded for ${originalMessageId}.`);
        } catch (editMediaError) {
          logger.warn(`[ModsMenuManager] editMessageMedia failed for ${originalMessageId} (${editMediaError.message}).`);
          if (originalMessageWasPhoto) {
            logger.debug(`[ModsMenuManager] editMessageMedia failed, original was photo. Trying editMessageCaption for ${originalMessageId}.`);
            try {
              await editEscapedMessageCaption(bot, messageText, {
                chat_id: chatId, message_id: originalMessageId,
                reply_markup: { inline_keyboard: keyboard },
              });
              logger.info(`[ModsMenuManager] editMessageCaption succeeded for ${originalMessageId}.`);
            } catch (editCaptionError) {
              logger.warn(`[ModsMenuManager] editMessageCaption also failed for ${originalMessageId} (${editCaptionError.message}). Sending new photo.`);
              await sendPhotoWithEscapedCaption(bot, chatId, photoUrl, { reply_markup: { inline_keyboard: keyboard } }, messageText);
            }
          } else { // Original was text, editMessageMedia failed to convert. Send new photo.
            logger.warn(`[ModsMenuManager] editMessageMedia failed to convert text to photo for ${originalMessageId}. Sending new photo.`);
            await sendPhotoWithEscapedCaption(bot, chatId, photoUrl, { reply_markup: { inline_keyboard: keyboard } }, messageText);
          }
        }
      } else { // We want to display/update text (photoUrl is null)
        logger.debug(`[ModsMenuManager] Edit Mode: Attempting to show/update text for ${loraIdentifier} on message ${originalMessageId}`);
        try {
          await editEscapedMessageText(bot, messageText, {
            chat_id: chatId, message_id: originalMessageId,
            reply_markup: { inline_keyboard: keyboard },
          });
          logger.info(`[ModsMenuManager] editMessageText succeeded for ${originalMessageId}.`);
        } catch (editTextError) {
          logger.warn(`[ModsMenuManager] editMessageText failed for ${originalMessageId} (${editTextError.message}). Sending new text message.`);
          await sendEscapedMessage(bot, chatId, messageText, { reply_markup: { inline_keyboard: keyboard } });
        }
      }
    } else { // Not an edit, send a new message
      if (photoUrl) {
        logger.debug(`[ModsMenuManager] New Message Mode: Sending photo for ${loraIdentifier}.`);
        await sendPhotoWithEscapedCaption(bot, chatId, photoUrl, { reply_markup: { inline_keyboard: keyboard } }, messageText);
          } else {
        logger.debug(`[ModsMenuManager] New Message Mode: Sending text for ${loraIdentifier}.`);
        await sendEscapedMessage(bot, chatId, messageText, { reply_markup: { inline_keyboard: keyboard } });
      }
    }

    if (callbackQuery && !callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }

  } catch (error) { // Main catch for Telegram bot operations
    logger.error(`[ModsMenuManager] Error in displayModDetailScreen Telegram operations (Identifier: ${loraIdentifier}):`, {
      errorMsg: error.message,
      errorResponse: error.response ? error.response.body || error.response.data : null,
      errorCode: error.code,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      stack: error.stack
    });
    
    // Check if error was due to photo URL being invalid (e.g. Telegram couldn't fetch it)
    // This is a general catch; specific ENOENT for local files is removed as we assume HTTP.
    if (photoUrl && error.message) { // A crude check, Telegram errors can be varied.
        logger.warn(`[ModsMenuManager] A photo was intended but an error occurred (${error.message}). Attempting to send/edit as text fallback.`);
        try {
          if (isEdit) {
                 await editEscapedMessageText(bot, messageText, { // Try to edit original message to text
                    chat_id: chatId, message_id: originalMessageId,
                    reply_markup: { inline_keyboard: keyboard },
                });
            } else {
                 await sendEscapedMessage(bot, chatId, messageText, { reply_markup: { inline_keyboard: keyboard } });
            }
            if (callbackQuery && !callbackQuery.answered) await bot.answerCallbackQuery(callbackQuery.id);
            // Exiting here as we've handled the fallback
            return; 
        } catch (fallbackError) {
            logger.error(`[ModsMenuManager] Text fallback also failed for ${loraIdentifier}:`, fallbackError);
        }
    }

    if (callbackQuery && !callbackQuery.answered) {
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating Mod detail.", show_alert: true});
      } catch (ackError) {
        logger.error(`[ModsMenuManager] FATAL: Could not acknowledge callback query after Telegram operation error (LoRA: ${loraIdentifier}):`, { /* ... ackError details ... */ });
      }
    }
  }
}

/**
 * Displays the main Mod Store categories menu.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 * @param {boolean} isEdit - Whether to edit an existing message or send a new one.
 */
async function displayModsStoreMainMenu(bot, callbackQuery, masterAccountId, dependencies, isEdit = true) {
  const { logger } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  logger.info(`[ModsMenuManager] Displaying Mod Store main menu for MAID: ${masterAccountId}`);

  const menuMessage = '🛍️ Mod Store 🛍️\nBrowse user-trained Mods:';
  
  const inlineKeyboard = [
    // Placeholder buttons for the store menu
    [{ text: '💰 By Price', callback_data: 'mods_store:category:price:All:1' }],
    [{ text: '🏷️ By Tag', callback_data: 'mods_store:category:tag:All:1' }],
    [{ text: '🔥 Popular', callback_data: 'mods_store:category:popular:All:1' }],
    [{ text: '🆕 Newest', callback_data: 'mods_store:category:recent:All:1' }],
    [{ text: '🔍 My Listed Mods', callback_data: 'mods_store:my_listed:All:1' }], 
    [{ text: '📜 My Purchases', callback_data: 'mods_store:my_purchases:All:1' }], 
    [{ text: 'Back to Main Mod Menu', callback_data: 'mods:main_menu' }],
    [{ text: "Ⓧ Close Store", callback_data: 'mods:nvm' }] // Reuse nvm for now
  ];

  const options = {
    reply_markup: { inline_keyboard: inlineKeyboard },
  };

  try {
    await editEscapedMessageText(bot, menuMessage, {
      chat_id: chatId,
      message_id: messageId,
      ...options
    });
    if (callbackQuery && !callbackQuery.answered) {
        await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayModsStoreMainMenu (MAID: ${masterAccountId}):`, error.response ? error.response.data : error.message, error.stack);
    if (callbackQuery && !callbackQuery.answered) {
        await bot.answerCallbackQuery(callbackQuery.id, {text: "Error showing Mod Store menu.", show_alert: true});
    }
  }
}

/**
 * Displays Mods from the store based on a filter type and checkpoint.
 * @param {Object} bot
 * @param {Object} callbackQuery
 * @param {string} masterAccountId
 * @param {Object} dependencies
 * @param {boolean} isEdit
 * @param {string} filterType - e.g., 'price', 'tag', 'popular', 'recent'
 * @param {string} currentCheckpoint - e.g., 'All', 'SDXL', 'SD1.5'
 * @param {number} currentPage - e.g., 1
 */
async function displayStoreModsByFilterScreen(bot, callbackQuery, masterAccountId, dependencies, isEdit, filterType, currentCheckpoint, currentPage) {
  const { logger } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  logger.info(`[ModsMenuManager] Displaying Store Mods. Filter: ${filterType}, Checkpoint: ${currentCheckpoint}, Page: ${currentPage}, MAID: ${masterAccountId}`);

  // Sanitize/Beautify filterType for display
  let displayFilterName = filterType.charAt(0).toUpperCase() + filterType.slice(1);
  if (filterType === 'price') displayFilterName = 'By Price';
  if (filterType === 'tag') displayFilterName = 'By Tag'; // This will likely need a sub-menu for selecting tags

  let title = `*${displayFilterName} Store Mods*`;
  if (currentCheckpoint !== 'All') {
    title += ` (Checkpoint: ${currentCheckpoint})`;
  }

  const keyboard = [];
  const filterShortcode = getFilterShortcode(filterType);

  // Checkpoint filter buttons (similar to existing lora menu)
  const checkpointButtons = AVAILABLE_CHECKPOINTS.map(cp => ({
    text: (cp === currentCheckpoint ? `✅ ${cp}` : cp),
    // Reset to page 1 on checkpoint change, maintain filterType
    callback_data: `mods_store:category:${filterShortcode}:${cp}:1` 
  }));
  keyboard.push(checkpointButtons);

  let loraListText = `
_Fetching Mods from the store..._
`;
  let totalPages = 1;

  const queryParams = new URLSearchParams({
    storeFilterType: filterType, // API uses storeFilterType
    checkpoint: currentCheckpoint,
    page: currentPage.toString(),
    limit: '5', 
    userId: masterAccountId 
  }).toString();

  try {
    logger.info(`[ModsMenuManager] Calling /internal/v1/data/store/loras with params:`, queryParams);
    const response = await dependencies.internal.client.get('/internal/v1/data/store/loras', {
      params: queryParams
    });
    const { loras, totalPages, hasNextPage, hasPrevPage } = response.data;
    
    if (loras.length > 0) {
      loraListText = ''; 
      loras.forEach(lora => {
        const buttonDisplayName = lora.name || lora.slug;
        // Add price to the button text
        const priceText = lora.monetization?.forSale && lora.monetization?.priceUSD ? `(${lora.monetization.priceUSD} pts)` : '(Price N/A)';
        const escapedButtonText = `${buttonDisplayName} ${priceText}`;
        
        // Callback for store detail: mods_store:detail:SLUG_OR_ID:filterType:checkpoint:page
        const detailCallback = `mods_store:detail:${lora._id}:${filterShortcode}:${currentCheckpoint}:${currentPage}`;
        keyboard.push([{ text: escapedButtonText, callback_data: detailCallback }]);
      });
    } else {
      loraListText = `
_No Mods found in the store matching your criteria._
`;
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Store Mods for ${filterType} (CP: ${currentCheckpoint}, Page: ${currentPage}):`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    loraListText = `
_Sorry, there was an error fetching Mods from the store. Please try again._
`;
    if (!title.includes('Page ')) {
        title += ` - Page ${currentPage}/${totalPages}`;
    }
  }

  const navigationRow = [];
  if (currentPage > 1) {
    navigationRow.push({ text: "⇤ Prev", callback_data: `mods_store:category:${filterShortcode}:${currentCheckpoint}:${currentPage - 1}` });
  }
  // Back to Store Main Menu button
  navigationRow.push({ text: "⇱ Store Menu", callback_data: 'mods_store:main_menu' }); 
  if (currentPage < totalPages) { 
    navigationRow.push({ text: "Next ⇥", callback_data: `mods_store:category:${filterShortcode}:${currentCheckpoint}:${currentPage + 1}` });
  }
  if (navigationRow.length > 0) {
      keyboard.push(navigationRow);
  }

  const fullMessage = `${title}${loraListText}`;
  logger.debug(`[ModsMenuManager] Full message for store filter (before Telegram ops):\n${fullMessage}`);
  try {
    await editEscapedMessageText(bot, fullMessage, {
            chat_id: chatId,
      message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
          });
    if (callbackQuery && !callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayStoreModsByFilterScreen (Filter: ${filterType}):`, error);
    if (isEdit) {
        logger.info(`[ModsMenuManager] Editing failed for store filter screen (Filter: ${filterType}), attempting to send as new message.`);
        try {
            await sendEscapedMessage(bot, chatId, fullMessage, {
            reply_markup: { inline_keyboard: keyboard },
          });
            // If we sent a new message, we might want to delete the old one if it was an edit attempt that failed.
            // For now, just send new and acknowledge.
            if (callbackQuery && !callbackQuery.answered) await bot.answerCallbackQuery(callbackQuery.id);
            return; 
        } catch (sendError) {
            logger.error(`[ModsMenuManager] Also failed to send store filter screen as new message (Filter: ${filterType}):`, sendError);
        }
    }
    if (callbackQuery && !callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating store Mod list.", show_alert: true});
    }
  }
}

/**
 * Displays the detailed screen for a single Mod from the store.
 */
async function displayStoreModDetailScreen(bot, callbackQuery, masterAccountId, dependencies, isEdit, loraIdentifier, backFilterType, backCheckpoint, backPage) {
  const { logger } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const originalMessageId = callbackQuery.message.message_id;

  logger.info(`[ModsMenuManager] Displaying Store Mod Detail. LoRA: ${loraIdentifier}, MAID: ${masterAccountId}`);

  let messageText = `*Mod Store Detail: ${loraIdentifier}*\n\n_Fetching details..._`;
  const keyboard = [];
  let photoUrl = null;
  let isOwned = false; // Will be determined by API response or permissions check
  const backFilterShortcode = getFilterShortcode(backFilterType);

  try {
    // Use the existing /loras/:loraIdentifier endpoint.
    logger.info(`[ModsMenuManager] Store Detail: Calling /internal/v1/data/loras/${loraIdentifier}?userId=${masterAccountId}`);
    const response = await dependencies.internal.client.get(`/internal/v1/data/loras/${loraIdentifier}`, {
      params: { userId: masterAccountId }
    });
    const lora = response.data.lora;

    if (lora) {
      // Check if user owns this LoRA (has permission)
      const permission = await dependencies.internal.client.post('/internal/v1/data/loras/access', {
        loraId: lora._id,
        userId: masterAccountId
      });
      isOwned = !!permission.data.hasAccess;

      let tempName = lora.name || lora.slug;
      if (tempName.length > 64) tempName = tempName.substring(0, 61) + '...';
      messageText = `*${tempName}*\n`;

      if (lora.description) {
        const maxLength = 150;
        const cleanedDesc = stripHtml(lora.description); // Sanitize the description
        const desc = cleanedDesc.length > maxLength ? cleanedDesc.substring(0, maxLength) + '...' : cleanedDesc;
        messageText += `_${desc}_\n\n`;
      }

      messageText += `*Checkpoint:* ${lora.checkpoint || 'N/A'}\n`;

      if (lora.triggerWords && lora.triggerWords.length > 0) {
        let tempTriggers = lora.triggerWords.join(', ');
        if (tempTriggers.length > 100) tempTriggers = tempTriggers.substring(0, 97) + '...';
        messageText += `*Triggers:* \`${tempTriggers}\`\n`;
      }
      
      const price = lora.monetization?.forSale && lora.monetization?.priceUSD ? lora.monetization.priceUSD : null;
      if (price !== null) {
        messageText += `*Price:* ${String(price)} points\n`;
      } else {
        messageText += `*Price:* Not currently for sale\n`;
      }

      if (lora.previewImages && lora.previewImages.length > 0 && 
          typeof lora.previewImages[0] === 'string' && 
          (lora.previewImages[0].startsWith('http://') || lora.previewImages[0].startsWith('https://'))) {
        photoUrl = lora.previewImages[0];
      }

      if (isOwned) {
        messageText += `\n*Status: ✅ You own this Mod!*\n`;
        // Optionally, add a button to go to the standard Mod detail view or a direct use command
        // keyboard.push([{ text: 'View/Use Mod', callback_data: `mods:detail:${loraIdentifier}:${backFilterType}:${backCheckpoint}:${backPage}` }]);
      } else if (price !== null && lora.monetization?.forSale) {
        // Lora is for sale and user doesn't own it
        keyboard.push([{ 
          text: `💰 Buy for ${price} points`, 
          callback_data: `mods_store:purchase_confirm:${loraIdentifier}:${price}:${backFilterShortcode}:${backCheckpoint}:${backPage}`
        }]);
      } else {
        // Not for sale, or user owns it but price is null (should not happen if forSale is true)
        messageText += `\n*Status: Not available for purchase at this moment.*\n`;
      }

      // Display cognates if they exist
      if (lora.cognates && lora.cognates.length > 0) {
        const cognateWords = lora.cognates.map(c => c.word).join(', ');
        if (cognateWords.length > 100) cognateWords = cognateWords.substring(0, 97) + '...';
        messageText += `*Shortcuts:* \`${cognateWords}\`\n`;
      }

      if (lora.tags && lora.tags.length > 0) {
        let tempTags = lora.tags.slice(0, 5).map(t => t.tag).join(', ');
        if (tempTags.length > 150) tempTags = tempTags.substring(0, 147) + '...';
        messageText += `*Tags:* _${tempTags}_\n`;
      }

      if (lora.defaultWeight) {
        messageText += `*Default Weight:* ${String(lora.defaultWeight)}\n`;
      }

    } else {
      messageText = `*Mod Store Detail: ${loraIdentifier}*\n\n_Could not find details for this Mod._`;
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Store Mod detail for ${loraIdentifier}:`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    messageText = `*Mod Store Detail: ${loraIdentifier}*\n\n_Sorry, there was an error fetching details._`;
    if (apiError.response && apiError.response.status === 404) {
      messageText = `*Mod Store Detail: ${loraIdentifier}*\n\n_This Mod could not be found in the store._`;
    }
  }

  // Back button to the store listing screen
  keyboard.push([{ text: "⇱", callback_data: `mods_store:category:${backFilterShortcode}:${backCheckpoint}:${backPage}` }]);
  
  logger.debug(`[ModsMenuManager] Store Detail - Final message text for ${loraIdentifier}:\n${messageText}`);
  logger.debug(`[ModsMenuManager] Store Detail - Final keyboard:`, JSON.stringify(keyboard, null, 2));

  // Telegram send/edit logic (similar to displayModDetailScreen, adapted for store context)
  try { 
    if (isEdit) {
      const originalMessageWasPhoto = callbackQuery.message.photo && callbackQuery.message.photo.length > 0;
      if (photoUrl) { 
        try {
          await editEscapedMessageMedia(bot,
            { type: 'photo', media: photoUrl, caption: messageText },
            { chat_id: chatId, message_id: originalMessageId, reply_markup: { inline_keyboard: keyboard } }
          );
        } catch (editMediaError) {
          logger.warn(`[ModsMenuManager] Store Detail editMessageMedia failed: ${editMediaError.message}. Trying caption or new.`);
          if (originalMessageWasPhoto) {
            try {
              await editEscapedMessageCaption(bot, messageText, {
                chat_id: chatId, message_id: originalMessageId,
                reply_markup: { inline_keyboard: keyboard },
              });
            } catch (editCaptionError) {
              logger.warn(`[ModsMenuManager] Store Detail editMessageCaption failed: ${editCaptionError.message}. Sending new photo.`);
              await sendPhotoWithEscapedCaption(bot, chatId, photoUrl, { reply_markup: { inline_keyboard: keyboard } }, messageText);
            }
          } else { 
            logger.warn(`[ModsMenuManager] Store Detail: Original was text, editMessageMedia failed. Sending new photo.`);
            await sendPhotoWithEscapedCaption(bot, chatId, photoUrl, { reply_markup: { inline_keyboard: keyboard } }, messageText);
          }
        }
      } else { 
        try {
          await editEscapedMessageText(bot, messageText, {
            chat_id: chatId, message_id: originalMessageId,
            reply_markup: { inline_keyboard: keyboard },
          });
        } catch (editTextError) {
          logger.warn(`[ModsMenuManager] Store Detail editMessageText failed: ${editTextError.message}. Sending new text message.`);
          await sendEscapedMessage(bot, chatId, messageText, { reply_markup: { inline_keyboard: keyboard } });
        }
      }
    } else { 
      if (photoUrl) {
        await sendPhotoWithEscapedCaption(bot, chatId, photoUrl, { reply_markup: { inline_keyboard: keyboard } }, messageText);
      } else {
        await sendEscapedMessage(bot, chatId, messageText, { reply_markup: { inline_keyboard: keyboard } });
      }
    }
    if (callbackQuery && !callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayStoreModDetailScreen Telegram ops (LoRA: ${loraIdentifier}):`, error.message, error.stack);
    if (photoUrl && error.message) { 
        logger.warn(`[ModsMenuManager] Store Detail: Photo intended but error occurred (${error.message}). Fallback to text.`);
        try {
            if (isEdit) {
                 await editEscapedMessageText(bot, messageText, { 
                    chat_id: chatId, message_id: originalMessageId,
                    reply_markup: { inline_keyboard: keyboard },
                });
            } else {
                 await sendEscapedMessage(bot, chatId, messageText, { reply_markup: { inline_keyboard: keyboard } });
            }
            if (callbackQuery && !callbackQuery.answered) await bot.answerCallbackQuery(callbackQuery.id);
            return; 
        } catch (fallbackError) {
            logger.error(`[ModsMenuManager] Store Detail: Text fallback also failed for ${loraIdentifier}:`, fallbackError);
        }
    }
    if (callbackQuery && !callbackQuery.answered) {
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating store Mod detail.", show_alert: true});
      } catch (ackError) {
        logger.error(`[ModsMenuManager] FATAL: Store Detail: Could not ack CBQ after error (LoRA: ${loraIdentifier}):`, ackError);
      }
    }
  }
}

/**
 * Displays the Admin menu for a single Mod.
 * @param {Object} bot
 * @param {Object} callbackQuery
 * @param {string} masterAccountId
 * @param {Object} dependencies
 * @param {boolean} isEdit
 * @param {string} loraId
 * @param {string} backFilterShortcode
 * @param {string} backCheckpoint
 * @param {number} backPage
 */
async function displayModAdminMenu(bot, callbackQuery, masterAccountId, dependencies, isEdit, loraId, backFilterShortcode, backCheckpoint, backPage) {
    const { logger } = dependencies;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    logger.info(`[ModsMenuManager] Displaying admin menu for Mod ${loraId}`);

    const backFilterType = getFilterFromShortcode(backFilterShortcode);

    const text = `*Admin Menu for Mod* (ID: \`${loraId}\`)`;
    const keyboard = [
        [{ text: '❌ Delete Mod', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.delete_confirm}:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }],
        [{ text: '✏️ Change Checkpoint', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.change_checkpoint_menu}:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }],
        [{ text: '🔧 Fix Owner Permission', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.grant_owner_permission}:${loraId}` }],
        [{ text: 'Back to Mod Detail', callback_data: `mods:detail:${loraId}:${backFilterType}:${backCheckpoint}:${backPage}`}]
    ];

    try {
        await editEscapedMessageText(bot, text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
        });
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch(error) {
        logger.error(`[ModsMenuManager] Error displaying admin menu for Mod ${loraId}:`, error);

        // Fallback for when trying to edit a photo message into a text message.
        if (error.response && error.response.body && error.response.body.description.includes('there is no text in the message to edit')) {
            logger.warn(`[ModsMenuManager] Admin menu edit failed (likely photo->text). Sending new message and deleting old one.`);
            try {
                // First, send the new menu. Then delete the old one.
                // This feels safer than deleting first.
                await sendEscapedMessage(bot, chatId, text, {
                    reply_markup: { inline_keyboard: keyboard }
                });
                await bot.deleteMessage(chatId, messageId);

                if (!callbackQuery.answered) {
                    await bot.answerCallbackQuery(callbackQuery.id);
                }
                return; // Exit as we've successfully handled it.
            } catch (fallbackError) {
                logger.error(`[ModsMenuManager] Admin menu fallback (send/delete) also failed for Mod ${loraId}:`, fallbackError);
                // The original error is more informative, so we'll let the generic handler below deal with it.
            }
        }
        
        if (!callbackQuery.answered) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error showing admin menu.', show_alert: true });
        }
  }
}

/**
 * Displays the checkpoint change menu for a single Mod.
 * @param {Object} bot
 * @param {Object} callbackQuery
 * @param {string} masterAccountId
 * @param {Object} dependencies
 * @param {boolean} isEdit
 * @param {string} loraId
 * @param {string} backFilterShortcode
 * @param {string} backCheckpoint
 * @param {number} backPage
 */
async function displayChangeCheckpointMenu(bot, callbackQuery, masterAccountId, dependencies, isEdit, loraId, backFilterShortcode, backCheckpoint, backPage) {
    const { logger } = dependencies;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    logger.info(`[ModsMenuManager] Displaying change checkpoint menu for Mod ${loraId}`);

    try {
        const response = await dependencies.internal.client.get(`/internal/v1/data/loras/${loraId}`, {
            params: { isAdmin: true } // Pass admin flag to bypass permission checks
        });
        const lora = response.data.lora;
        if (!lora) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Could not find this Mod.', show_alert: true });
            return;
        }

        const currentLoraCheckpoint = lora.checkpoint || 'Not Set';
        const text = `*Change Checkpoint for ${lora.name}*\n\nCurrent Checkpoint: \`${currentLoraCheckpoint}\`\n\nSelect a new checkpoint:`;

        const checkpointButtons = VALID_CHECKPOINTS.map(cp => {
            const buttonText = (cp === currentLoraCheckpoint) ? `✅ ${cp}` : cp;
            const callbackData = `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.set_checkpoint}:${loraId}:${cp}:${backFilterShortcode}:${backCheckpoint}:${backPage}`;
            return { text: buttonText, callback_data: callbackData };
        });

        // Arrange buttons in rows of 2
        const keyboardRows = [];
        for (let i = 0; i < checkpointButtons.length; i += 2) {
            keyboardRows.push(checkpointButtons.slice(i, i + 2));
        }

        keyboardRows.push([{ text: 'Back to Admin Menu', callback_data: `mods:admin:${ADMIN_ACTION_SHORTCODE_MAP.menu}:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }]);

        await editEscapedMessageText(bot, text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboardRows }
        });
        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        // Correctly log the error without circular dependencies
        const errorMsg = error.response?.data?.message || error.message;
        logger.error(`[ModsMenuManager] Error displaying change checkpoint menu for Mod ${loraId}: ${errorMsg}`, { stack: error.stack });
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error showing checkpoint menu.', show_alert: true });
    }
}

/**
 * Handles replies for importing a mod via URL.
 * This is triggered by the MessageReplyDispatcher.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The user's reply message.
 * @param {object} context - The reply context.
 * @param {object} dependencies - Shared dependencies.
 */
async function handleModImportReply(bot, msg, context, dependencies) {
    const { logger } = dependencies;
    const chatId = msg.chat.id;
    const { masterAccountId, originalMenuMessageId } = context;
    const url = msg.text;

    logger.info(`[ModsMenu] Received reply for mod import. MAID: ${masterAccountId}, URL: '${url}'`);

    try {
        const result = await dependencies.internal.client.post('/internal/v1/data/loras/import', {
            url: url,
            userId: masterAccountId
        });
        await sendEscapedMessage(bot, chatId, result.data.message, { reply_to_message_id: msg.message_id });

        // Refresh the menu
        if (msg.reply_to_message && msg.reply_to_message.message_id) {
            await displayModsMainMenu(bot, msg.reply_to_message, masterAccountId, dependencies, true);
        }
    } catch (error) {
        const errorMessage = error.response?.data?.message || 'Failed to import Mod.';
        // --- MODIFICATION: Log the full serialized error object ---
        const fullError = JSON.stringify(error, Object.getOwnPropertyNames(error));
        logger.error(`[ModsMenu] Error importing Mod from URL ${url} for MAID ${masterAccountId}. Error: ${errorMessage}. Full details: ${fullError}`);
        // --- END MODIFICATION ---
        await sendEscapedMessage(bot, chatId, `⚠️ ${errorMessage}`, { reply_to_message_id: msg.message_id });
    }
}

/**
 * The handler for the /mods command.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} msg - The message object from the command.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function modsCommandHandler(bot, msg, dependencies) {
    const { logger } = dependencies;
    logger.info(`[ModsMenuManager] /mods command received from Telegram User ID: ${msg.from.id}`);
    try {
        const findOrCreateResponse = await dependencies.internal.client.post('/internal/v1/data/users/find-or-create', {
            platform: 'telegram',
            platformId: msg.from.id.toString(),
            platformContext: { firstName: msg.from.first_name, username: msg.from.username }
        });
        const masterAccountId = findOrCreateResponse.data.masterAccountId;
        await displayModsMainMenu(bot, msg, masterAccountId, dependencies, false);
    } catch (error) {
        logger.error(`[ModsMenuManager] Critical error in modsCommandHandler:`, error.stack || error);
        await sendEscapedMessage(bot, msg.chat.id, 'A critical error occurred while opening the Mods menu.');
    }
}

/**
 * The handler for callback queries related to the mods menu.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {object} dependencies - The canonical dependencies object.
 */
async function modsCallbackHandler(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger } = dependencies;
    logger.info(`[ModsMenuManager] modsCallbackHandler triggered with data: ${callbackQuery.data}`);
    try {
        await handleModsCallback(bot, callbackQuery, masterAccountId, dependencies);
    } catch (error) {
        logger.error(`[ModsMenuManager] Critical error in modsCallbackHandler:`, error.stack || error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'A critical error occurred.', show_alert: true });
    }
}

/**
 * The handler for callback queries related to the lora admin actions.
 * @param {object} bot - The Telegram bot instance.
 * @param {object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID (of the admin).
 * @param {object} dependencies - The canonical dependencies object.
 */
async function loraAdminCallbackHandler(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger, internal } = dependencies;
    const data = callbackQuery.data;
    const [action, subAction, loraId] = data.split(':');

    logger.info(`[ModsMenuManager] loraAdminCallbackHandler triggered with data: ${data}`);

    // Basic security check: ensure the user is an admin.
    const ADMIN_ID = process.env.TELEGRAM_ADMIN_USER_ID;
    if (callbackQuery.from.id.toString() !== ADMIN_ID) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'You are not authorized for this action.', show_alert: true });
        return;
    }
    
    if (!loraId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Missing LoRA ID.', show_alert: true });
        return;
    }

    let resultText = '';
    let apiEndpoint = '';

    try {
        if (subAction === 'approve_public') {
            apiEndpoint = `/internal/v1/data/loras/${loraId}/admin-approve`;
            resultText = '✅ Publicly Approved';
        } else if (subAction === 'approve_private') {
            apiEndpoint = `/internal/v1/data/loras/${loraId}/admin-approve-private`;
            resultText = '🔒 Privately Approved';
        } else if (subAction === 'reject') {
            apiEndpoint = `/internal/v1/data/loras/${loraId}/admin-reject`;
            resultText = '❌ Rejected';
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, { text: `Unknown admin action: ${subAction}` });
            return;
        }

        // Call the internal API
        await internal.client.post(apiEndpoint);

        // Edit the original message to show the result
        const originalMessage = callbackQuery.message.text;
        const newText = `${originalMessage}\n\n*Action Taken: ${resultText} by ${callbackQuery.from.first_name}*`;

        await editEscapedMessageText(bot, newText, {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            reply_markup: null // Remove buttons
        });

        await bot.answerCallbackQuery(callbackQuery.id, { text: `LoRA ${resultText}!` });

    } catch (error) {
        const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
        logger.error(`[ModsMenuManager] Error in loraAdminCallbackHandler for action ${subAction} on LoRA ${loraId}: ${errorMsg}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: `Error: ${errorMsg}`, show_alert: true });
    }
}

/**
 * Registers all handlers for the mods menu feature.
 * @param {object} dispatcherInstances - The dispatcher instances object.
 * @param {object} dependencies - The canonical dependencies object.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher, messageReplyDispatcher } = dispatcherInstances;
    const { logger } = dependencies;

    const modImportHandler = (bot, msg, context) => handleModImportReply(bot, msg, context, dependencies);

    commandDispatcher.register(/^\/mods(?:@\w+)?/i, modsCommandHandler);
    callbackQueryDispatcher.register('mods', modsCallbackHandler);
    callbackQueryDispatcher.register('mods_store', modsCallbackHandler);
    callbackQueryDispatcher.register('lora_admin', loraAdminCallbackHandler);
    messageReplyDispatcher.register('mod_import_url', modImportHandler);

    logger.info('[ModsMenuManager] All handlers registered.');
}

// TODO: Implement other display functions:
// displayModDetail(bot, messageOrQuery, masterAccountId, loraSlug, dependencies, isEdit = false)
// handleFavoriteLora(bot, callbackQuery, masterAccountId, loraSlug, dependencies)
// handleRateLora(bot, callbackQuery, masterAccountId, loraSlug, rating, dependencies)
// promptLoraRequest(bot, messageOrQuery, masterAccountId, dependencies, isEdit = false)
// handleLoraRequestReply(bot, message, masterAccountId, dependencies) - for message listener

module.exports = {
    registerHandlers
}; 