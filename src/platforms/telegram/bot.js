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
const { handleSettingsCommand, handleSettingsCallback, handleParameterValueReply, buildToolParamsMenu, buildTweakUIMenu, buildTweakParamEditPrompt } = require('./components/settingsMenuManager.js');
const internalApiClient = require('./utils/internalApiClient.js');

// Temporary store for pending tweaks
// Key: `generationId_masterAccountId`
// Value: Object of parameters being tweaked
let pendingTweaks = {};

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
    const chatType = message.chat.type; // 'private', 'group', 'supergroup', 'channel'

    try {
      // User Specificity Check
      const isRateGenCallback = data.startsWith('rate_gen:');
      const isGroupChat = chatType === 'group' || chatType === 'supergroup';

      if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
        // If it's a rate_gen callback in a group chat, allow anyone to rate.
        // Otherwise, enforce user specificity.
        if (!(isRateGenCallback && isGroupChat)) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "This menu isn't for you.", show_alert: true });
          return;
        }
      }
      
      // ++ NEW 'set_' (SETTINGS MENU) CALLBACK HANDLER ++
      if (data.startsWith('set_')) {
        // User specificity for settings menu should still apply strictly
        if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "This settings menu isn't for you.", show_alert: true });
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

      } else if (data.startsWith('rate_gen:')) {
        // Handle rate_gen callbacks
        const parts = data.split(':');
        const generationId = parts[1];
        const ratingType = parts[2];
        const callbackUser = callbackQuery.from; // Get the full callback user object
        const telegramUserId = callbackUser.id.toString();

        logger.info(`[Bot CB] rate_gen callback for generationId: ${generationId}, ratingType: ${ratingType}, from Telegram UserID: ${telegramUserId}`);

        try {
          // Find or create user to get masterAccountId
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: telegramUserId,
            platformContext: { firstName: callbackUser.first_name, username: callbackUser.username }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;

          if (!masterAccountId) {
            logger.error(`[Bot CB] Could not find or create masterAccountId for Telegram UserID: ${telegramUserId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not identify your account.", show_alert: true });
            return;
          }
          
          logger.info(`[Bot CB] MasterAccountId ${masterAccountId} found/created for Telegram UserID: ${telegramUserId} for rating.`);

          // Call the internal API to update the rating
          await internalApiClient.rateGeneration(generationId, ratingType, masterAccountId);
          let emoji = '';
          switch (ratingType) {
            case 'beautiful':
              emoji = '😻😻😻';
              break;
            case 'funny':
              emoji = '😹😹😹';
              break;
            case 'sad':
              emoji = '😿😿😿';
              break;
            default:
              emoji = '😶😶😶';
          }
          await bot.answerCallbackQuery(callbackQuery.id, { text: `Your rating of ${ratingType} has been recorded. ${emoji}`, show_alert: false });
        } catch (error) {
          logger.error(`[Bot CB] Error in rate_gen callback for generationId: ${generationId} (Telegram UserID: ${telegramUserId}):`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Failed to update rating.", show_alert: true });
        }

      } else if (data === 'hide_menu') {
        logger.info(`[Bot CB] hide_menu callback received for messageId: ${message.message_id} in chatId: ${message.chat.id}`);
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: message.chat.id, message_id: message.message_id });
          await bot.answerCallbackQuery(callbackQuery.id, { text: "🤫🫡" });
        } catch (error) {
          logger.error(`[Bot CB] Error hiding menu for messageId: ${message.message_id}:`, error.message);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't hide menu.", show_alert: true });
        }
      } else if (data.startsWith('view_gen_info:')) {
        const parts = data.split(':');
        const generationId = parts[1];
        logger.info(`[Bot CB] view_gen_info callback for generationId: ${generationId}`);

        try {
          const response = await internalApiClient.get(`/generations/${generationId}`);
          const generationRecord = response.data;

          if (!generationRecord) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Generation info not found.", show_alert: true });
            return;
          }

          const escapeMd = (text) => {
            if (text === null || text === undefined) return '';
            return String(text).replace(/([_*[\\]()~`>#+\\-=|{}.!])/g, '\\\\$1');
          };

          let infoMessage = `*Generation Info*\n`;

          let toolId = generationRecord.serviceName; // Fallback to serviceName if no specific toolId found
          if (generationRecord.requestPayload?.invoked_tool_id) {
            toolId = generationRecord.requestPayload.invoked_tool_id;
          } else if (generationRecord.requestPayload?.tool_id) {
            toolId = generationRecord.requestPayload.tool_id;
          } else if (generationRecord.metadata?.toolId) {
            toolId = generationRecord.metadata.toolId;
          }
          
          let toolDisplayName = toolId; // Default to toolId if not found in registry or no displayName
          if (toolRegistry && typeof toolRegistry.getToolById === 'function') {
            const toolDef = toolRegistry.getToolById(toolId);
            if (toolDef && toolDef.displayName) {
              toolDisplayName = toolDef.displayName;
            }
          }
          toolDisplayName = String(toolDisplayName); // Ensure it's a string

          infoMessage += `Tool: \`${escapeMd(toolDisplayName)}\`\n`;

          if (generationRecord.requestPayload) {
            infoMessage += `\n*Parameters Used:*\n`;
            for (const [key, value] of Object.entries(generationRecord.requestPayload)) {
              if ((key === 'invoked_tool_id' || key === 'tool_id') && toolDisplayName === String(value)) continue;
              
              let displayKey = key;
              if (displayKey.startsWith('input_')) {
                displayKey = displayKey.substring(6); // Remove "input_" prefix
              }

              const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
              infoMessage += `  • *${escapeMd(displayKey)}*: \`${escapeMd(String(displayValue))}\`\n`;
            }
          }

          if (generationRecord.ratings && Object.keys(generationRecord.ratings).length > 0) {
            let ratingsExist = false;
            let ratingsText = "\n*Current Ratings:*\n";
            for (const [ratingType, userList] of Object.entries(generationRecord.ratings)) {
              if (userList && userList.length > 0) {
                ratingsText += `  • ${escapeMd(ratingType.charAt(0).toUpperCase() + ratingType.slice(1))}: ${escapeMd(String(userList.length))}\n`;
                ratingsExist = true;
              }
            }
            if (ratingsExist) {
              infoMessage += ratingsText;
            }
          }
          
          await bot.sendMessage(message.chat.id, infoMessage.trim(), { parse_mode: 'MarkdownV2', reply_to_message_id: message.message_id });
          await bot.answerCallbackQuery(callbackQuery.id);

        } catch (error) {
          logger.error(`[Bot CB] Error fetching or sending gen info for ${generationId}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch generation info.", show_alert: true });
        }
      } else if (data.startsWith('tweak_gen:')) {
        const parts = data.split(':');
        const generationId = parts[1];
        const clickerTelegramId = callbackQuery.from.id.toString();

        logger.info(`[Bot CB] tweak_gen callback for generationId: ${generationId} from Telegram UserID: ${clickerTelegramId}`);

        try {
          // 1. Fetch MasterAccountId for the clicker
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId,
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountId = findOrCreateUserResponse.data.masterAccountId;

          if (!clickerMasterAccountId) {
            logger.error(`[Bot CB] tweak_gen: Could not find or create masterAccountId for clicker: ${clickerTelegramId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not identify your account to start tweaking.", show_alert: true });
            return;
          }

          // 2. Fetch the original generation record
          const genResponse = await internalApiClient.get(`/generations/${generationId}`);
          const generationRecord = genResponse.data;

          if (!generationRecord) {
            logger.error(`[Bot CB] tweak_gen: Generation record ${generationId} not found.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Original generation details not found.", show_alert: true });
            return;
          }

          // 3. Extract necessary info (toolId, originalParams, original message context)
          let toolId = generationRecord.serviceName;
          if (generationRecord.requestPayload?.invoked_tool_id) toolId = generationRecord.requestPayload.invoked_tool_id;
          else if (generationRecord.requestPayload?.tool_id) toolId = generationRecord.requestPayload.tool_id;
          else if (generationRecord.metadata?.toolId) toolId = generationRecord.metadata.toolId;

          const originalParams = generationRecord.requestPayload || {};
          
          const originalUserCommandMessageId = generationRecord.metadata?.telegramMessageId;
          const originalUserCommandChatId = generationRecord.metadata?.telegramChatId;

          if (!originalUserCommandMessageId || !originalUserCommandChatId) {
            logger.error(`[Bot CB] tweak_gen: Original command messageId or chatId missing in metadata for ${generationId}.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Cannot determine original command context for tweaking.", show_alert: true });
            // Fallback: Reply to the current message (the one with the button) if original context is missing
            // This is not ideal as per ADR, but a graceful degradation.
            // await bot.sendMessage(message.chat.id, "Debug: Original context missing. Tweak menu will be sent here.");
            // TODO: Decide on fallback behavior - for now, we block if this critical info is missing as per ADR intent.
            return; 
          }

          // 4. Initialize pendingTweaks for this session
          const tweakSessionKey = `${generationId}_${clickerMasterAccountId}`;
          pendingTweaks[tweakSessionKey] = { ...originalParams }; // Initialize with original params
          logger.info(`[Bot CB] tweak_gen: Initialized pendingTweaks for sessionKey: ${tweakSessionKey} with params: ${JSON.stringify(pendingTweaks[tweakSessionKey])}`);

          // 5. Build and send the Tweak UI Menu
          const tweakMenu = await buildTweakUIMenu(
            clickerMasterAccountId, 
            toolId, // This is the canonicalToolId
            pendingTweaks[tweakSessionKey], // Current state of tweaks from the store
            originalUserCommandMessageId, 
            originalUserCommandChatId, 
            generationId,
            { logger, toolRegistry, userSettingsService } // Pass dependencies
          );

          if (tweakMenu && tweakMenu.text && tweakMenu.reply_markup) {
            await bot.sendMessage(originalUserCommandChatId, tweakMenu.text, { 
              parse_mode: 'MarkdownV2', // Assuming buildTweakUIMenu formats for MarkdownV2
              reply_markup: tweakMenu.reply_markup,
              reply_to_message_id: originalUserCommandMessageId 
            });
            await bot.answerCallbackQuery(callbackQuery.id, {text: "Opening tweak menu..."});
          } else {
            logger.error(`[Bot CB] tweak_gen: Failed to build tweak UI menu for ${generationId}.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not generate the tweak interface.", show_alert: true });
            // Clean up pending tweak session if menu build fails
            delete pendingTweaks[tweakSessionKey]; 
          }

        } catch (error) {
          logger.error(`[Bot CB] Error in tweak_gen callback for ${generationId}:`, error.response?.data || error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error initiating tweak mode.", show_alert: true });
          // Ensure cleanup if error occurs before menu is sent but after session init
          const tweakSessionKey = `${generationId}_${callbackQuery.from.id.toString()}`; // Reconstruct key for cleanup
          // A bit risky if clickerMasterAccountId wasn't fetched, but MAID is part of the key name now.
          // We need clickerMasterAccountId for the key, so use that if available.
          // Let's refine the key for cleanup if clickerMasterAccountId was fetched:
          // if (clickerMasterAccountId) { delete pendingTweaks[`${generationId}_${clickerMasterAccountId}`]; } 
          // For simplicity now, assuming it might have been set if error is later.
          // The key was defined as const tweakSessionKey = `${generationId}_${clickerMasterAccountId}`;
          // So, if clickerMasterAccountId was defined, it will be used. If not, that part of the code wouldn't have run.
          // This implies the catch block for tweak_gen needs access to clickerMasterAccountId if it was set.
          // Or, we ensure tweakSessionKey is defined outside the try if used in general catch for this callback type.
        }
      } else if (data.startsWith('tweak_param_edit:')) {
        const parts = data.split(':');
        const generationId = parts[1];
        const canonicalToolId = parts[2];
        const paramName = parts.slice(3).join(':'); // Param name might have colons
        const clickerTelegramId = callbackQuery.from.id.toString();

        logger.info(`[Bot CB] tweak_param_edit callback for GenID: ${generationId}, ToolID: ${canonicalToolId}, Param: ${paramName}`);

        try {
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId,
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountId = findOrCreateUserResponse.data.masterAccountId;

          if (!clickerMasterAccountId) {
            logger.error(`[Bot CB] tweak_param_edit: Could not find/create MAID for ${clickerTelegramId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Your account couldn\'t be identified.", show_alert: true });
            return;
          }

          // We need settingsMenuManager for buildTweakParamEditPrompt
          // Assuming it's imported and available as `settingsMenuManager` or functions are directly available.
          const editMenu = await buildTweakParamEditPrompt(
            clickerMasterAccountId,
            generationId,
            canonicalToolId,
            paramName,
            pendingTweaks, // Pass the whole store, or just the relevant session part
            { logger, toolRegistry, userSettingsService }
          );

          if (editMenu && editMenu.text && editMenu.reply_markup) {
            await bot.editMessageText(editMenu.text, {
              chat_id: message.chat.id, // Edit the existing tweak menu message
              message_id: message.message_id,
              reply_markup: editMenu.reply_markup,
              parse_mode: 'MarkdownV2' // Assuming prompt is MarkdownV2
            });
          } else {
            logger.error(`[Bot CB] tweak_param_edit: Failed to build param edit prompt for ${paramName}.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error opening edit prompt.", show_alert: true });
          }
          await bot.answerCallbackQuery(callbackQuery.id); // Answer silently after edit or error

        } catch (error) {
          logger.error(`[Bot CB] Error in tweak_param_edit for ${paramName}:`, error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error processing parameter edit.", show_alert: true });
        }
      } else if (data.startsWith('tweak_cancel:')) {
        const parts = data.split(':');
        const generationId = parts[1];
        const clickerTelegramId = callbackQuery.from.id.toString();
        logger.info(`[Bot CB] tweak_cancel callback for GenID: ${generationId}`);

        try {
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId,
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountId = findOrCreateUserResponse.data.masterAccountId;

          if (clickerMasterAccountId) {
            const tweakSessionKey = `${generationId}_${clickerMasterAccountId}`;
            delete pendingTweaks[tweakSessionKey];
            logger.info(`[Bot CB] tweak_cancel: Cleared pendingTweaks for sessionKey: ${tweakSessionKey}`);
          }

          await bot.editMessageText("Tweak session cancelled.", {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: null // Remove keyboard
          });
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Tweak cancelled." });
        } catch (error) {
          logger.error(`[Bot CB] Error in tweak_cancel for ${generationId}:`, error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error cancelling tweak.", show_alert: true });
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