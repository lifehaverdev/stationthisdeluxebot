/**
 * Telegram Platform Adapter
 * 
 * Main entry point for the Telegram bot implementation.
 * Registers command handlers and provides the bot interface.
 */

const TelegramBot = require('node-telegram-bot-api');

const createCollectionsCommandHandler = require('./commands/collectionsCommand');
const createTrainModelCommandHandler = require('./commands/trainModelCommand');
const createStatusCommandHandler = require('./commands/statusCommand');

// Import new settings menu manager and internal API client
const { handleSettingsCommand, handleSettingsCallback, handleParameterValueReply, buildToolParamsMenu } = require('./components/settingsMenuManager.js');
const internalApiClient = require('./utils/internalApiClient.js');

/**
 * Create and configure the Telegram bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Telegram bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createTelegramBot(dependencies, token, options = {}) {
  // Add a log to verify dependencies.toolRegistry
  // const initialLogger = dependencies.logger || console;
  // initialLogger.info('[TelegramBot] createTelegramBot called. Checking received toolRegistry...');
  // if (dependencies.toolRegistry && typeof dependencies.toolRegistry.getToolById === 'function') {
  //   initialLogger.info('[TelegramBot] dependencies.toolRegistry appears to be a valid ToolRegistry instance.');
  // } else {
  //   initialLogger.warn('[TelegramBot] dependencies.toolRegistry is MISSING or INVALID! Details:', { registry: dependencies.toolRegistry });
  // }
  // End verification log

  const {
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    db,
    logger = console,
    appStartTime,
    toolRegistry,
    userSettingsService
  } = dependencies;
  
  // Create the Telegram bot instance
  const bot = new TelegramBot(token, {
    polling: options.polling !== false,
    ...options
  });
  
  // Initialize command handlers

  
  const handleTrainModelCommand = createTrainModelCommandHandler({
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    bot,
    logger
  });
  
  const handleStatusCommand = createStatusCommandHandler({
    bot,
    logger,
    services: {
      internal: dependencies.internal,
      db: dependencies.db
    }
  });
  
  // Register command handlers
  
  // ++ NEW /settings COMMAND HANDLER ++
  bot.onText(/^\/settings(?:@\w+)?$/i, async (message) => {
    const telegramUserId = message.from.id.toString();
    const platform = 'telegram';
    logger.info(`[Bot] /settings command received from Telegram User ID: ${telegramUserId}`);
    try {
      const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
        platform: platform,
        platformId: telegramUserId,
        platformContext: { firstName: message.from.first_name, username: message.from.username }
      });
      const masterAccountId = findOrCreateResponse.data.masterAccountId;
      logger.info(`[Bot] MasterAccountId ${masterAccountId} found/created for Telegram User ID: ${telegramUserId}`);
      
      // Pass logger, toolRegistry, and userSettingsService to the settings command handler
      await handleSettingsCommand(bot, message, masterAccountId, { logger, toolRegistry, userSettingsService });
    } catch (error) {
      logger.error(`[Bot] Error processing /settings command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
      bot.sendMessage(message.chat.id, "Sorry, there was an error trying to open settings. Please try again.", { reply_to_message_id: message.message_id });
    }
  });
  // -- END NEW /settings COMMAND HANDLER --
  
  // /collections command - Manage user collections
  bot.onText(/^\/collections(?:@\w+)?\s*(.*)/i, (message, match) => {
    const args = match[1] || '';
    // handleCollectionsCommand(message, args);
  });
  
  // /train command - Manage LoRA model training
  bot.onText(/^\/train(?:@\w+)?\s*(.*)/i, (message, match) => {
    const args = match[1] || '';
    handleTrainModelCommand(message, args);
  });
  
  // /status command - Show application runtime information
  bot.onText(/^\/status(?:@\w+)?/i, (message) => {
    handleStatusCommand(message);
  });
  
  // TEMPORARY COMMAND to clear user-specific chat commands
  bot.onText(/^\/clear_my_chat_commands(?:@\w+)?/i, async (message) => {
    const chatId = message.chat.id;
    const userId = message.from.id;

    // Only allow the specific user to run this, or make it admin-only in a real scenario
    // For now, let's assume this is for your specific debugging.
    // if (userId.toString() !== 'YOUR_TELEGRAM_USER_ID') { 
    //   return bot.sendMessage(chatId, "This command is not for you.");
    // }

    try {
      logger.info(`[Admin] Attempting to clear commands for chat_id: ${chatId}`);
      await bot.setMyCommands([], { scope: { type: 'chat', chat_id: chatId } });
      logger.info(`[Admin] Successfully cleared commands for chat_id: ${chatId}`);
      bot.sendMessage(chatId, "Your chat-specific command list has been cleared. Please restart Telegram or wait a few moments for the global command list to appear.", { reply_to_message_id: message.message_id });
    } catch (error) {
      logger.error(`[Admin] Failed to clear commands for chat_id: ${chatId}`, error);
      bot.sendMessage(chatId, `Failed to clear your chat-specific commands: ${error.message}`, { reply_to_message_id: message.message_id });
    }
  });
  
  // Handle callback queries for inline buttons
  bot.on('callback_query', async (callbackQuery) => {
    const { data, message } = callbackQuery;
    const originalCommandUser = message.reply_to_message?.from;
    const callbackUserId = callbackQuery.from.id;

    try {
      // User Specificity Check: If the message is a reply AND the clicker is not the original command issuer
      if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "This menu isn't for you.", show_alert: true });
        return;
      }
      
      // ++ NEW 'set_' (SETTINGS MENU) CALLBACK HANDLER ++
      if (data.startsWith('set_')) {
        if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "This menu isn't for you.", show_alert: true });
          return;
        }
        const platform = 'telegram';
        logger.info(`[Bot CB] 'set_' callback '${data}' from UserID ${callbackUserId} (original cmd by ${originalCommandUser.id})`);
        try {
          // Fetch masterAccountId for the user who issued the original /settings command
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: originalCommandUser.id.toString(), 
            platformContext: { firstName: originalCommandUser.first_name, username: originalCommandUser.username }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;
          logger.info(`[Bot CB] MasterAccountId ${masterAccountId} determined for original command user ${originalCommandUser.id} for settings menu.`);
          
          // Delegate to the new settings callback handler, passing logger, toolRegistry, and userSettingsService
          await handleSettingsCallback(bot, callbackQuery, masterAccountId, { logger, toolRegistry, userSettingsService });
          // Note: handleSettingsCallback is now responsible for bot.answerCallbackQuery(callbackQuery.id)

        } catch (error) {
          logger.error(`[Bot CB] Error in 'set_' callback logic (fetching MAID) for original user ${originalCommandUser.id}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, {text: "Error accessing your account for settings.", show_alert: true});
        }
      } else if (data.startsWith('collection:')) {
        // Existing collection logic starts here
        // (Code for 'collection:' callbacks remains unchanged from the original file)
        const parts = data.split(':');
        const action = parts[1];
        const collectionId = parts[2];
        // userId is callbackUserId
        
        let answeredByCollectionLogic = false; // Flag to see if collection logic answers the query
        switch (action) {
          case 'view':
            const viewMessage = { ...message, from: callbackQuery.from, message_id: message.message_id };
            // await handleCollectionsCommand(viewMessage, `view ${collectionId}`);
            logger.info('[Bot CB] Collection view action placeholder');
            await bot.answerCallbackQuery(callbackQuery.id, {text: "View collection (placeholder)"});
            answeredByCollectionLogic = true;
            break;
          case 'edit':
            await bot.sendMessage(
              message.chat.id,
              'To edit your collection, use one of the following commands:\n\n' +
              '• /collections rename <collectionId> <new name>\n' +
              '• /collections prompt <collectionId> <master prompt>\n',
              { reply_to_message_id: message.message_id }
            );
            await bot.answerCallbackQuery(callbackQuery.id); 
            answeredByCollectionLogic = true;
            break;
          case 'delete':
            await bot.sendMessage(
              message.chat.id,
              `Are you sure you want to delete this collection? This cannot be undone.`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: 'Yes, delete it', callback_data: `collection:confirm_delete:${collectionId}` },
                      { text: 'No, keep it', callback_data: 'collection:cancel_delete' }
                    ]
                  ]
                }
              }
            );
            await bot.answerCallbackQuery(callbackQuery.id); 
            answeredByCollectionLogic = true;
            break;
          case 'confirm_delete':
            const deleteMessage = { ...message, from: callbackQuery.from, message_id: message.message_id };
            // await handleCollectionsCommand(deleteMessage, `delete ${collectionId}`);
            logger.info('[Bot CB] Collection confirm_delete placeholder');
            await bot.answerCallbackQuery(callbackQuery.id, {text: "Confirm delete collection (placeholder)"});
            answeredByCollectionLogic = true;
            break;
          case 'cancel_delete':
            await bot.editMessageText('Collection deletion cancelled.', { chat_id: message.chat.id, message_id: message.message_id, reply_markup: null });
            await bot.answerCallbackQuery(callbackQuery.id); 
            answeredByCollectionLogic = true;
            break;
          // ... other collection cases would go here ...
          default:
            logger.warn(`[Bot CB] Unknown collection action: ${action} in data: ${data}`);
            await bot.answerCallbackQuery(callbackQuery.id, {text: "Unknown collection action"});
            answeredByCollectionLogic = true;
            break;
        }
        if (!answeredByCollectionLogic) { // Fallback if a case didn't explicitly answer
            await bot.answerCallbackQuery(callbackQuery.id); 
        }

      } else if (data.startsWith('train:')) {
        // Existing train logic starts here
        // (Code for 'train:' callbacks remains unchanged from the original file)
        const parts = data.split(':');
        const action = parts[1];
        const loraId = parts[2];
        const trainMessage = { ...message, from: callbackQuery.from, message_id: message.message_id };
        let answeredByTrainLogic = false; // Flag to see if train logic answers the query

        switch (action) {
          case 'view':
            await handleTrainModelCommand(trainMessage, `view ${loraId}`); // This should ideally answer the query
            answeredByTrainLogic = true; // Assume it answers, or it should call answerCallbackQuery itself
            break;
          case 'submit':
            await handleTrainModelCommand(trainMessage, `submit ${loraId}`); // This should ideally answer the query
            answeredByTrainLogic = true; // Assume it answers
            break;
          case 'delete':
            await bot.sendMessage(
              message.chat.id,
              `Are you sure you want to delete this training dataset? This cannot be undone.`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: 'Yes, delete it', callback_data: `train:confirm_delete:${loraId}` }
                    ]
                  ]
                }
              }
            );
            await bot.answerCallbackQuery(callbackQuery.id); 
            answeredByTrainLogic = true;
            break;
          case 'confirm_delete':
            await bot.sendMessage(
              message.chat.id,
              'Training dataset deletion is not implemented yet.',
              { reply_to_message_id: message.message_id }
            );
            await bot.answerCallbackQuery(callbackQuery.id); 
            answeredByTrainLogic = true;
            break;
          case 'cancel_delete':
            await bot.editMessageText('Training dataset deletion cancelled.', { chat_id: message.chat.id, message_id: message.message_id, reply_markup: null });
            await bot.answerCallbackQuery(callbackQuery.id); 
            answeredByTrainLogic = true;
            break;
          default:
            logger.warn(`[Bot CB] Unknown train action: ${action} in data: ${data}`);
            await bot.answerCallbackQuery(callbackQuery.id, {text: "Unknown train action"});
            answeredByTrainLogic = true;
            break;
        }
        if (!answeredByTrainLogic && !callbackQuery.answered) { // Fallback if a case didn't explicitly answer
             await bot.answerCallbackQuery(callbackQuery.id); 
        }

      } else {
        // Fallback for any other unhandled callbacks
        logger.warn(`[Bot CB] Unhandled callback data prefix: ${data}`);
        if (!callbackQuery.answered) { // Check if it hasn't been answered by any prior logic
            await bot.answerCallbackQuery(callbackQuery.id, {text: "Action not recognized."} );
        }
      }
    } catch (error) {
      logger.error('Error handling callback query:', error);
      // Try to answer callback even in case of error to prevent timeout and inform user
      try { 
        if (!callbackQuery.answered) { // Check before trying to answer again
            await bot.answerCallbackQuery(callbackQuery.id, {text: "Sorry, an error occurred processing this action.", show_alert: true}); 
        }
      } catch (e) { 
        logger.error("[Bot CB] Critical: Failed to answer callback query even in error handling path:", e); 
      }
    }
  });
  
  // Log errors
  bot.on('polling_error', (error) => {
    logger.error('Telegram polling error:', error);
  });
  
  // ++ NEW MESSAGE HANDLER FOR PARAMETER VALUE REPLIES & DEFAULT ACTIONS ++
  bot.on('message', async (message) => {
    // Ignore messages without text (e.g. images, stickers if not handled otherwise)
    if (!message.text) {
      return;
    }

    // Check if the message is a reply to one of our parameter edit prompts
    if (message.reply_to_message && message.reply_to_message.text && message.reply_to_message.text.startsWith('SessionSettingsParamEditPrompt::')) {
      const promptText = message.reply_to_message.text;
      const telegramUserId = message.from.id.toString();
      const value = message.text; // The new value user replied with

      const toolMatch = promptText.match(/Tool:([^:]+)::/);
      const paramMatch = promptText.match(/Param:([^\n]+)/);

      if (toolMatch && toolMatch[1] && paramMatch && paramMatch[1]) {
        const toolDisplayName = toolMatch[1];
        const paramName = paramMatch[1];
        
        logger.info(`[Bot] Reply received for settings param edit. User: ${telegramUserId}, Tool: ${toolDisplayName}, Param: ${paramName}, Value: '${value}', Replying to MsgID: ${message.reply_to_message.message_id}`);

        try {
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: telegramUserId,
            platformContext: { firstName: message.from.first_name, username: message.from.username }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;

          // Pass logger, toolRegistry, and userSettingsService
          const result = await handleParameterValueReply(masterAccountId, toolDisplayName, paramName, value, { logger, toolRegistry, userSettingsService });

          if (result.success) {
            await bot.sendMessage(message.chat.id, result.message, { reply_to_message_id: message.message_id });
            
            if (result.canonicalToolId) {
              const updatedToolParamsMenu = await buildToolParamsMenu(masterAccountId, result.canonicalToolId, { logger, toolRegistry, userSettingsService });
              await bot.editMessageText(updatedToolParamsMenu.text, {
                chat_id: message.chat.id,
                message_id: message.reply_to_message.message_id, // Edit the original prompt message
                reply_markup: updatedToolParamsMenu.reply_markup
              });
            }
          } else {
            await bot.sendMessage(message.chat.id, result.message || "Failed to update setting.", { reply_to_message_id: message.message_id });
          }
        } catch (error) {
          logger.error(`[Bot] Error processing settings parameter reply for Tool: ${toolDisplayName}, Param: ${paramName}, User: ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.sendMessage(message.chat.id, "Sorry, an error occurred while saving your setting.", { reply_to_message_id: message.message_id });
        }
        return; // Stop further processing for this message, as it was a settings reply
      }
    }
    // -- END PARAMETER VALUE REPLY HANDLER --


    // Default message handler for make/imagine commands (if not a command and not a settings reply)
    // This part should contain your existing logic for handling general messages like "make a cat"
    // Ensure it doesn't conflict with command handlers (onText)
    if (!message.text.startsWith('/')) {
        // Check if commandRegistry and findDynamicCommandHandler are available
        if (dependencies.commandRegistry && typeof dependencies.commandRegistry.findDynamicCommandHandler === 'function') {
            const commandHandler = dependencies.commandRegistry.findDynamicCommandHandler(message.text, 'telegram');
            if (commandHandler) {
                logger.info(`[Bot] Handling general message "${message.text.substring(0,30)}..." with dynamic command handler for tool: ${commandHandler.toolId}`);
                try {
                    // Assuming the handler function is named 'handler' and takes (message, args) or similar
                    // Adjust the call based on the actual signature of your dynamic command handlers
                    await commandHandler.handler(message, ''); 
                } catch (error) {
                    logger.error('[Bot] Error executing dynamic command handler:', error);
                    bot.sendMessage(message.chat.id, "Sorry, I couldn't process that.", { reply_to_message_id: message.message_id });
                }
            } else {
                // logger.info(`[Bot] No dynamic command handler found for message: "${message.text.substring(0,30)}..."`);
            }
        } else {
            logger.warn('[Bot] commandRegistry or findDynamicCommandHandler is not available in dependencies.');
        }
    }
  });
  // -- END MESSAGE HANDLER --

  logger.info('Telegram bot configured and ready');
  
  return bot;
}

module.exports = createTelegramBot; 