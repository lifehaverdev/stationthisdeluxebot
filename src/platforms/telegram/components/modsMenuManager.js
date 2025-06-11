/**
 * Mod Menu Manager for Telegram
 * 
 * Handles the display and interaction logic for Mod-related menus.
 */

// Dependencies will be passed in by the main bot.js, typically including:
// bot, logger, internalApiClient, userSettingsService, toolRegistry (if needed)

const AVAILABLE_CHECKPOINTS = ['All', 'SDXL', 'SD1.5', 'FLUX']; // Example, could be dynamic
const { ObjectId } = require('../../../core/services/db/BaseDB');
// Placeholder for internalApiClient if needed directly, or pass via dependencies
// const internalApiClient = require('../../../utils/internalApiClient'); 
const { escapeMarkdownV2 } = require('../../../utils/stringUtils'); // ADDED
 
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
 * @param {Object} dependencies - Shared dependencies (logger, internalApiClient, etc.).
 */
async function handleModsCommand(bot, message, masterAccountId, dependencies) {
  const { logger } = dependencies;
  logger.info(`[ModsMenuManager] /mods command received from MAID: ${masterAccountId}`);
  await displayModsMainMenu(bot, message, masterAccountId, dependencies, false);
}

/**
 * Handles callback queries for Mod menus.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 */
