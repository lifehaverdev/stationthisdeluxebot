/**
 * Training Menu Manager for Telegram
 * 
 * Handles the display and interaction logic for LoRA training creation and management.
 */

const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

const internalApiClient = require('../../../utils/internalApiClient'); // Use the actual internal API client

// REMOVE mockApiClient
// const mockApiClient = {
//   getUserTrainings: async (userId) => {
//     console.log(`API CALL (Training): Fetching trainings for user ${userId}`);
//     return Promise.resolve([
//       // Example: { _id: 'train_1', name: 'My Character Training', status: 'draft', imageCount: 10, runCount: 1 },
//     ]);
//   },
//   createTraining: async (userId, name, notes = '', allowPublishing = false, tags = []) => {
//     console.log(`API CALL (Training): Creating training for user ${userId} with name ${name}`);
//     const newId = `train_${Date.now().toString()}`;
//     return Promise.resolve({ _id: newId, name, status: 'draft', notes, allowPublishing, tags, images: [], captionSets: [], trainingRuns: [] });
//   },
//   getTrainingDetails: async (trainingId) => {
//     console.log(`API CALL (Training): Fetching details for training ${trainingId}`);
//     return Promise.resolve({ _id: trainingId, name: 'Sample Training', status: 'draft', notes: 'A sample description', allowPublishing: false, tags: ['character'], preferredTrigger: 'samp_trig', images: [], captionSets: [], trainingRuns: [] });
//   },
//   updateTraining: async (trainingId, data) => {
//     console.log(`API CALL (Training): Updating training ${trainingId} with data:`, data);
//     return Promise.resolve({ _id: trainingId, ...data });
//   },
//   deleteTraining: async (trainingId) => {
//     console.log(`API CALL (Training): Deleting training ${trainingId}`);
//     return Promise.resolve({ success: true });
//   },
//   // ... more placeholder API functions for images, captions, runs, status changes etc.
// };

const PROMPT_MARKER_TRAINING_NAME = 'PROMPT_TRAINING_NAME_V1';
const PROMPT_MARKER_TRAINING_IMAGE = 'PROMPT_TRAINING_IMAGE_V1'; // New marker

/**
 * Displays the main LoRA training menu, invoked by /train.
 */
async function showMainTrainingMenu(bot, chatId, messageId, masterAccountId, isEdit = false, dependencies = {}) {
  const { logger = console } = dependencies;
  try {
    // Path updated to /trainings/owner/:masterAccountId
    const response = await internalApiClient.get(`/trainings/owner/${masterAccountId}`);
    const userTrainings = response.data || [];

    const keyboard = [
      [{ text: '➕ Create New Training', callback_data: 'train_create_new' }],
    ];

    if (userTrainings.length > 0) {
      keyboard.push([{ text: '📘 My Trainings', callback_data: 'train_list_mine' }]);
    }
    // TODO: Add a 'Back to Main Menu' or similar if /train is part of a larger settings context

    const text = `🎨 **LoRA Training Hub**

Manage your custom LoRA training sessions here. Use the buttons below to create a new training or view your existing ones.`;

    if (isEdit && messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown',
      });
    } else {
      // If not an edit, or messageId is missing for an edit, send as new message
      await bot.sendMessage(chatId, text, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown',
      });
    }
  } catch (error) {
    logger.error('Error in showMainTrainingMenu:', error);
    await bot.sendMessage(chatId, '⚠️ An error occurred while loading the Training Hub. Please try again later.');
  }
}

/**
 * Handles the callback for 'train_create_new'.
 * Initiates the process of creating a new LoRA training session.
 */
