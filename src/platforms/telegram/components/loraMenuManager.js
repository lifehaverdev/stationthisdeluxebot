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
const fs = require('fs');
const path = require('path');

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
        // New structure: IS_FAVORITE_STATUS:LORA_IDENTIFIER_FOR_REFRESH:BACK_FILTER:BACK_CHECKPOINT:BACK_PAGE
        const [currentFavoriteStatusStr, loraIdentifierForRefresh, backFilterType, backCheckpoint, backPageStr] = params;
        const isCurrentlyFavorite = currentFavoriteStatusStr === 'true';
        const backPage = parseInt(backPageStr, 10) || 1;

        logger.info(`[LoraMenuManager] Toggling favorite for LoRA (slug: ${loraIdentifierForRefresh}), Current Status: ${isCurrentlyFavorite}, MAID: ${masterAccountId}`);
        
        let loraMongoId = null;
        try {
          // Fetch LoRA details to get its MongoDB _id using the slug (loraIdentifierForRefresh)
          logger.debug(`[LoraMenuManager] Fetching LoRA details for ${loraIdentifierForRefresh} to get _id for favorite toggle.`);
          const loraDetailResponse = await internalApiClient.get(`/loras/${loraIdentifierForRefresh}?userId=${masterAccountId}`);
          if (loraDetailResponse.data && loraDetailResponse.data.lora && loraDetailResponse.data.lora._id) {
            loraMongoId = loraDetailResponse.data.lora._id;
            logger.debug(`[LoraMenuManager] Found _id: ${loraMongoId} for slug: ${loraIdentifierForRefresh}`);
          } else {
            throw new Error('Could not fetch LoRA _id for favorite toggle.');
          }
        } catch (fetchIdError) {
          logger.error(`[LoraMenuManager] Error fetching LoRA _id for slug ${loraIdentifierForRefresh} to toggle favorite:`, {
            errorMsg: fetchIdError.message, errorResponse: fetchIdError.response ? fetchIdError.response.data : null, errorCode: fetchIdError.code, fullError: JSON.stringify(fetchIdError, Object.getOwnPropertyNames(fetchIdError)), stack: fetchIdError.stack
          });
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error: Could not identify LoRA for favorite action.', show_alert: true });
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
          await displayLoraDetailScreen(bot, callbackQuery, masterAccountId, dependencies, true, loraIdentifierForRefresh, backFilterType, backCheckpoint, backPage);
        } catch (favError) {
          logger.error(`[LoraMenuManager] Error toggling favorite for LoRA _id ${loraMongoId}:`, {
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
        logger.warn('[LoraMenuManager] set_checkpoint_main action is deprecated.');
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Filter by checkpoint within categories.' });
      } else if (subAction === 'nvm') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🙂‍↕️🤫' });
        await bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
        return;
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
    [{ text: "Ⓧ", callback_data: 'lora:nvm' }]
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
  let messageId = callbackQuery.message.message_id; // Can be modified if we delete and resend

  // --- Request 2: Fix "Return to Menu" from Photo Detail View ---
  if (isEdit && callbackQuery.message.photo && callbackQuery.message.photo.length > 0) {
    logger.debug(`[LoraMenuManager] displayLorasByFilterScreen: Callback is from a photo message (ID: ${messageId}). Deleting it and sending new category list.`);
    try {
      await bot.deleteMessage(chatId, messageId);
      logger.debug(`[LoraMenuManager] Deleted photo message ${messageId} to display category list.`);
    } catch (deleteError) {
      logger.warn(`[LoraMenuManager] Failed to delete photo message ${messageId} when going back to category list:`, deleteError.message);
      // Continue, but isEdit might lead to an error if the message is already gone.
      // Forcing isEdit to false ensures a new message.
    }
    isEdit = false; // Force sending a new message for the category list
  }
  // --- End Request 2 ---

  // Sanitize/Beautify filterType for display
  let displayFilterName = filterType.replace(/^type_/, '');
  displayFilterName = displayFilterName.charAt(0).toUpperCase() + displayFilterName.slice(1);

  // Corrected title construction: Escape dynamic parts individually, build string.
  let title = `*${escapeMarkdownV2(displayFilterName)} LoRAs*`;
  if (currentCheckpoint !== 'All') {
    // Revert the diagnostic change and ensure parentheses are properly escaped
    title += ` ${escapeMarkdownV2(`(Checkpoint: ${currentCheckpoint})`)}`;
  }

  const keyboard = [];

  // Checkpoint filter buttons
  const checkpointButtons = AVAILABLE_CHECKPOINTS.map(cp => ({
    text: (cp === currentCheckpoint ? `✅ ${cp}` : cp),
    callback_data: `lora:category:${filterType}:${cp}:1` // Reset to page 1 on checkpoint change
  })); 
  keyboard.push(checkpointButtons);

  let loraListText = `\n_${escapeMarkdownV2('Fetching LoRAs...')}_\n`;
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
      title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;

      if (fetchedLoras.length > 0) {
        loraListText = '\n'; // Reset placeholder
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
          // Callback for detail: lora:detail:SLUG_OR_ID:filterType:checkpoint:page
          const detailCallback = `lora:detail:${lora.slug || lora._id}:${filterType}:${currentCheckpoint}:${currentPage}`;
          keyboard.push([{ text: escapedButtonText, callback_data: detailCallback }]);
        });
      } else {
        loraListText = `\n_${escapeMarkdownV2('No LoRAs found matching your criteria.')}_\n`;
      }
    } else {
      logger.warn('[LoraMenuManager] Invalid response structure from loras API:', responseData);
      loraListText = `\n_${escapeMarkdownV2('Error: Could not parse LoRA list from server.')}_\n`;
      if (!title.includes('Page ')) {
          title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;
      }
    }
  } catch (apiError) {
    logger.error(`[LoraMenuManager] API Error fetching LoRAs for ${filterType} (Checkpoint: ${currentCheckpoint}, Page: ${currentPage}):`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    loraListText = `\n_${escapeMarkdownV2('Sorry, there was an error fetching the LoRAs. Please try again later.')}_\n`;
    if (!title.includes('Page ')) {
        title += ` ${escapeMarkdownV2('-')} Page ${currentPage}/${totalPages}`;
    }
  }

  const navigationRow = [];
  if (currentPage > 1) {
    navigationRow.push({ text: "⇤", callback_data: `lora:category:${filterType}:${currentCheckpoint}:${currentPage - 1}` });
  }
  navigationRow.push({ text: "⇱", callback_data: 'lora:main_menu' });
  if (currentPage < totalPages) { 
    navigationRow.push({ text: "⇥", callback_data: `lora:category:${filterType}:${currentCheckpoint}:${currentPage + 1}` });
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
  const originalMessageId = callbackQuery.message.message_id; // Store original message ID for editing/deleting

  let messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Fetching details...')}_`;
  const keyboard = [];
  let photoUrl = null; // For sending a photo with caption

  try {
    logger.info(`[LoraMenuManager] Calling /loras/${loraIdentifier} with userId: ${masterAccountId}`);
    const response = await internalApiClient.get(`/loras/${loraIdentifier}?userId=${masterAccountId}`);
    const lora = response.data.lora; // Expecting { lora: { ...details } }
    logger.debug(`[LoraMenuManager] Fetched LoRA details for ${loraIdentifier}:`, JSON.stringify(lora, null, 2));

    if (lora) {
      let tempName = lora.name || lora.slug;
      logger.debug(`[LoraMenuManager] Raw name/slug for ${loraIdentifier}: "${tempName}"`);
      let escapedName = escapeMarkdownV2(tempName);
      logger.debug(`[LoraMenuManager] Escaped name/slug for ${loraIdentifier}: "${escapedName}"`);
      messageText = `*${escapedName}*\n`;

      if (lora.description) {
        // Truncate description for Telegram, append ... if too long
        const maxLength = 150;
        const desc = lora.description.length > maxLength ? lora.description.substring(0, maxLength) + '...' : lora.description;
        logger.debug(`[LoraMenuManager] Raw description for ${loraIdentifier}: "${desc}"`);
        let escapedDesc = escapeMarkdownV2(desc);
        logger.debug(`[LoraMenuManager] Escaped description for ${loraIdentifier}: "${escapedDesc}"`);
        messageText += `_${escapedDesc}_\n\n`;
      }

      let tempCheckpoint = lora.checkpoint || 'N/A';
      logger.debug(`[LoraMenuManager] Raw checkpoint for ${loraIdentifier}: "${tempCheckpoint}"`);
      let escapedCheckpoint = escapeMarkdownV2(tempCheckpoint);
      logger.debug(`[LoraMenuManager] Escaped checkpoint for ${loraIdentifier}: "${escapedCheckpoint}"`);
      messageText += `*Checkpoint:* ${escapedCheckpoint}\n`;

      if (lora.triggerWords && lora.triggerWords.length > 0) {
        let tempTriggers = lora.triggerWords.join(', ');
        logger.debug(`[LoraMenuManager] Raw triggers for ${loraIdentifier}: "${tempTriggers}"`);
        let escapedTriggers = escapeMarkdownV2(tempTriggers);
        logger.debug(`[LoraMenuManager] Escaped triggers for ${loraIdentifier}: "${escapedTriggers}"`);
        messageText += `*Triggers:* \`${escapedTriggers}\`\n`;
      }

      if (lora.tags && lora.tags.length > 0) {
        let tempTags = lora.tags.slice(0, 5).map(t => t.tag).join(', ');
        logger.debug(`[LoraMenuManager] Raw tags for ${loraIdentifier}: "${tempTags}"`);
        let escapedTags = escapeMarkdownV2(tempTags);
        logger.debug(`[LoraMenuManager] Escaped tags for ${loraIdentifier}: "${escapedTags}"`);
        messageText += `*Tags:* _${escapedTags}_\n`;
      }

      if (lora.defaultWeight) {
        let tempWeight = String(lora.defaultWeight);
        logger.debug(`[LoraMenuManager] Raw weight for ${loraIdentifier}: "${tempWeight}"`);
        let escapedWeight = escapeMarkdownV2(tempWeight);
        logger.debug(`[LoraMenuManager] Escaped weight for ${loraIdentifier}: "${escapedWeight}"`);
        messageText += `*Default Weight:* ${escapedWeight}\n`;
      }

      if (lora.previewImages && lora.previewImages.length > 0) {
        photoUrl = lora.previewImages[0]; // Use the first preview image
        logger.debug(`[LoraMenuManager] Photo URL for ${loraIdentifier}: ${photoUrl}`);
        // The messageText will become the caption if a photo is sent
      }

      // Favorite button using lora.isFavorite and lora._id (MongoDB ID)
      // Callback needs to include all info to refresh: lora:toggle_favorite:IS_FAVORITE_STATUS:LORA_IDENTIFIER_FOR_REFRESH:BACK_FILTER:BACK_CHECKPOINT:BACK_PAGE
      // loraIdentifier is the slug, which will be used to re-fetch the _id if needed by the handler.
      const toggleFavoriteCallback = `lora:toggle_favorite:${lora.isFavorite}:${loraIdentifier}:${backFilterType}:${backCheckpoint}:${backPage}`;
      keyboard.push([{
         text: (lora.isFavorite ? '💔 Unfavorite' : '❤️ Favorite'), callback_data: toggleFavoriteCallback
      }]);

    } else {
      messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Could not find details for this LoRA.')}_`;
    }

  } catch (apiError) {
    logger.error(`[LoraMenuManager] API Error fetching LoRA detail for ${loraIdentifier}:`, apiError.response ? apiError.response.data : apiError.message, apiError.stack);
    messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('Sorry, there was an error fetching details. Please try again later.')}_`;
    if (apiError.response && apiError.response.status === 404) {
      messageText = `*LoRA Detail: ${escapeMarkdownV2(loraIdentifier)}*\n\n_${escapeMarkdownV2('This LoRA could not be found.')}_`;
    }
  }

  // Back button
  keyboard.push([{ text: "⇱", callback_data: `lora:category:${backFilterType}:${backCheckpoint}:${backPage}` }]);
  
  logger.debug(`[LoraMenuManager] Attempting to display LoRA detail for ${loraIdentifier}. Message text before sending/editing:\n${messageText}`);
  logger.debug(`[LoraMenuManager] Keyboard for ${loraIdentifier}:`, JSON.stringify(keyboard, null, 2));

  try {
    let photoAttemptedAndFailed = false;
    let newPhotoMessageSent = false; // Track if a new photo message replaced the old one

    if (photoUrl) {
      let photoDisplayedSuccessfully = false; // Renamed from photoSentSuccessfully for clarity

      if (isEdit && photoUrl.startsWith('http')) {
        logger.debug(`[LoraMenuManager] Mode: Edit message - Attempting to change to HTTP photo for ${loraIdentifier}`);
        try {
          await bot.editMessageMedia(
            { type: 'photo', media: photoUrl, caption: messageText, parse_mode: 'MarkdownV2' },
            { chat_id: chatId, message_id: originalMessageId, reply_markup: { inline_keyboard: keyboard } }
          );
          logger.debug(`[LoraMenuManager] Message ${originalMessageId} edited to HTTP photo successfully for ${loraIdentifier}`);
          photoDisplayedSuccessfully = true;
        } catch (editMediaError) {
          logger.warn(`[LoraMenuManager] Failed to edit message ${originalMessageId} to HTTP photo for ${loraIdentifier}. URL: ${photoUrl}. Error:`, {
            errorMsg: editMediaError.message,
            errorResponse: editMediaError.response ? editMediaError.response.body || editMediaError.response.data : null,
            errorCode: editMediaError.code,
            fullError: JSON.stringify(editMediaError, Object.getOwnPropertyNames(editMediaError)),
            stack: editMediaError.stack
          });
          photoAttemptedAndFailed = true; // Fallback to text edit on original message
        }
      } else if (!photoUrl.startsWith('http')) { // Local file path, send as new, delete old if isEdit
        try {
          const localPhotoPath = path.resolve(__dirname, '../../../../', photoUrl);
          logger.debug(`[LoraMenuManager] Attempting to read local photo for ${loraIdentifier}: ${localPhotoPath}`);
          const photoBuffer = fs.readFileSync(localPhotoPath);

          if (isEdit) {
            logger.debug(`[LoraMenuManager] Mode: Edit (by replacement) - Sending new local photo for ${loraIdentifier}, will delete old message ${originalMessageId} on success.`);
          } else {
            logger.debug(`[LoraMenuManager] Mode: New message - Attempting local photo for ${loraIdentifier}`);
          }

          await bot.sendPhoto(chatId, photoBuffer, {
            caption: messageText,
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: keyboard }
          });
          logger.debug(`[LoraMenuManager] Local photo message sent successfully as new message for ${loraIdentifier}`);
          photoDisplayedSuccessfully = true;
          if (isEdit) {
            try { 
              await bot.deleteMessage(chatId, originalMessageId); 
              logger.debug(`[LoraMenuManager] Original message ${originalMessageId} deleted after new local photo sent.`); 
              newPhotoMessageSent = true; // Mark that original message is gone
            } catch (delErr) { 
              logger.warn(`[LoraMenuManager] Failed to delete original message ${originalMessageId} after sending new local photo:`, delErr.message); 
            }
          }
        } catch (fileOrSendError) {
          logger.warn(`[LoraMenuManager] Error reading or sending local photo ${photoUrl} for ${loraIdentifier}:`, {
            errorMsg: fileOrSendError.message,
            errorResponse: fileOrSendError.response ? fileOrSendError.response.body || fileOrSendError.response.data : null,
            errorCode: fileOrSendError.code,
            fullError: JSON.stringify(fileOrSendError, Object.getOwnPropertyNames(fileOrSendError)),
            stack: fileOrSendError.stack
          });
          photoAttemptedAndFailed = true; // Fallback to text (will try to edit original if !newPhotoMessageSent)
        }
      } else { // HTTP URL but not isEdit (send as new message)
        logger.debug(`[LoraMenuManager] Mode: New message - Attempting HTTP photo for ${loraIdentifier}`);
        try {
          await bot.sendPhoto(chatId, photoUrl, {
            caption: messageText,
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: keyboard }
          });
          logger.debug(`[LoraMenuManager] HTTP photo message sent successfully as new message for ${loraIdentifier}`);
          photoDisplayedSuccessfully = true;
        } catch (sendPhotoError) {
          logger.warn(`[LoraMenuManager] Error sending new HTTP photo message for ${loraIdentifier}. URL: ${photoUrl}. Error:`, {
            errorMsg: sendPhotoError.message,
            errorResponse: sendPhotoError.response ? sendPhotoError.response.body || sendPhotoError.response.data : null,
            errorCode: sendPhotoError.code,
            fullError: JSON.stringify(sendPhotoError, Object.getOwnPropertyNames(sendPhotoError)),
            stack: sendPhotoError.stack
          });
          photoAttemptedAndFailed = true; // Fallback to text (will be a new text message)
        }
      }
      if (!photoDisplayedSuccessfully) photoAttemptedAndFailed = true;
    }

    if (!photoUrl || photoAttemptedAndFailed) {
      // Fallback to text message if photo wasn't applicable, or if photo display failed.
      // If isEdit is true AND a new photo message hasn't already replaced the original message, edit the original.
      // Otherwise, send a new text message.
      if (isEdit && !newPhotoMessageSent) { 
        logger.debug(`[LoraMenuManager] Fallback/Mode: Edit original message ${originalMessageId} to text for ${loraIdentifier}.`);
        try {
          await bot.editMessageText(messageText, {
            chat_id: chatId,
            message_id: originalMessageId, // Edit the original message
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'MarkdownV2'
          });
          logger.debug(`[LoraMenuManager] Text message ${originalMessageId} edited for ${loraIdentifier} (text mode/fallback)`);
        } catch (editError) {
          logger.error(`[LoraMenuManager] Error editing text message ${originalMessageId} for ${loraIdentifier} (text mode/fallback):`, {
            errorMsg: editError.message,
            errorResponse: editError.response ? editError.response.body || editError.response.data : null,
            errorCode: editError.code,
            fullError: JSON.stringify(editError, Object.getOwnPropertyNames(editError)),
            stack: editError.stack
          });
          throw editError; 
        }
      } else if (!isEdit) { // Send new text message if not an edit operation
        logger.debug(`[LoraMenuManager] Mode: New message (text only - original intent) for ${loraIdentifier}`);
        try {
          await bot.sendMessage(chatId, messageText, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'MarkdownV2'
          });
          logger.debug(`[LoraMenuManager] New text message sent for ${loraIdentifier} (original text mode)`);
        } catch (sendError) {
          logger.error(`[LoraMenuManager] Error sending new text message for ${loraIdentifier} (original text mode):`, {
            errorMsg: sendError.message,
            errorResponse: sendError.response ? sendError.response.body || sendError.response.data : null,
            errorCode: sendError.code,
            fullError: JSON.stringify(sendError, Object.getOwnPropertyNames(sendError)),
            stack: sendError.stack
          });
          throw sendError;
        }
      }
      // If isEdit was true, but a newPhotoMessageSent was true, we do nothing here for text, photo took precedence.
    }

    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    // This outer catch now primarily handles errors from the Telegram bot operations if they were re-thrown
    // or any other unexpected errors within this block.
    logger.error(`[LoraMenuManager] Error in displayLoraDetailScreen Telegram operations (Identifier: ${loraIdentifier}):`, {
      errorMsg: error.message,
      errorResponse: error.response ? error.response.body || error.response.data : null,
      errorCode: error.code,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      stack: error.stack
    });
    if (!callbackQuery.answered) {
      try {
        await bot.answerCallbackQuery(callbackQuery.id, {text: "Error updating LoRA detail.", show_alert: true});
      } catch (ackError) {
        logger.error(`[LoraMenuManager] FATAL: Could not acknowledge callback query after Telegram operation error (LoRA: ${loraIdentifier}):`, {
          errorMsg: ackError.message,
          errorResponse: ackError.response ? ackError.response.body || ackError.response.data : null,
          errorCode: ackError.code,
          fullError: JSON.stringify(ackError, Object.getOwnPropertyNames(ackError)),
          stack: ackError.stack
        });
      }
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