async function handleModsCallback(bot, callbackQuery, masterAccountId, dependencies) {
  const { logger, internalApiClient } = dependencies;
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

        // The loraMongoId is now passed directly in the callback, so no need to fetch it.
        if (!loraMongoId) {
            logger.error(`[ModsMenuManager] No loraMongoId found in toggle_favorite callback.`);
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Could not identify Mod for favorite action.', show_alert: true });
          return;
        }

        try {
          if (isCurrentlyFavorite) {
            await internalApiClient.delete(`/users/${masterAccountId}/preferences/lora-favorites/${loraMongoId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Removed from favorites ❤️' });
          } else {
            await internalApiClient.post(`/users/${masterAccountId}/preferences/lora-favorites`, { loraId: loraMongoId });
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Added to favorites! 💔' });
          }
          // Refresh the detail screen, passing the same context back.
          // Note: loraIdentifierForRefresh is the Mongo ID, which displayModDetailScreen can handle.
          await displayModDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifierForRefresh, backFilterType, backCheckpoint, backPage);
        } catch (favError) {
          logger.error(`[ModsMenuManager] Error toggling favorite for LoRA _id ${loraMongoId}:`, {
            errorMsg: favError.message, errorResponse: favError.response ? favError.response.data : null, errorCode: favError.code, fullError: JSON.stringify(favError, Object.getOwnPropertyNames(favError)), stack: favError.stack
          });
          // Check if callbackQuery was already answered by the post/delete success
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
        const { replyContextManager } = dependencies;

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
          if (replyContextManager) {
            const context = {
              type: 'mod_import_url',
              masterAccountId: masterAccountId,
              originalMenuMessageId: originalMenuMessageId
            };
            replyContextManager.addContext(sentMessage, context);
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
      } else if (subAction === 'admin_menu') {
        const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(1);
        await displayModAdminMenu(bot, callbackQuery, masterAccountId, dependencies, true, loraId, backFilterShortcode, backCheckpoint, backPage);
        return;
      } else if (subAction === 'admin_delete_confirm') {
        const [loraId, backFilterShortcode, backCheckpoint, backPage] = params.slice(1);
        const loraResponse = await internalApiClient.get(`/loras/${loraId}?userId=${masterAccountId}`);
        const loraName = loraResponse.data?.lora?.name || 'Unknown Mod';
        const text = `Are you sure you want to permanently delete Mod: *${escapeMarkdownV2(loraName)}* \\(ID: \`${loraId}\`\\)?\n\nThis action cannot be undone\\.`;
        const keyboard = [[
            { text: '❌ Yes, Delete Permanently ❌', callback_data: `mods:admin_delete_execute:${loraId}` },
            { text: 'Cancel', callback_data: `mods:admin_menu:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }
        ]];
        await bot.editMessageText(text, {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: keyboard }
        });
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      } else if (subAction === 'admin_delete_execute') {
        const [loraId] = params.slice(1);
        try {
            await internalApiClient.delete(`/loras/${loraId}`);
            await bot.editMessageText(`Mod with ID \`${loraId}\` has been deleted\\.`, {
                chat_id: callbackQuery.message.chat.id,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'MarkdownV2',
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
        const page = parseInt(pageStr, 10) || 1;
        // await displayUserListedStoreLorasScreen(bot, callbackQuery, masterAccountId, dependencies, true, checkpoint, page);
        logger.info(`[ModsMenuManager] Placeholder for 'my_listed' Mods in store. MAID: ${masterAccountId}, CP: ${checkpoint}, Page: ${page}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Viewing your listed Mods (not implemented yet).' });
      } else if (subAction === 'my_purchases') { // Placeholder for user's purchases
        const [checkpoint, pageStr] = params.slice(1);
        const page = parseInt(pageStr, 10) || 1;
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
  const chatId = isEdit ? messageOrQuery.message.chat.id : messageOrQuery.chat.id;
  const messageId = isEdit ? messageOrQuery.message.message_id : null;

  const menuMessage = escapeMarkdownV2('Mod Categories 🎨\nSelect a category to explore:');
  
  const inlineKeyboard = [
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
  ];

  const options = {
    reply_markup: { inline_keyboard: inlineKeyboard },
    parse_mode: 'MarkdownV2'
  };

  try {
    if (isEdit) {
      await bot.editMessageText(menuMessage, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      });
    } else {
      await bot.sendMessage(chatId, menuMessage, { ...options, reply_to_message_id: messageOrQuery.message_id });
    }
    if (isEdit && !messageOrQuery.answered) {
        await bot.answerCallbackQuery(messageOrQuery.id);
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayModsMainMenu (MAID: ${masterAccountId}):`, error.response ? error.response.data : error.message, error.stack);
    if (isEdit && !messageOrQuery.answered) {
        await bot.answerCallbackQuery(messageOrQuery.id, {text: "Error showing Mod menu.", show_alert: true});
    } else if (!isEdit) {
        await bot.sendMessage(chatId, "Sorry, couldn't open the Mod menu right now.");
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
  const { logger, internalApiClient } = dependencies;
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
  let title = `*${escapeMarkdownV2(displayFilterName)} Mods*`;
  if (currentCheckpoint !== 'All') {
    // Revert the diagnostic change and ensure parentheses are properly escaped
    title += ` ${escapeMarkdownV2(`(Checkpoint: ${currentCheckpoint})`)}`;
  }

  const keyboard = [];
  const filterShortcode = getFilterShortcode(filterType);

  // Checkpoint filter buttons
  const checkpointButtons = AVAILABLE_CHECKPOINTS.map(cp => ({
    text: (cp === currentCheckpoint ? `✅ ${cp}` : cp),
    callback_data: `mods:category:${filterShortcode}:${cp}:1` // Reset to page 1 on checkpoint change
  })); 
  keyboard.push(checkpointButtons);

  let loraListText = `\n_${escapeMarkdownV2('Fetching Mods...')}_\n`;
  let totalPages = 1;

  const queryParams = new URLSearchParams({
    filterType: filterType,
    checkpoint: currentCheckpoint,
    page: currentPage.toString(),
    limit: '5', // Let's use a smaller limit for Telegram inline menus
    userId: masterAccountId // For potential permissioning/favorites in future API versions
  }).toString();

  try {
    logger.info(`[ModsMenuManager] Calling /loras/list with params: ${queryParams}`);
    const response = await internalApiClient.get(`/loras/list?${queryParams}`);
    const responseData = response.data; // Assuming response.data is the object { loras: [], pagination: {} }
    
    if (responseData && responseData.loras) {
      const fetchedLoras = responseData.loras;
      totalPages = responseData.pagination.totalPages || 1;
      title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;

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
          const escapedButtonText = escapeMarkdownV2(buttonDisplayName);
          // --- End Request 3 ---
          
          // Using name for display, slug for callback
          // const displayName = escapeMarkdownV2(lora.name || lora.slug); // Old logic
          // Callback for detail: mods:detail:SLUG_OR_ID:filterType:checkpoint:page
          const detailCallback = `mods:detail:${lora.slug || lora._id}:${filterShortcode}:${currentCheckpoint}:${currentPage}`;
          keyboard.push([{ text: escapedButtonText, callback_data: detailCallback }]);
        });
      } else {
        loraListText = `\n_${escapeMarkdownV2('No Mods found matching your criteria.')}_\n`;
      }
    } else {
      logger.warn('[ModsMenuManager] Invalid response structure from loras API:', responseData);
      loraListText = `\n_${escapeMarkdownV2('Error: Could not parse Mod list from server.')}_\n`;
      if (!title.includes('Page ')) {
          title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;
      }
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Mods for ${filterType} (Checkpoint: ${currentCheckpoint}, Page: ${currentPage}):`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    loraListText = `\n_${escapeMarkdownV2('Sorry, there was an error fetching the Mods. Please try again later.')}_\n`;
    if (!title.includes('Page ')) {
        title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;
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
    await bot.editMessageText(fullMessage, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: 'MarkdownV2'
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
            await bot.sendMessage(chatId, fullMessage, {
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'MarkdownV2'
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
  const { logger, internalApiClient } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const originalMessageId = callbackQuery.message.message_id;

  let messageText = `*Mod Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Fetching details...')}_`;
  const keyboard = [];
  let photoUrl = null;
  const backFilterShortcode = getFilterShortcode(backFilterType);

  try {
    logger.info(`[ModsMenuManager] Calling /loras/${loraIdentifier}?userId=${masterAccountId}`);
    const response = await internalApiClient.get(`/loras/${loraIdentifier}?userId=${masterAccountId}`);
    const lora = response.data.lora;
    logger.debug(`[ModsMenuManager] Fetched LoRA details for ${loraIdentifier}:`, JSON.stringify(lora, null, 2));

    if (lora) {
      let tempName = lora.name || lora.slug;
      logger.debug(`[ModsMenuManager] Raw name/slug for ${loraIdentifier}: "${tempName}"`);
      let escapedName = escapeMarkdownV2(tempName);
      logger.debug(`[ModsMenuManager] Escaped name/slug for ${loraIdentifier}: "${escapedName}"`);
      messageText = `*${escapedName}*\n`;

      if (lora.description) {
        const maxLength = 150;
        const desc = lora.description.length > maxLength ? lora.description.substring(0, maxLength) + '...' : lora.description;
        logger.debug(`[ModsMenuManager] Raw description for ${loraIdentifier}: "${desc}"`);
        let escapedDesc = escapeMarkdownV2(desc);
        logger.debug(`[ModsMenuManager] Escaped description for ${loraIdentifier}: "${escapedDesc}"`);
        messageText += `_${escapedDesc}_\n\n`;
      }

      let tempCheckpoint = lora.checkpoint || 'N/A';
      logger.debug(`[ModsMenuManager] Raw checkpoint for ${loraIdentifier}: "${tempCheckpoint}"`);
      let escapedCheckpoint = escapeMarkdownV2(tempCheckpoint);
      logger.debug(`[ModsMenuManager] Escaped checkpoint for ${loraIdentifier}: "${escapedCheckpoint}"`);
      messageText += `*Checkpoint:* ${escapedCheckpoint}\n`;

      if (lora.triggerWords && lora.triggerWords.length > 0) {
        let tempTriggers = lora.triggerWords.join(', ');
        logger.debug(`[ModsMenuManager] Raw triggers for ${loraIdentifier}: "${tempTriggers}"`);
        let escapedTriggers = escapeMarkdownV2(tempTriggers);
        logger.debug(`[ModsMenuManager] Escaped triggers for ${loraIdentifier}: "${escapedTriggers}"`);
        messageText += `*Triggers:* \`${escapedTriggers}\`\n`;
      }

      // Display cognates if they exist
      if (lora.cognates && lora.cognates.length > 0) {
        const cognateWords = lora.cognates.map(c => c.word).join(', ');
        const escapedCognates = escapeMarkdownV2(cognateWords);
        messageText += `*Shortcuts:* \`${escapedCognates}\`\n`;
      }

      if (lora.tags && lora.tags.length > 0) {
        let tempTags = lora.tags.slice(0, 5).map(t => t.tag).join(', ');
        logger.debug(`[ModsMenuManager] Raw tags for ${loraIdentifier}: "${tempTags}"`);
        let escapedTags = escapeMarkdownV2(tempTags);
        logger.debug(`[ModsMenuManager] Escaped tags for ${loraIdentifier}: "${escapedTags}"`);
        messageText += `*Tags:* _${escapedTags}_\n`;
      }

      if (lora.defaultWeight) {
        let tempWeight = String(lora.defaultWeight);
        logger.debug(`[ModsMenuManager] Raw weight for ${loraIdentifier}: "${tempWeight}"`);
        let escapedWeight = escapeMarkdownV2(tempWeight);
        logger.debug(`[ModsMenuManager] Escaped weight for ${loraIdentifier}: "${escapedWeight}"`);
        messageText += `*Default Weight:* ${escapedWeight}\n`;
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
              callback_data: `mods:admin_menu:${lora._id}:${backFilterShortcode}:${backCheckpoint}:${backPage}`
          }]);
      }
    } else {
      messageText = `*Mod Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Could not find details for this Mod.')}_`;
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Mod detail for ${loraIdentifier}:`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    messageText = `*Mod Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Sorry, there was an error fetching details. Please try again later.')}_`;
    if (apiError.response && apiError.response.status === 404) {
      messageText = `*Mod Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('This Mod could not be found.')}_`;
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
          await bot.editMessageMedia(
            { type: 'photo', media: photoUrl, caption: messageText, parse_mode: 'MarkdownV2' },
            { chat_id: chatId, message_id: originalMessageId, reply_markup: { inline_keyboard: keyboard } }
          );
          logger.info(`[ModsMenuManager] editMessageMedia succeeded for ${originalMessageId}.`);
        } catch (editMediaError) {
          logger.warn(`[ModsMenuManager] editMessageMedia failed for ${originalMessageId} (${editMediaError.message}).`);
          if (originalMessageWasPhoto) {
            logger.debug(`[ModsMenuManager] editMessageMedia failed, original was photo. Trying editMessageCaption for ${originalMessageId}.`);
            try {
              await bot.editMessageCaption(messageText, {
                chat_id: chatId, message_id: originalMessageId,
                reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2'
              });
              logger.info(`[ModsMenuManager] editMessageCaption succeeded for ${originalMessageId}.`);
            } catch (editCaptionError) {
              logger.warn(`[ModsMenuManager] editMessageCaption also failed for ${originalMessageId} (${editCaptionError.message}). Sending new photo.`);
              await bot.sendPhoto(chatId, photoUrl, { caption: messageText, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
            }
          } else { // Original was text, editMessageMedia failed to convert. Send new photo.
            logger.warn(`[ModsMenuManager] editMessageMedia failed to convert text to photo for ${originalMessageId}. Sending new photo.`);
            await bot.sendPhoto(chatId, photoUrl, { caption: messageText, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
          }
        }
      } else { // We want to display/update text (photoUrl is null)
        logger.debug(`[ModsMenuManager] Edit Mode: Attempting to show/update text for ${loraIdentifier} on message ${originalMessageId}`);
        try {
          await bot.editMessageText(messageText, {
            chat_id: chatId, message_id: originalMessageId,
            reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2'
          });
          logger.info(`[ModsMenuManager] editMessageText succeeded for ${originalMessageId}.`);
        } catch (editTextError) {
          logger.warn(`[ModsMenuManager] editMessageText failed for ${originalMessageId} (${editTextError.message}). Sending new text message.`);
          await bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' });
        }
      }
    } else { // Not an edit, send a new message
      if (photoUrl) {
        logger.debug(`[ModsMenuManager] New Message Mode: Sending photo for ${loraIdentifier}.`);
        await bot.sendPhoto(chatId, photoUrl, { caption: messageText, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
          } else {
        logger.debug(`[ModsMenuManager] New Message Mode: Sending text for ${loraIdentifier}.`);
        await bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' });
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
                 await bot.editMessageText(messageText, { // Try to edit original message to text
                    chat_id: chatId, message_id: originalMessageId,
                    reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2'
                });
            } else {
                 await bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' });
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

  const menuMessage = escapeMarkdownV2('🛍️ Mod Store 🛍️\nBrowse user-trained Mods:');
  
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
    parse_mode: 'MarkdownV2'
  };

  try {
    await bot.editMessageText(menuMessage, {
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
  const { logger, internalApiClient } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  logger.info(`[ModsMenuManager] Displaying Store Mods. Filter: ${filterType}, Checkpoint: ${currentCheckpoint}, Page: ${currentPage}, MAID: ${masterAccountId}`);

  // Sanitize/Beautify filterType for display
  let displayFilterName = filterType.charAt(0).toUpperCase() + filterType.slice(1);
  if (filterType === 'price') displayFilterName = 'By Price';
  if (filterType === 'tag') displayFilterName = 'By Tag'; // This will likely need a sub-menu for selecting tags

  let title = `*${escapeMarkdownV2(displayFilterName)} Store Mods*`;
  if (currentCheckpoint !== 'All') {
    title += ` ${escapeMarkdownV2(`(Checkpoint: ${currentCheckpoint})`)}`;
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
_${escapeMarkdownV2('Fetching Mods from the store...')}_
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
    logger.info(`[ModsMenuManager] Calling /loras/store/list with params: ${queryParams}`);
    const response = await internalApiClient.get(`/loras/store/list?${queryParams}`);
    const responseData = response.data; // Assuming response.data is { loras: [], pagination: {} }
    
    if (responseData && responseData.loras) {
      const fetchedLoras = responseData.loras;
      totalPages = responseData.pagination.totalPages || 1;
      title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;

      if (fetchedLoras.length > 0) {
        loraListText = ''; 
        fetchedLoras.forEach(lora => {
          const buttonDisplayName = lora.name || lora.slug;
          // Add price to the button text
          const priceText = lora.monetization?.forSale && lora.monetization?.priceUSD ? `(${lora.monetization.priceUSD} pts)` : '(Price N/A)';
          const escapedButtonText = `${escapeMarkdownV2(buttonDisplayName)} ${escapeMarkdownV2(priceText)}`;
          
          // Callback for store detail: mods_store:detail:SLUG_OR_ID:filterType:checkpoint:page
          const detailCallback = `mods_store:detail:${lora.slug || lora._id}:${filterShortcode}:${currentCheckpoint}:${currentPage}`;
          keyboard.push([{ text: escapedButtonText, callback_data: detailCallback }]);
        });
      } else {
        loraListText = `
_${escapeMarkdownV2('No Mods found in the store matching your criteria.')}_
`;
      }
    } else {
      logger.warn('[ModsMenuManager] Invalid response structure from store loras API (or placeholder error).');
      loraListText = `
_${escapeMarkdownV2('Error: Could not parse Mod list from server store.')}_
`;
      if (!title.includes('Page ')) {
          title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;
      }
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Store Mods for ${filterType} (CP: ${currentCheckpoint}, Page: ${currentPage}):`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    loraListText = `
_${escapeMarkdownV2('Sorry, there was an error fetching Mods from the store. Please try again.')}_
`;
    if (!title.includes('Page ')) {
        title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;
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
    await bot.editMessageText(fullMessage, {
            chat_id: chatId,
      message_id: messageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'MarkdownV2'
          });
    if (callbackQuery && !callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error(`[ModsMenuManager] Error in displayStoreModsByFilterScreen (Filter: ${filterType}):`, error);
    if (isEdit) {
        logger.info(`[ModsMenuManager] Editing failed for store filter screen (Filter: ${filterType}), attempting to send as new message.`);
        try {
            await bot.sendMessage(chatId, fullMessage, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'MarkdownV2'
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
  const { logger, internalApiClient, loRAPermissionsDb } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const originalMessageId = callbackQuery.message.message_id;

  logger.info(`[ModsMenuManager] Displaying Store Mod Detail. LoRA: ${loraIdentifier}, MAID: ${masterAccountId}`);

  let messageText = `*Mod Store Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Fetching details...')}_`;
  const keyboard = [];
  let photoUrl = null;
  let isOwned = false; // Will be determined by API response or permissions check
  const backFilterShortcode = getFilterShortcode(backFilterType);

  try {
    // Use the existing /loras/:loraIdentifier endpoint. 
    // It should ideally tell us if the MAID owns it, or we might need a separate check.
    // For now, let's assume the API includes enough info or we add a specific `isPurchased` field or similar to its response.
    logger.info(`[ModsMenuManager] Store Detail: Calling /loras/${loraIdentifier}?userId=${masterAccountId}`);
    const response = await internalApiClient.get(`/loras/${loraIdentifier}?userId=${masterAccountId}`);
    const lora = response.data.lora; // Assuming structure { lora: { ... } }
    // The general /loras/:loraIdentifier API returns `isFavorite`. We need `isPurchased` for store context.
    // For now, we'll manually check permissions as a fallback if not directly in lora object.

    if (lora) {
      // Check if user owns this LoRA (has permission)
      const permission = await loRAPermissionsDb.hasAccess(masterAccountId, lora._id);
      isOwned = !!permission;

      let tempName = lora.name || lora.slug;
      let escapedName = escapeMarkdownV2(tempName);
      messageText = `*${escapedName}*\n`;

      if (lora.description) {
        const maxLength = 150;
        const desc = lora.description.length > maxLength ? lora.description.substring(0, maxLength) + '...' : lora.description;
        let escapedDesc = escapeMarkdownV2(desc);
        messageText += `_${escapedDesc}_\n\n`;
      }

      let tempCheckpoint = lora.checkpoint || 'N/A';
      let escapedCheckpoint = escapeMarkdownV2(tempCheckpoint);
      messageText += `*Checkpoint:* ${escapedCheckpoint}\n`;

      if (lora.triggerWords && lora.triggerWords.length > 0) {
        let tempTriggers = lora.triggerWords.join(', ');
        let escapedTriggers = escapeMarkdownV2(tempTriggers);
        messageText += `*Triggers:* \`${escapedTriggers}\`\n`;
      }
      
      const price = lora.monetization?.forSale && lora.monetization?.priceUSD ? lora.monetization.priceUSD : null;
      if (price !== null) {
        messageText += `*Price:* ${escapeMarkdownV2(String(price))} points\n`;
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
        messageText = `\n*Status: Not available for purchase at this moment.*\n`;
      }

      // Display cognates if they exist
      if (lora.cognates && lora.cognates.length > 0) {
        const cognateWords = lora.cognates.map(c => c.word).join(', ');
        const escapedCognates = escapeMarkdownV2(cognateWords);
        messageText += `*Shortcuts:* \`${escapedCognates}\`\n`;
      }

      if (lora.tags && lora.tags.length > 0) {
        let tempTags = lora.tags.slice(0, 5).map(t => t.tag).join(', ');
        logger.debug(`[ModsMenuManager] Raw tags for ${loraIdentifier}: "${tempTags}"`);
        let escapedTags = escapeMarkdownV2(tempTags);
        logger.debug(`[ModsMenuManager] Escaped tags for ${loraIdentifier}: "${escapedTags}"`);
        messageText += `*Tags:* _${escapedTags}_\n`;
      }

      if (lora.defaultWeight) {
        let tempWeight = String(lora.defaultWeight);
        logger.debug(`[ModsMenuManager] Raw weight for ${loraIdentifier}: "${tempWeight}"`);
        let escapedWeight = escapeMarkdownV2(tempWeight);
        logger.debug(`[ModsMenuManager] Escaped weight for ${loraIdentifier}: "${escapedWeight}"`);
        messageText += `*Default Weight:* ${escapedWeight}\n`;
      }

    } else {
      messageText = `*Mod Store Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Could not find details for this Mod.')}_`;
    }
  } catch (apiError) {
    logger.error(`[ModsMenuManager] API Error fetching Store Mod detail for ${loraIdentifier}:`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    messageText = `*Mod Store Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Sorry, there was an error fetching details.')}_`;
    if (apiError.response && apiError.response.status === 404) {
      messageText = `*Mod Store Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('This Mod could not be found in the store.')}_`;
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
          await bot.editMessageMedia(
            { type: 'photo', media: photoUrl, caption: messageText, parse_mode: 'MarkdownV2' },
            { chat_id: chatId, message_id: originalMessageId, reply_markup: { inline_keyboard: keyboard } }
          );
        } catch (editMediaError) {
          logger.warn(`[ModsMenuManager] Store Detail editMessageMedia failed: ${editMediaError.message}. Trying caption or new.`);
          if (originalMessageWasPhoto) {
            try {
              await bot.editMessageCaption(messageText, {
                chat_id: chatId, message_id: originalMessageId,
                reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2'
              });
            } catch (editCaptionError) {
              logger.warn(`[ModsMenuManager] Store Detail editMessageCaption failed: ${editCaptionError.message}. Sending new photo.`);
              await bot.sendPhoto(chatId, photoUrl, { caption: messageText, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
            }
          } else { 
            logger.warn(`[ModsMenuManager] Store Detail: Original was text, editMessageMedia failed. Sending new photo.`);
            await bot.sendPhoto(chatId, photoUrl, { caption: messageText, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
          }
        }
      } else { 
        try {
          await bot.editMessageText(messageText, {
            chat_id: chatId, message_id: originalMessageId,
            reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2'
          });
        } catch (editTextError) {
          logger.warn(`[ModsMenuManager] Store Detail editMessageText failed: ${editTextError.message}. Sending new text message.`);
          await bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' });
        }
      }
    } else { 
      if (photoUrl) {
        await bot.sendPhoto(chatId, photoUrl, { caption: messageText, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
      } else {
        await bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' });
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
                 await bot.editMessageText(messageText, { 
                    chat_id: chatId, message_id: originalMessageId,
                    reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2'
                });
            } else {
                 await bot.sendMessage(chatId, messageText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' });
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

    const text = `*Admin Menu for Mod* \\(ID: \`${loraId}\`\\)`;
    const keyboard = [
        [{ text: '❌ Delete Mod', callback_data: `mods:admin_delete_confirm:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}` }],
        // Placeholder for edit button
        [{ text: '✏️ Edit Details (Not Implemented)', callback_data: 'mods:admin_edit_nyi' }],
        [{ text: 'Back to Mod Detail', callback_data: `mods:detail:${loraId}:${backFilterShortcode}:${backCheckpoint}:${backPage}`}]
    ];

    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: keyboard }
        });
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch(error) {
        logger.error(`[ModsMenuManager] Error displaying admin menu for Mod ${loraId}:`, error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error showing admin menu.', show_alert: true });
  }
}

// TODO: Implement other display functions:
// displayModDetail(bot, messageOrQuery, masterAccountId, loraSlug, dependencies, isEdit = false)
// handleFavoriteLora(bot, callbackQuery, masterAccountId, loraSlug, dependencies)
// handleRateLora(bot, callbackQuery, masterAccountId, loraSlug, rating, dependencies)
// promptLoraRequest(bot, messageOrQuery, masterAccountId, dependencies, isEdit = false)
// handleLoraRequestReply(bot, message, masterAccountId, dependencies) - for message listener

module.exports = {
  handleModsCommand,
  handleModsCallback,
  displayModsMainMenu,
  displayModsByFilterScreen,
  displayModDetailScreen,
  displayModsStoreMainMenu,
  displayStoreModsByFilterScreen,
  displayStoreModDetailScreen
}; 