async function handleCreateNewTraining(bot, chatId, messageId, masterAccountId, dependencies = {}) {
  const { logger = console, replyContextManager } = dependencies;
  try {
    // The prompt is now clean and doesn't contain internal markers.
    const text = `📝 **Create New Training**\n\nWhat would you like to name your new LoRA training session?`;
    
    const sentMessage = await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Cancel', callback_data: 'train_main_menu' }]] },
      parse_mode: 'Markdown', // Keep as Markdown for the bolding
    });

    // Store the context for the reply using the new manager
    if (replyContextManager) {
      const context = {
        type: 'training_name_prompt',
        masterAccountId: masterAccountId,
      };
      replyContextManager.addContext(sentMessage, context);
      logger.info(`[TrainingMenu] Stored reply context for 'training_name_prompt' for MAID ${masterAccountId}.`);
    } else {
      logger.error('[TrainingMenu] ReplyContextManager not found in dependencies. Cannot set context for reply.');
    }

  } catch (error) {
    logger.error('Error in handleCreateNewTraining:', error);
    await bot.sendMessage(chatId, '⚠️ An error occurred. Please try again.');
    // Attempt to show main menu again, masterAccountId is available here
    await showMainTrainingMenu(bot, chatId, messageId, masterAccountId, true, dependencies);
  }
}

/**
 * Handles receiving the name for a new LoRA training (called via reply).
 * @param {Object} bot The bot instance.
 * @param {Object} message The user's reply message.
 * @param {string} masterAccountId The Master Account ID of the user.
 * @param {Object} dependencies Shared dependencies { logger }.
 */
async function processNewTrainingName(bot, message, masterAccountId, dependencies = {}) {
  const { logger = console } = dependencies;
  const chatId = message.chat.id;
  const trainingName = message.text.trim();

  if (!trainingName || trainingName.length < 3) {
    await bot.sendMessage(chatId, '⚠️ Name must be at least 3 characters long. Please try again by replying to the prompt above.', { reply_to_message_id: message.message_id });
    return;
  }

  try {
    // Replace mockApiClient.createTraining
    // API endpoint: POST /internal/v1/data/trainings
    // Payload includes masterAccountId
    const createResponse = await internalApiClient.post(`/trainings`, {
      masterAccountId: masterAccountId,
      name: trainingName,
      // Add other default fields for a new training if your API requires them
      // e.g., status: 'draft', notes: '', allowPublishing: false, tags: []
    });
    const newTraining = createResponse.data;

    if (!newTraining || !newTraining._id) {
        logger.error('Failed to create new training or API did not return expected format:', createResponse);
        await bot.sendMessage(chatId, '⚠️ An error occurred: Could not confirm training creation.', { reply_to_message_id: message.message_id });
        return;
    }
    
    await bot.sendMessage(chatId, `✅ Draft training "**${escapeMarkdownV2(newTraining.name)}**" created!`, { parse_mode: 'MarkdownV2', reply_to_message_id: message.message_id });
    // Now show the edit menu for this new training
    await showEditTrainingMenu(bot, chatId, null, masterAccountId, newTraining._id, dependencies); // messageId is null to send new message
  } catch (error) {
    logger.error('Error processing new training name:', error.response ? error.response.data : error.message, error.stack);
    await bot.sendMessage(chatId, '⚠️ An error occurred while creating the training. Please try again.', { reply_to_message_id: message.message_id });
  }
}

/**
 * Displays the list of user's LoRA trainings.
 */
async function showMyTrainingsMenu(bot, chatId, messageId, masterAccountId, dependencies = {}) {
  const { logger = console } = dependencies;
  try {
    // Path updated to /trainings/owner/:masterAccountId
    const response = await internalApiClient.get(`/trainings/owner/${masterAccountId}`);
    const userTrainings = response.data || [];
    const keyboard = [];
    let text = `📘 **My Trainings**

`;

    if (userTrainings.length === 0) {
      text += `You haven't created any training sessions yet.`;
    } else {
      userTrainings.forEach(training => {
        // Make sure training.name is escaped if using MarkdownV2
        const trainingNameText = escapeMarkdownV2(training.name);
        const statusText = escapeMarkdownV2(training.status);
        keyboard.push([{ text: `🔧 ${trainingNameText} (${statusText})`, callback_data: `train_edit_${training._id}` }]);
      });
    }

    keyboard.push([{ text: '⬅️ Back', callback_data: 'train_main_menu' }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: 'MarkdownV2', // Ensure this is MarkdownV2 if using escaped text
    });
  } catch (error) {
    logger.error('Error in showMyTrainingsMenu:', error);
    await bot.sendMessage(chatId, '⚠️ An error occurred. Please try again.');
    await showMainTrainingMenu(bot, chatId, messageId, masterAccountId, true, dependencies);
  }
}

