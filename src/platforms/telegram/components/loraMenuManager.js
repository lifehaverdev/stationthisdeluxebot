/**
 * LoRA Menu Manager for Telegram
 * 
 * Handles the display and interaction logic for LoRA-related menus.
 */

// Dependencies will be passed in by the main bot.js, typically including:
// bot, logger, internalApiClient, userSettingsService, toolRegistry (if needed)

const AVAILABLE_CHECKPOINTS = ['All', 'SDXL', 'SD1.5', 'FLUX']; // Example, could be dynamic
const { ObjectId } = require('../../../core/services/db/BaseDB');
// Placeholder for internalApiClient if needed directly, or pass via dependencies
// const internalApiClient = require('../../../utils/internalApiClient'); 
const { escapeMarkdownV2 } = require('../../../utils/stringUtils'); // ADDED

// const MAX_LORAS_PER_PAGE = 5; // Default, can be overridden by API call

/**
 * Handles the /loras command.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} message - The incoming message object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies (logger, internalApiClient, etc.).
 */
async function handleLoraCommand(bot, message, masterAccountId, dependencies) {
  const { logger } = dependencies;
  logger.info(`[LoraMenuManager] /loras command received from MAID: ${masterAccountId}`);
  await displayLoraMainMenu(bot, message, masterAccountId, dependencies, false);
}

/**
 * Handles callback queries for LoRA menus.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 */