/**
 * Displays the main editing menu for a specific LoRA training.
 */
async function showEditTrainingMenu(bot, chatId, messageId, masterAccountId, trainingId, dependencies = {}) {
  const { logger = console } = dependencies;
  try {
    // Use internalApiClient to get training details, path relative to /internal/v1/data/
    const response = await internalApiClient.get(`/trainings/${trainingId}`);
    const training = response.data;

    if (!training) {
      const notFoundText = '⚠️ Training session not found.';
      if (messageId) {
        await bot.editMessageText(notFoundText, {
          chat_id: chatId, message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to My Trainings', callback_data: 'train_list_mine' }]] }
        });
      } else {
         await bot.sendMessage(chatId, notFoundText, {
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to My Trainings', callback_data: 'train_list_mine' }]] }
        });
      }
      return;
    }

    // Escape all dynamic parts for MarkdownV2
    const trainingName = escapeMarkdownV2(training.name);
    const trainingStatus = escapeMarkdownV2(training.status);
    const trainingNotes = escapeMarkdownV2(training.notes || 'Not set');
    const trainingVisibility = training.allowPublishing ? 'Public' : 'Private';
    const trainingTags = training.tags && training.tags.length > 0 ? escapeMarkdownV2(training.tags.join(', ')) : 'None';
    const trainingTrigger = escapeMarkdownV2(training.preferredTrigger || 'Not set');
    const imageCount = training.images ? training.images.length : 0;
    const captionSetCount = training.captionSets ? training.captionSets.length : 0;
    const trainingRunCount = training.trainingRuns ? training.trainingRuns.length : 0;

    const text = `🛠️ *Editing Training: ${trainingName}* \\(Status: ${trainingStatus}\\)\nDescription: _${trainingNotes}_\nVisibility: ${trainingVisibility}\nTags: ${trainingTags}\nTrigger Word: \`${trainingTrigger}\`\nImages: ${imageCount}\nCaption Sets: ${captionSetCount}\nTraining Runs: ${trainingRunCount}`;

    const keyboard = [
      [{ text: '📝 Name/Desc.', callback_data: `train_edit_namedesc_${trainingId}` }, { text: '👁️ Visibility', callback_data: `train_edit_visibility_${trainingId}` }],
      [{ text: '🏷️ Tags', callback_data: `train_edit_tags_${trainingId}` }, { text: '🎯 Trigger Word', callback_data: `train_edit_trigger_${trainingId}` }],
      [{ text: '🖼️ Images', callback_data: `train_edit_images_${trainingId}` }, { text: '✍️ Captions', callback_data: `train_edit_captions_${trainingId}` }],
      [{ text: '⚙️ Training Runs', callback_data: `train_edit_runs_${trainingId}` }],
    ];

    if (training.status === 'draft') {
      keyboard.push([{ text: '✅ Submit for Review', callback_data: `train_submit_${trainingId}` }]);
      keyboard.push([{ text: '🗑️ Delete Draft', callback_data: `train_delete_${trainingId}` }]);
    } else {
      keyboard.push([{ text: 'ℹ️ View Details (Read-only)', callback_data: `train_view_${trainingId}` }]); // This might be train_edit_${trainingId} without actionType
    }
    keyboard.push([{ text: '⬅️ Back to My Trainings', callback_data: 'train_list_mine' }]);

    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2',
      });
    } else {
      await bot.sendMessage(chatId, text, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2',
      });
    }
  } catch (error) {
    logger.error(`Error in showEditTrainingMenu for ${trainingId}:`, error);
    await bot.sendMessage(chatId, '⚠️ An error occurred while loading the edit menu.');
    // await showMyTrainingsMenu(bot, chatId, messageId, masterAccountId, true, dependencies); // Corrected: masterAccountId
  }
}

/**
 * Displays the image management menu for a specific LoRA training.
 */
async function showImageManagementMenu(bot, chatId, messageId, masterAccountId, trainingId, dependencies = {}) {
  const { logger = console } = dependencies;
  try {
    const response = await internalApiClient.get(`/trainings/${trainingId}`);
    const training = response.data;

    if (!training) {
      await bot.editMessageText('⚠️ Training session not found.', {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to My Trainings', callback_data: 'train_list_mine' }]] }
      });
      return;
    }

    const imageCount = training.images ? training.images.length : 0;
    const text = `🖼️ *Manage Images for: ${escapeMarkdownV2(training.name)}*\n\nCurrent images: ${imageCount}\n\nWhat would you like to do?`;

    const keyboard = [
      [{ text: '➕ Add Image', callback_data: `train_add_image_prompt_${trainingId}` }],
      // TODO: Add buttons for listing, deleting images when count > 0
      [{ text: '⬅️ Back to Edit Menu', callback_data: `train_edit_${trainingId}` }],
    ];

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: 'MarkdownV2',
    });
  } catch (error) {
    logger.error(`Error in showImageManagementMenu for ${trainingId}:`, error);
    await bot.editMessageText('⚠️ An error occurred while loading the image menu.', {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Edit Menu', callback_data: `train_edit_${trainingId}` }]] }
    });
  }
}

/**
 * Prompts the user to send an image for the specified training session.
 */
async function handleRequestAddImage(bot, chatId, messageId, masterAccountId, trainingId, dependencies = {}) {
  const { logger = console } = dependencies;
  try {
    const response = await internalApiClient.get(`/trainings/${trainingId}`);
    const training = response.data;
    if (!training) {
      await bot.editMessageText('⚠️ Training session not found. Cannot add image.', {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to My Trainings', callback_data: 'train_list_mine' }]] }
      });
      return;
    }

    const escapedTrainingName = escapeMarkdownV2(training.name);
    const escapedMarker = escapeMarkdownV2(PROMPT_MARKER_TRAINING_IMAGE);
    const escapedTrainingId = escapeMarkdownV2(trainingId);
    const escapedMasterAccountId = escapeMarkdownV2(masterAccountId);

    const text = `📷 Please send the image you want to add for training '**${escapedTrainingName}**'.\n\n(Reply to this message with your image.)\n(Internal Info: ${escapedMarker}\:\:TRAINING\_ID\:\:${escapedTrainingId}\:\:MAID\:\:${escapedMasterAccountId})`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Cancel Add Image', callback_data: `train_edit_images_${trainingId}` }]] }, // Back to image menu
      parse_mode: 'MarkdownV2',
    });
  } catch (error) {
    logger.error(`Error in handleRequestAddImage for ${trainingId}:`, error);
    await bot.editMessageText('⚠️ An error occurred while preparing to add an image.', {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Image Menu', callback_data: `train_edit_images_${trainingId}` }]] }
    });
  }
}