async function handleLoraCallback(bot, callbackQuery, masterAccountId, dependencies) {
  const { logger, internalApiClient } = dependencies;
  const data = callbackQuery.data;
  const [action, ...params] = data.split(':');

  logger.info(`[LoraMenuManager] handleLoraCallback received: ${data} from MAID: ${masterAccountId}`);

  try {
    if (action === 'lora') {
      const subAction = params[0];
      if (subAction === 'main_menu') {
        await displayLoraMainMenu(bot, callbackQuery, masterAccountId, dependencies, true);
      } else if (subAction === 'category') {
        const [filterType, checkpoint, pageStr] = params.slice(1);
        const page = parseInt(pageStr, 10) || 1;
        await displayLorasByFilterScreen(bot, callbackQuery, masterAccountId, dependencies, true, filterType, checkpoint, page);
      } else if (subAction === 'detail') {
        const [loraIdentifier, backFilterType, backCheckpoint, backPageStr] = params.slice(1);
        const backPage = parseInt(backPageStr, 10) || 1;
        await displayLoraDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifier, backFilterType, backCheckpoint, backPage);
      } else if (subAction === 'toggle_favorite') {
        const [loraId, currentFavoriteStatusStr, loraIdentifierForRefresh, backFilterType, backCheckpoint, backPageStr] = params.slice(1);
        const isCurrentlyFavorite = currentFavoriteStatusStr === 'true';
        const backPage = parseInt(backPageStr, 10) || 1;

        logger.info(`[LoraMenuManager] Toggling favorite for LoRA ID: ${loraId}, Current Status: ${isCurrentlyFavorite}, MAID: ${masterAccountId}`);
        try {
          if (isCurrentlyFavorite) {
            // Corrected API path for DELETE
            await internalApiClient.delete(`/users/${masterAccountId}/preferences/lora-favorites/${loraId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Removed from favorites ❤️' });
          } else {
            // Corrected API path for POST
            await internalApiClient.post(`/users/${masterAccountId}/preferences/lora-favorites`, { loraId });
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Added to favorites! 💔' });
          }
          // Refresh the detail screen to show updated status
          // Ensure loraIdentifierForRefresh is the slug or ID originally used to view the detail
          await displayLoraDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifierForRefresh, backFilterType, backCheckpoint, backPage);
        } catch (favError) {
          logger.error(`[LoraMenuManager] Error toggling favorite for LoRA ${loraId}:`, favError.response ? favError.response.data : favError.message);
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error updating favorites.', show_alert: true });
        }
        return; // Callback handled, no further processing needed here for this branch
      } else if (subAction === 'set_checkpoint_main') {
        // This was for a global checkpoint setting on main menu, which we are not using for now
        // Instead, checkpoint is per category view. If needed, can re-implement userSettingsService part.
        logger.warn('[LoraMenuManager] set_checkpoint_main action is deprecated.');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Filter by checkpoint within categories.' });
      } else {
        logger.warn(`[LoraMenuManager] Unknown lora subAction: ${subAction}`);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action.' });
      }
    } else {
      logger.warn(`[LoraMenuManager] Unknown action prefix: ${action}`);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown command.' });
    }
  } catch (error) {
    logger.error(`[LoraMenuManager] Error in handleLoraCallback (data: ${data}):`, error);
    try {
      if (!callbackQuery.answered) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error processing your request.', show_alert: true });
      }
    } catch (ackError) {
      logger.error('[LoraMenuManager] FATAL: Could not even acknowledge callback query after error:', ackError);
    }
  }
}

/**
 * Displays the main LoRA categories menu.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} messageOrQuery - The incoming message or callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 * @param {boolean} isEdit - Whether to edit an existing message or send a new one.
 */
async function displayLoraMainMenu(bot, messageOrQuery, masterAccountId, dependencies, isEdit = false) {
  const { logger } = dependencies;
  const chatId = isEdit ? messageOrQuery.message.chat.id : messageOrQuery.chat.id;
  const messageId = isEdit ? messageOrQuery.message.message_id : null;

  const menuMessage = escapeMarkdownV2('LoRA Categories 🎨\nSelect a category to explore:');
  
  const inlineKeyboard = [
    [{ text: '😹 Memes', callback_data: 'lora:category:type_meme:All:1' }],
    [
      { text: '🎭 Character', callback_data: 'lora:category:type_character:All:1' },
      { text: '🖼 Style', callback_data: 'lora:category:type_style:All:1' }
    ],
    [
      { text: '🔥 Popular', callback_data: 'lora:category:popular:All:1' },
      { text: '⏳ Recent', callback_data: 'lora:category:recent:All:1' }
    ],
    [{ text: '💖 Favorites', callback_data: 'lora:category:favorites:All:1' }],
    [{ text: '📝 Request Model', callback_data: 'lora:request_form' }],
    [{ text: 'NVM', callback_data: 'lora:nvm' }]
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
    logger.error(`[LoraMenuManager] Error in displayLoraMainMenu (MAID: ${masterAccountId}):`, error.response ? error.response.data : error.message, error.stack);
    if (isEdit && !messageOrQuery.answered) {
        await bot.answerCallbackQuery(messageOrQuery.id, {text: "Error showing LoRA menu.", show_alert: true});
    } else if (!isEdit) {
        await bot.sendMessage(chatId, "Sorry, couldn't open the LoRA menu right now.");
    }
  }
}

/**
 * Displays LoRAs based on a filter type (category, popular, recent) and checkpoint.
 * @param {Object} bot
 * @param {Object} callbackQuery
 * @param {string} masterAccountId
 * @param {Object} dependencies
 * @param {boolean} isEdit
 * @param {string} filterType - e.g., 'type_meme', 'popular', 'recent'
 * @param {string} currentCheckpoint - e.g., 'All', 'SDXL', 'SD1.5'
 * @param {number} currentPage - e.g., 1
 */
async function displayLorasByFilterScreen(bot, callbackQuery, masterAccountId, dependencies, isEdit, filterType, currentCheckpoint, currentPage) {
  const { logger, internalApiClient } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  // Sanitize/Beautify filterType for display
  let displayFilterName = filterType.replace(/^type_/, '');
  displayFilterName = displayFilterName.charAt(0).toUpperCase() + displayFilterName.slice(1);

  let title = `*${escapeMarkdownV2(displayFilterName)} LoRAs*`;
  if (currentCheckpoint !== 'All') {
    title += ` (Checkpoint: ${escapeMarkdownV2(currentCheckpoint)})`;
  }
  // Page number will be added after fetching data and totalPages is known, if showing list

  const keyboard = [];

  // Checkpoint filter buttons
  const checkpointButtons = AVAILABLE_CHECKPOINTS.map(cp => ({
    text: (cp === currentCheckpoint ? `✅ ${cp}` : cp),
    callback_data: `lora:category:${filterType}:${cp}:1` // Reset to page 1 on checkpoint change
  })); 
  keyboard.push(checkpointButtons);

  let loraListText = '\n_Fetching LoRAs..._\n';
  let totalPages = 1;

  const queryParams = new URLSearchParams({
    filterType: filterType,
    checkpoint: currentCheckpoint,
    page: currentPage.toString(),
    limit: '5', // Let's use a smaller limit for Telegram inline menus
    userId: masterAccountId // For potential permissioning/favorites in future API versions
  }).toString();

  try {
    logger.info(`[LoraMenuManager] Calling /loras/list with params: ${queryParams}`);
    const response = await internalApiClient.get(`/loras/list?${queryParams}`);
    const responseData = response.data; // Assuming response.data is the object { loras: [], pagination: {} }
    
    if (responseData && responseData.loras) {
      const fetchedLoras = responseData.loras;
      totalPages = responseData.pagination.totalPages || 1;
      title += ` - Page ${currentPage}/${totalPages}`;
      title = escapeMarkdownV2(title);

      if (fetchedLoras.length > 0) {
        loraListText = '\n'; // Reset placeholder
        fetchedLoras.forEach(lora => {
          // Using name for display, slug for callback
          const displayName = escapeMarkdownV2(lora.name || lora.slug);
          // Callback for detail: lora:detail:SLUG_OR_ID:filterType:checkpoint:page
          const detailCallback = `lora:detail:${lora.slug || lora._id}:${filterType}:${currentCheckpoint}:${currentPage}`;
          keyboard.push([{ text: displayName, callback_data: detailCallback }]);
        });
      } else {
        loraListText = '\n_No LoRAs found matching your criteria._\n';
      }
    } else {
      logger.warn('[LoraMenuManager] Invalid response structure from loras API:', responseData);
      loraListText = '\n_Error: Could not parse LoRA list from server._\n';
      title += ` - Page ${currentPage}/${totalPages}`;
      title = escapeMarkdownV2(title);
    }
  } catch (apiError) {
    logger.error(`[LoraMenuManager] API Error fetching LoRAs for ${filterType} (Checkpoint: ${currentCheckpoint}, Page: ${currentPage}):`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    loraListText = '\n_Sorry, there was an error fetching the LoRAs. Please try again later._\n';
    title += ` - Page ${currentPage}/${totalPages}`;
    title = escapeMarkdownV2(title);
  }

  const navigationRow = [];
  if (currentPage > 1) {
    navigationRow.push({ text: '◀️ Prev', callback_data: `lora:category:${filterType}:${currentCheckpoint}:${currentPage - 1}` });
  }
  navigationRow.push({ text: 'Back to Categories', callback_data: 'lora:main_menu' });
  if (currentPage < totalPages) { 
    navigationRow.push({ text: 'Next ▶️', callback_data: `lora:category:${filterType}:${currentCheckpoint}:${currentPage + 1}` });
  }
  if (navigationRow.length > 0) {
      keyboard.push(navigationRow);
  }

  const fullMessage = `${title}${loraListText}`;

  try {
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
    logger.error(`[LoraMenuManager] Error in displayLorasByFilterScreen (Filter: ${filterType}):`, error);
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating LoRA list.", show_alert: true});
    }
  }
}

/**
 * Displays the detailed screen for a single LoRA.
 */
async function displayLoraDetailScreen(bot, callbackQuery, masterAccountId, dependencies, isEdit, loraIdentifier, backFilterType, backCheckpoint, backPage) {
  const { logger, internalApiClient } = dependencies;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  let messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_Fetching details..._`;
  const keyboard = [];
  let photoUrl = null; // For sending a photo with caption

  try {
    logger.info(`[LoraMenuManager] Calling /loras/${loraIdentifier} with userId: ${masterAccountId}`);
    const response = await internalApiClient.get(`/loras/${loraIdentifier}?userId=${masterAccountId}`);
    const lora = response.data.lora; // Expecting { lora: { ...details } }

    if (lora) {
      messageText = `*${escapeMarkdownV2(lora.name || lora.slug)}*\n`;
      if (lora.description) {
        // Truncate description for Telegram, append ... if too long
        const maxLength = 150;
        const desc = lora.description.length > maxLength ? lora.description.substring(0, maxLength) + '...' : lora.description;
        messageText += `_${escapeMarkdownV2(desc)}_\n\n`;
      }
      messageText += `*Checkpoint:* ${escapeMarkdownV2(lora.checkpoint || 'N/A')}\n`;
      if (lora.triggerWords && lora.triggerWords.length > 0) {
        messageText += `*Triggers:* \`${escapeMarkdownV2(lora.triggerWords.join(', '))}\`\n`;
      }
      if (lora.tags && lora.tags.length > 0) {
        messageText += `*Tags:* _${escapeMarkdownV2(lora.tags.slice(0, 5).map(t => t.tag).join(', '))}_\n`; // Show first 5 tags
      }
      if (lora.defaultWeight) {
        messageText += `*Default Weight:* ${escapeMarkdownV2(String(lora.defaultWeight))}\n`;
      }
      if (lora.previewImages && lora.previewImages.length > 0) {
        photoUrl = lora.previewImages[0]; // Use the first preview image
        // The messageText will become the caption if a photo is sent
      }

      // Favorite button using lora.isFavorite and lora._id (MongoDB ID)
      // Callback needs to include all info to refresh: lora:toggle_favorite:LORA_MONGO_ID:IS_FAVORITE_STATUS:LORA_IDENTIFIER_FOR_REFRESH:BACK_FILTER:BACK_CHECKPOINT:BACK_PAGE
      const toggleFavoriteCallback = `lora:toggle_favorite:${lora._id}:${lora.isFavorite}:${loraIdentifier}:${backFilterType}:${backCheckpoint}:${backPage}`;
      keyboard.push([{
         text: (lora.isFavorite ? '💔 Unfavorite' : '❤️ Favorite'), callback_data: toggleFavoriteCallback
      }]);

    } else {
      messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_Could not find details for this LoRA._`;
    }

  } catch (apiError) {
    logger.error(`[LoraMenuManager] API Error fetching LoRA detail for ${loraIdentifier}:`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_Sorry, there was an error fetching details. Please try again later._`;
    if (apiError.response && apiError.response.status === 404) {
      messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_This LoRA could not be found._`;
    }
  }

  // Back button
  keyboard.push([{ text: '◀️ Back to List', callback_data: `lora:category:${backFilterType}:${backCheckpoint}:${backPage}` }]);
  
  try {
    // Telegram specific: If we have a photoUrl, we must send a new message or edit caption of existing if it was a photo.
    // Editing message text to a photo (or vice-versa) is not directly supported.
    // For simplicity, we will always edit the text message. If a photo needs to be shown, it should be handled
    // by sending a new message and deleting the old one, or by ensuring the placeholder message is already a photo message.
    // Current approach: if photoUrl exists, send a new photo message and delete the old text message. If not, edit text.

    if (isEdit && photoUrl) {
      // Ideal: bot.editMessageMedia + bot.editMessageCaption. Simpler: delete + send new.
      await bot.deleteMessage(chatId, messageId).catch(delErr => logger.warn('[LoraMenuManager] Could not delete old message for photo detail view:', delErr.message));
      await bot.sendPhoto(chatId, photoUrl, {
        caption: messageText,
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else if (photoUrl) { // New message, send photo
      await bot.sendPhoto(chatId, photoUrl, {
        caption: messageText,
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else { // No photo, just edit or send text
      if (isEdit) {
        await bot.editMessageText(messageText, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'MarkdownV2'
        });
      } else {
        await bot.sendMessage(chatId, messageText, {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'MarkdownV2'
        });
      }
    }

    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error(`[LoraMenuManager] Error in displayLoraDetailScreen (Identifier: ${loraIdentifier}):`, error.response ? error.response.data : error.message, error.stack);
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating LoRA detail.", show_alert: true});
    }
  }
}

// TODO: Implement other display functions:
// displayLoraDetail(bot, messageOrQuery, masterAccountId, loraSlug, dependencies, isEdit = false)
// handleFavoriteLora(bot, callbackQuery, masterAccountId, loraSlug, dependencies)
// handleRateLora(bot, callbackQuery, masterAccountId, loraSlug, rating, dependencies)
// promptLoraRequest(bot, messageOrQuery, masterAccountId, dependencies, isEdit = false)
// handleLoraRequestReply(bot, message, masterAccountId, dependencies) - for message listener

module.exports = {
  handleLoraCommand,
  handleLoraCallback,
  displayLoraMainMenu,
  displayLorasByFilterScreen,
  displayLoraDetailScreen
}; 