// Main handler for callback queries related to LoRA training
async function handleTrainingCallbackQuery(bot, query, masterAccountId, dependencies = {}) {
  const { logger = console } = dependencies;
  const userId = query.from.id; // This is Telegram User ID, not MasterAccountId
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  try {
    if (data === 'train_main_menu') {
      await showMainTrainingMenu(bot, chatId, messageId, masterAccountId, true, dependencies);
    } else if (data === 'train_create_new') {
      await handleCreateNewTraining(bot, chatId, messageId, masterAccountId, dependencies);
    } else if (data === 'train_list_mine') {
      await showMyTrainingsMenu(bot, chatId, messageId, masterAccountId, dependencies);
    } else if (data.startsWith('train_edit_images_')) {
      const trainingId = data.substring('train_edit_images_'.length);
      await showImageManagementMenu(bot, chatId, messageId, masterAccountId, trainingId, dependencies);
    } else if (data.startsWith('train_add_image_prompt_')) {
      const trainingId = data.substring('train_add_image_prompt_'.length);
      await handleRequestAddImage(bot, chatId, messageId, masterAccountId, trainingId, dependencies);
    } else if (data.startsWith('train_edit_')) {
      const parts = data.split('_');
      const trainingId = parts[parts.length -1]; // Last part is ID
      // Check if it's a general edit call (train_edit_ID) or a specific action
      if (parts.length === 3 && parts[1] === 'edit') { // Format: train_edit_ID
         await showEditTrainingMenu(bot, chatId, messageId, masterAccountId, trainingId, dependencies);
      } else if (parts.length > 3 && parts[1] === 'edit') { // Format: train_edit_action_ID
        const actionType = parts[2];
        // Existing placeholder logic
        if (actionType === 'namedesc') {
          await bot.answerCallbackQuery(query.id, { text: 'Edit Name/Desc: Not yet implemented.' });
        } else if (actionType === 'visibility') {
            await bot.answerCallbackQuery(query.id, { text: 'Edit Visibility: Not yet implemented.' });
        } else if (actionType === 'tags') {
            await bot.answerCallbackQuery(query.id, { text: 'Edit Tags: Not yet implemented.' });
        } else if (actionType === 'trigger') {
            await bot.answerCallbackQuery(query.id, { text: 'Edit Trigger: Not yet implemented.' });
        } else if (actionType === 'captions') {
            await bot.answerCallbackQuery(query.id, { text: 'Edit Captions: Not yet implemented.' });
        } else if (actionType === 'runs') {
            await bot.answerCallbackQuery(query.id, { text: 'Edit Runs: Not yet implemented.' });
        } else {
          logger.warn(`Unknown train_edit_ actionType: ${actionType} for ${data}`);
          await showEditTrainingMenu(bot, chatId, messageId, masterAccountId, trainingId, dependencies); // Fallback to main edit menu
        }
      } else {
         logger.warn(`Malformed train_edit_ callback: ${data}`);
         await bot.answerCallbackQuery(query.id, {text: 'Unknown edit action.'});
      }
    } else if (data.startsWith('train_submit_')) {
      const trainingId = data.split('_').pop();
      await bot.answerCallbackQuery(query.id, { text: 'Submit: Not yet implemented.' });
    } else if (data.startsWith('train_delete_')) {
      const trainingId = data.split('_').pop();
      await bot.answerCallbackQuery(query.id, { text: 'Delete: Not yet implemented.' });
    } else {
      await bot.answerCallbackQuery(query.id, { text: 'Unknown training action.'});
    }
    // Ensure callback is answered if not done by specific handlers and if it's still pending
    if (!query.answered) {
        await bot.answerCallbackQuery(query.id).catch(e => logger.warn(`Redundant answerCallbackQuery failed: ${e.message}`));
    }
  } catch (error) {
    logger.error(`Error in handleTrainingCallbackQuery (data: ${data}):`, error);
    if (!query.answered) {
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Error processing your request.', show_alert: true });
        } catch (ackError) {
            logger.error('FATAL: Could not acknowledge callback query after error:', ackError);
        }
    }
  }
}

// This function would be registered with the bot to handle text messages
// when in a specific state, e.g., 'train_awaiting_name'
async function handleTrainingTextMessage(bot, message) {
  const userId = message.from.id;
  // const userState = getUserState(userId); // Retrieve user state

  // if (userState && userState.action === 'train_awaiting_name') {
  //   await processNewTrainingName(bot, message, userId /*, userState.messageId */); 
  //   clearUserState(userId); // Clear state after processing
  // } else if (userState && userState.action === 'train_awaiting_description') {
  //   // ... handle description input for training
  // }
  // ... other text input handlers
}

// Entry point for /train command
async function handleTrainCommand(bot, message, masterAccountId, dependencies = {}) {
    const { logger = console } = dependencies;
    // const userId = message.from.id; // masterAccountId is already the unique ID we need
    const chatId = message.chat.id;
    logger.info(`[TrainingMenu] /train command initiated by MAID: ${masterAccountId} (Telegram User: ${message.from.id})`);
    await showMainTrainingMenu(bot, chatId, null, masterAccountId, false, dependencies);
}

module.exports = {
  handleTrainCommand, // Main command handler
  handleTrainingCallbackQuery, // Main callback handler
  handleTrainingTextMessage, // Main text message handler (if using state-based input)

  // Exporting individual functions might be useful for more complex routing or testing
  showMainTrainingMenu,
  handleCreateNewTraining,
  processNewTrainingName,
  showMyTrainingsMenu,
  showEditTrainingMenu,
  showImageManagementMenu, // Export new functions
  handleRequestAddImage
}; 