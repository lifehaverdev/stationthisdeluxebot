/**
 * Telegram Platform Adapter
 * 
 * Main entry point for the Telegram bot implementation.
 * Registers command handlers and provides the bot interface.
 */

const TelegramBot = require('node-telegram-bot-api');

// Import uuid v4
const { v4: uuidv4 } = require('uuid');

// Helper function to escape text for Telegram's MarkdownV2 parse mode
const { escapeMarkdownV2 } = require('../../utils/stringUtils');

const createCollectionsCommandHandler = require('./commands/collectionsCommand');
const createTrainModelCommandHandler = require('./commands/trainModelCommand');
const createStatusCommandHandler = require('./commands/statusCommand');

// Import new settings menu manager and internal API client
const { handleSettingsCommand, handleSettingsCallback, handleParameterValueReply, buildToolParamsMenu, buildTweakUIMenu, buildTweakParamEditPrompt } = require('./components/settingsMenuManager.js');
const internalApiClient = require('../../utils/internalApiClient'); // UPDATED PATH
const replyContextManager = require('./utils/replyContextManager.js');

// ++ NEW MODS MENU MANAGER IMPORT ++
const { handleModsCommand, handleModsCallback } = require('./components/modsMenuManager.js');
// -- END NEW MODS MENU MANAGER IMPORT --

// ++ NEW SPELL MENU MANAGER IMPORT ++
const { handleSpellCommand, handleSpellCallback, handleNewSpellNameReply, handleStepParameterValueReply } = require('./components/spellMenuManager.js');
// -- END NEW SPELL MENU MANAGER IMPORT --

// ++ NEW TRAINING MENU MANAGER IMPORT ++
const {
  handleTrainCommand,
  handleTrainingCallbackQuery,
  processNewTrainingName, // ADD THIS LINE
  // handleTrainingTextMessage // REMOVE - We will use reply-to-message pattern
} = require('./components/trainingMenuManager.js');
// -- END NEW TRAINING MENU MANAGER IMPORT --

// Temporary store for pending tweaks
// Key: `generationId_masterAccountId`
// Value: Object of parameters being tweaked
let pendingTweaks = {};

const PROMPT_MARKER_TRAINING_NAME = 'PROMPT_TRAINING_NAME_V1'; // Define marker for bot.js

/**
 * Create and configure the Telegram bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Telegram bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createTelegramBot(dependencies, token, options = {}) {
  // const initialLoggerForDepCheck = dependencies.logger || console; // REMOVE
  // initialLoggerForDepCheck.info('[TelegramBot] createTelegramBot called. Inspecting INCOMING dependencies object:'); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] Keys in incoming dependencies: ${JSON.stringify(Object.keys(dependencies))}`); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] typeof dependencies.comfyuiService: ${typeof dependencies.comfyuiService}`); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] typeof dependencies.comfyuiService?.submitRequest: ${typeof dependencies.comfyuiService?.submitRequest}`); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] typeof dependencies.workflowsService: ${typeof dependencies.workflowsService}`); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] typeof dependencies.workflowsService?.getToolById: ${typeof dependencies.workflowsService?.getToolById}`); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] typeof dependencies.sessionService (direct check): ${typeof dependencies.sessionService}`); // REMOVE
  // initialLoggerForDepCheck.info(`[TelegramBot] typeof dependencies.sessionService?.getSession (direct check): ${typeof dependencies.sessionService?.getSession}`); // REMOVE

  // OLD DIAGNOSTIC LOGS (can be removed later if the above is sufficient)
  // Check sessionService
  // if (dependencies.sessionService && typeof dependencies.sessionService.getSession === 'function') { 
  //   initialLoggerForDepCheck.info('[TelegramBot] dependencies.sessionService IS VALID and has getSession method.');
  // } else {
  //   initialLoggerForDepCheck.warn(
  //     '[TelegramBot] dependencies.sessionService IS MISSING or INVALID or does not have getSession method!', 
  //     { 
  //       hasSessionService: !!dependencies.sessionService,
  //       serviceDetails: dependencies.sessionService ? JSON.stringify(Object.keys(dependencies.sessionService)) : 'N/A',
  //       hasGetSessionMethod: dependencies.sessionService ? typeof dependencies.sessionService.getSession === 'function' : 'N/A'
  //     }
  //   );
  // }
  // // Check comfyuiService
  // if (dependencies.comfyuiService && typeof dependencies.comfyuiService.submitRequest === 'function') { // Now checks comfyuiService
  //   initialLoggerForDepCheck.info('[TelegramBot] dependencies.comfyuiService IS VALID and has submitRequest method.');
  // } else {
  //   initialLoggerForDepCheck.warn(
  //     '[TelegramBot] dependencies.comfyuiService IS MISSING or INVALID or does not have submitRequest method!', 
  //     { 
  //       hasComfyuiService: !!dependencies.comfyuiService, // Changed key
  //       serviceDetails: dependencies.comfyuiService ? JSON.stringify(Object.keys(dependencies.comfyuiService)) : 'N/A',
  //       hasSubmitRequestMethod: dependencies.comfyuiService ? typeof dependencies.comfyuiService.submitRequest === 'function' : 'N/A'
  //     }
  //   );
  // }

  const {
    comfyuiService,      // Directly use dependencies.comfyuiService
    pointsService,       // Directly use dependencies.pointsService
    sessionService,      // Directly use dependencies.sessionService
    workflowsService,  // Directly use dependencies.workflowsService
    mediaService,        // Directly use dependencies.mediaService
    db,                  // Directly use dependencies.db
    internal,            // Directly use dependencies.internal
    logger = console,    // Use dependencies.logger or default
    appStartTime,        // Directly use dependencies.appStartTime
    toolRegistry,        // Directly use dependencies.toolRegistry
    userSettingsService, // Directly use dependencies.userSettingsService
    spellsService        // Directly use dependencies.spellsService
  } = dependencies;
  
  // ++ Ensure loRAPermissionsDb is available from dependencies ++
  const loRAPermissionsDb = dependencies.loRAPermissionsDb || new (require('../../core/services/db/loRAPermissionsDb'))(logger);
  // -- End loRAPermissionsDb --

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
  
  // ++ NEW /mods COMMAND HANDLER (Corrected Placement) ++
  bot.onText(/^\/mods(?:@\w+)?$/i, async (message) => {
    const telegramUserId = message.from.id.toString();
    const platform = 'telegram';
    logger.info(`[Bot] /mods command received from Telegram User ID: ${telegramUserId}`);
    try {
      const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
        platform: platform,
        platformId: telegramUserId,
        platformContext: { firstName: message.from.first_name, username: message.from.username }
      });
      const masterAccountId = findOrCreateResponse.data.masterAccountId;
      logger.info(`[Bot] MasterAccountId ${masterAccountId} found/created for Telegram User ID: ${telegramUserId} for /mods`);
      
      // Pass all dependencies that modsMenuManager might need
      await handleModsCommand(bot, message, masterAccountId, 
        { logger, internalApiClient, userSettingsService, toolRegistry, replyContextManager } // Add other deps as needed
      );
    } catch (error) {
      logger.error(`[Bot] Error processing /mods command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
      bot.sendMessage(message.chat.id, "Sorry, there was an error trying to open the Mods menu. Please try again.", { reply_to_message_id: message.message_id });
    }
  });
  // -- END NEW /mods COMMAND HANDLER --
  
  // /collections command - Manage user collections
  bot.onText(/^\/collections(?:@\w+)?\s*(.*)/i, (message, match) => {
    const args = match[1] || '';
    // handleCollectionsCommand(message, args);
  });
  
  // ++ NEW /train COMMAND HANDLER (for training menu) ++
  bot.onText(/^\/train(?:@\w+)?$/i, async (message) => {
    logger.info(`[Bot] /train (training menu) command received from UserID: ${message.from.id}`);
    const telegramUserId = message.from.id.toString();
    const platform = 'telegram';
    try {
      const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
        platform: platform,
        platformId: telegramUserId,
        platformContext: { firstName: message.from.first_name, username: message.from.username }
      });
      const masterAccountId = findOrCreateResponse.data.masterAccountId;
      logger.info(`[Bot] MasterAccountId ${masterAccountId} found/created for Telegram User ID: ${telegramUserId} for /train command.`);
      
      await handleTrainCommand(bot, message, masterAccountId, { logger });
    } catch (error) {
      logger.error(`[Bot] Error processing /train command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
      bot.sendMessage(message.chat.id, "Sorry, there was an error trying to open the training hub. Please try again.", { reply_to_message_id: message.message_id });
    }
  });
  // -- END NEW /train COMMAND HANDLER --
  
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
  
  // ++ NEW /spells COMMAND HANDLER ++
  bot.onText(/^\/spells(?:@\w+)?$/i, async (message) => {
    const telegramUserId = message.from.id.toString();
    const platform = 'telegram';
    logger.info(`[Bot] /spells command received from Telegram User ID: ${telegramUserId}`);
    try {
      const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
        platform: platform,
        platformId: telegramUserId,
        platformContext: { firstName: message.from.first_name, username: message.from.username }
      });
      const masterAccountId = findOrCreateResponse.data.masterAccountId;
      logger.info(`[Bot] MasterAccountId ${masterAccountId} found/created for Telegram User ID: ${telegramUserId} for /spells`);
      
      await handleSpellCommand(bot, message, masterAccountId, 
        { logger, toolRegistry, replyContextManager }
      );
    } catch (error) {
      logger.error(`[Bot] Error processing /spells command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
      bot.sendMessage(message.chat.id, "Sorry, there was an error opening your spellbook. Please try again.", { reply_to_message_id: message.message_id });
    }
  });
  // -- END NEW /spells COMMAND HANDLER --

  // ++ NEW /cast COMMAND HANDLER ++
  bot.onText(/^\/cast(?:@\w+)?\s+(\w[-\w]*)(?:\s+(.*))?$/i, async (message, match) => {
    const telegramUserId = message.from.id.toString();
    const platform = 'telegram';
    const slug = match[1];
    const overridesString = match[2];
    
    logger.info(`[Bot] /cast command received from UserID: ${telegramUserId} for slug: "${slug}"`);

    try {
        const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: telegramUserId,
            platformContext: { firstName: message.from.first_name, username: message.from.username }
        });
        const masterAccountId = findOrCreateResponse.data.masterAccountId;

        // Parse the overrides string. For now, we'll assume the entire
        // string is the value for the 'input_prompt' parameter.
        const parameterOverrides = {};
        if (overridesString) {
            // This assumes the first step of the spell wants an 'input_prompt'.
            // This is a strong convention we'll rely on for now.
            parameterOverrides.input_prompt = overridesString.trim();
            logger.info(`[Bot] Parsed overrides string "${overridesString}" into input_prompt.`);
        }

        const context = {
            masterAccountId,
            platform,
            telegramUserId,
            chatId: message.chat.id,
            messageId: message.message_id,
            parameterOverrides,
        };

        // Acknowledge the command immediately
        bot.sendMessage(message.chat.id, `Casting spell "${slug}"...`, { reply_to_message_id: message.message_id });

        // This is fire-and-forget. The result will be sent by the notifier.
        // We handle the promise rejection to report errors back to the user.
        spellsService.castSpell(slug, context)
          .catch(error => {
            logger.error(`[Bot] Asynchronous error during /cast for slug "${slug}":`, error.message, error.stack);
            const friendlyErrors = ['not found', 'permission', 'Multiple spells'];
            const isFriendly = friendlyErrors.some(term => error.message.includes(term));
            
            const errorMessage = isFriendly
                ? error.message
                : "Sorry, an unexpected error occurred while casting that spell.";
            
            // Escape the message for MarkdownV2, as it might contain characters like backticks from the error
            bot.sendMessage(context.chatId, escapeMarkdownV2(errorMessage), { 
                reply_to_message_id: context.messageId,
                parse_mode: 'MarkdownV2'
            });
        });

    } catch (error) {
        // This catch block handles synchronous errors from find-or-create, etc.
        let errorDetails = 'No details available';
        try {
            let loggableError = { message: error.message, stack: error.stack, name: error.name };
            if (error.response && error.response.data) {
                loggableError.responseData = error.response.data;
            }
            if (error.config) {
                loggableError.config = {
                    url: error.config.url,
                    method: error.config.method,
                }
            }
             if (error.code) {
                loggableError.code = error.code;
            }
            errorDetails = JSON.stringify(loggableError, null, 2);
        } catch (stringifyError) {
            errorDetails = `Could not stringify error. Message: ${error.message}`;
        }
        logger.error(`[Bot] Synchronous error processing /cast command for slug "${slug}": ${errorDetails}`);
        
        const errorMessage = "Sorry, there was an error preparing to cast the spell.";
        bot.sendMessage(message.chat.id, errorMessage, { reply_to_message_id: message.message_id });
    }
  });
  // -- END NEW /cast COMMAND HANDLER --

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
          await handleSettingsCallback(bot, callbackQuery, masterAccountId, { logger, toolRegistry, userSettingsService, replyContextManager });
          // Note: handleSettingsCallback is now responsible for bot.answerCallbackQuery(callbackQuery.id)

        } catch (error) {
          logger.error(`[Bot CB] Error in 'set_' callback logic (fetching MAID) for original user ${originalCommandUser.id}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, {text: "Error accessing your account for settings.", show_alert: true});
        }
      // ++ NEW 'spell_' (SPELL MENU) CALLBACK HANDLER ++
      } else if (data.startsWith('spell_')) {
        if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "This spellbook isn't for you.", show_alert: true });
          return;
        }
        const platform = 'telegram';
        const userForMaid = originalCommandUser || callbackQuery.from;
        logger.info(`[Bot CB] 'spell_' callback '${data}' from UserID ${callbackUserId} (MAID for user ${userForMaid.id})`);
        try {
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: userForMaid.id.toString(),
            platformContext: { firstName: userForMaid.first_name, username: userForMaid.username }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;
          logger.info(`[Bot CB] MasterAccountId ${masterAccountId} determined for user ${userForMaid.id} for spell menu.`);
          
          await handleSpellCallback(bot, callbackQuery, masterAccountId, { logger, toolRegistry, replyContextManager });
        } catch (error) {
          logger.error(`[Bot CB] Error in 'spell_' callback logic (fetching MAID) for user ${userForMaid.id}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, {text: "Error accessing your spellbook.", show_alert: true});
        }
      // ++ NEW 'mods:' (MODS MENU) CALLBACK HANDLER ++
      } else if (data.startsWith('mods:') || data.startsWith('mods_store:')) {
        // User specificity for Mod menu (same as settings)
        if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "This Mod menu isn't for you.", show_alert: true });
          return;
        }
        const platform = 'telegram';
        logger.info(`[Bot CB] 'mods:' callback '${data}' from UserID ${callbackUserId} (original cmd by ${originalCommandUser.id})`);
        try {
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: originalCommandUser.id.toString(),
            platformContext: { firstName: originalCommandUser.first_name, username: originalCommandUser.username }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;
          logger.info(`[Bot CB] MasterAccountId ${masterAccountId} determined for original command user ${originalCommandUser.id} for Mod menu.`);
          
          await handleModsCallback(bot, callbackQuery, masterAccountId, 
            { logger, internalApiClient, userSettingsService, toolRegistry, loRAPermissionsDb, replyContextManager } // Pass dependencies
          );
        } catch (error) {
          logger.error(`[Bot CB] Error in 'mods:' or 'mods_store:' callback logic (fetching MAID) for original user ${originalCommandUser.id}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, {text: "Error accessing your account for Mods.", show_alert: true});
        }
      // -- END NEW 'mods:' CALLBACK HANDLER --
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
          await bot.answerCallbackQuery(callbackQuery.id, { text: `${emoji}`, show_alert: false });
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
          const escapeMd = escapeMarkdownV2;

          // ++ NEW: Check if it's a spell ++
          if (generationRecord.metadata?.isSpell && Array.isArray(generationRecord.metadata?.stepGenerationIds)) {
              logger.info(`[Bot CB] Generation ${generationId} is a spell. Displaying spell info view.`);
              
              const spellName = generationRecord.metadata.spellName || 'Unnamed Spell';
              const userInput = generationRecord.metadata.userInputPrompt || 'No initial prompt.';
              
              let text = `*Spell: ${escapeMd(spellName)}*\\n\\n`;
              if (userInput) {
                text += `*Initial Input:*\\n\`\`\`\\n${escapeMd(userInput)}\\n\`\`\``;
              }

              // Fetch step generations to build buttons
              const stepGenerationIds = generationRecord.metadata.stepGenerationIds;
              
              // Use Promise.all to fetch all step generations in parallel
              const stepPromises = stepGenerationIds.map(stepGenId => 
                internalApiClient.get(`/generations/${stepGenId}`).catch(e => {
                  logger.error(`[Bot CB] Failed to fetch step generation ${stepGenId} for spell info view.`, e);
                  return null; // Return null on error
                })
              );
              const stepResponses = await Promise.all(stepPromises);

              const stepButtons = stepResponses.map((stepResponse, index) => {
                if (stepResponse && stepResponse.data) {
                  const stepGen = stepResponse.data;
                  let toolDisplayName = stepGen.metadata?.toolId || 'Unknown Tool';
                  const toolDef = toolRegistry.getToolById(stepGen.metadata?.toolId);
                  if (toolDef?.displayName) {
                    toolDisplayName = toolDef.displayName;
                  }
                  return {
                    text: `Step ${index + 1}: ${toolDisplayName}`,
                    callback_data: `view_spell_step:${generationId}:${index}`
                  };
                } else {
                  return {
                    text: `Step ${index + 1}: (Error loading)`,
                    callback_data: 'no_op'
                  };
                }
              });
              
              const keyboard = [];
              for (let i = 0; i < stepButtons.length; i += 2) {
                  keyboard.push(stepButtons.slice(i, i + 2));
              }

              // If coming from a media message (e.g. back from a step with an image),
              // we must delete and resend as we cannot edit a media message into a text message.
              if (callbackQuery.message.photo || callbackQuery.message.animation) {
                  await bot.deleteMessage(message.chat.id, message.message_id);
                  const replyToId = generationRecord.metadata?.notificationContext?.replyToMessageId || message.reply_to_message?.message_id;
                  await bot.sendMessage(message.chat.id, text, {
                      parse_mode: 'MarkdownV2',
                      reply_to_message_id: replyToId,
                      reply_markup: { inline_keyboard: keyboard }
                  });
              } else {
                  // This is either the first view or coming back from a text-only step.
                  // We can either edit the existing message or send a new one.
                  const messageText = callbackQuery.message.text || callbackQuery.message.caption || '';
                  // A bit of a heuristic: if the message doesn't already look like a spell view, send a new message.
                  // Otherwise, edit it. This handles both first-click and back-from-text-step.
                  const isAlreadySpellView = messageText.startsWith(`*Spell: ${escapeMd(spellName)}*`);

                  if (isAlreadySpellView) {
                      await bot.editMessageText(text, {
                          chat_id: message.chat.id,
                          message_id: message.message_id,
                          parse_mode: 'MarkdownV2',
                          reply_markup: { inline_keyboard: keyboard }
                      });
                  } else {
                      const replyToId = generationRecord.metadata?.notificationContext?.replyToMessageId || message.message_id;
                      await bot.sendMessage(message.chat.id, text, {
                          parse_mode: 'MarkdownV2',
                          reply_to_message_id: replyToId,
                          reply_markup: { inline_keyboard: keyboard }
                      });
                  }
              }

              await bot.answerCallbackQuery(callbackQuery.id);
              return; // End execution here for spells
          }
          // -- END NEW --

          let infoMessage = `*Generation Info*\\n`;

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

          infoMessage += `Tool: \`${escapeMd(toolDisplayName)}\`\\n`;

          if (generationRecord.requestPayload) {
            infoMessage += `\\n*Parameters Used:*\\n`;
            for (const [key, value] of Object.entries(generationRecord.requestPayload)) {
              if ((key === 'invoked_tool_id' || key === 'tool_id') && toolDisplayName === String(value)) continue;
              
              let displayKey = key;
              if (displayKey.startsWith('input_')) {
                displayKey = displayKey.substring(6); // Remove "input_" prefix
              }

              let valueToShow = value;
              // MODIFICATION: Prioritize userInputPrompt for display
              if (key === 'input_prompt' && generationRecord.metadata?.userInputPrompt) {
                valueToShow = generationRecord.metadata.userInputPrompt;
              }

              const displayValue = typeof valueToShow === 'object' ? JSON.stringify(valueToShow) : valueToShow;
              infoMessage += `  • *${escapeMd(displayKey)}*: \`${escapeMd(String(displayValue))}\\n`;
            }
          }

          if (generationRecord.ratings && Object.keys(generationRecord.ratings).length > 0) {
            let ratingsExist = false;
            let ratingsText = "\n*Current Ratings:*\\n";
            for (const [ratingType, userList] of Object.entries(generationRecord.ratings)) {
              if (userList && userList.length > 0) {
                ratingsText += `  • ${escapeMd(ratingType.charAt(0).toUpperCase() + ratingType.slice(1))}: ${escapeMd(String(userList.length))}\\n`;
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
          let errorDetails = 'No details available';
          try {
              let loggableError = { message: error.message, stack: error.stack, name: error.name };
              if (error.response && error.response.data) {
                  loggableError.responseData = error.response.data;
              }
              if (error.config) {
                  loggableError.config = { url: error.config.url, method: error.config.method };
              }
              if (error.code) {
                  loggableError.code = error.code;
              }
              errorDetails = JSON.stringify(loggableError, null, 2);
          } catch (stringifyError) {
              errorDetails = `Could not stringify error. Message: ${error.message}`;
          }
          logger.error(`[Bot CB] Error fetching or sending gen info for ${generationId}: ${errorDetails}`);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch generation info.", show_alert: true });
        }
      } else if (data.startsWith('view_spell_step:')) {
          const [, spellGenId, stepIndexStr] = data.split(':');
          const stepIndex = parseInt(stepIndexStr, 10);
          const { message } = callbackQuery;
          logger.info(`[Bot CB] view_spell_step callback for spell ${spellGenId}, step index ${stepIndex}`);

          try {
              const spellGenResponse = await internalApiClient.get(`/generations/${spellGenId}`);
              const spellGen = spellGenResponse.data;

              if (!spellGen || !spellGen.metadata?.stepGenerationIds) {
                  await bot.answerCallbackQuery(callbackQuery.id, { text: "Spell info not found.", show_alert: true });
                  return;
              }

              const stepGenId = spellGen.metadata.stepGenerationIds[stepIndex];
              if (!stepGenId) {
                  await bot.answerCallbackQuery(callbackQuery.id, { text: "Spell step info not found.", show_alert: true });
                  return;
              }

              const stepGenResponse = await internalApiClient.get(`/generations/${stepGenId}`);
              const stepGen = stepGenResponse.data;

              const escapeMd = escapeMarkdownV2;
              let infoCaption = `*Spell: ${escapeMd(spellGen.metadata.spellName)}* \\| *Step ${stepIndex + 1}*\\n`;

              let toolId = stepGen.metadata?.toolId || stepGen.serviceName;
              let toolDisplayName = toolId;
              const toolDef = toolRegistry.getToolById(toolId);
              if (toolDef?.displayName) { toolDisplayName = toolDef.displayName; }
              infoCaption += `Tool: \`${escapeMd(toolDisplayName)}\`\\n`;
              
              const buildParamsString = (params) => {
                  let text = '';
                  if (!params) return text;
                  for (const [key, value] of Object.entries(params)) {
                      if (['invoked_tool_id', 'tool_id', 'canonical_tool_id', '__canonicalToolId__'].includes(key)) continue;
                      
                      let displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                      
                      if (typeof displayValue === 'string' && (displayValue.includes('api.telegram.org/file/bot') || key === 'images' || key === 'animations')) {
                          continue; // Security: Don't leak token or show redundant raw data
                      }

                      let displayKey = key.startsWith('input_') ? key.substring(6) : key;
                      text += `  • *${escapeMd(displayKey)}*: \`${escapeMd(displayValue)}\`\\n`;
                  }
                  return text;
              };

              let paramsText = '';
              if (stepGen.requestPayload) {
                  paramsText += `\\n*Inputs:*\\n` + buildParamsString(stepGen.requestPayload);
              }
              if (stepGen.responsePayload?.[0]?.data) {
                  paramsText += `\\n*Outputs:*\\n` + buildParamsString(stepGen.responsePayload[0].data);
              }
              
              const maxLength = 1000; // Telegram caption limit is 1024
              if (infoCaption.length + paramsText.length > maxLength) {
                const availableLength = maxLength - infoCaption.length - 20;
                paramsText = paramsText.substring(0, availableLength) + "\\n... \\(truncated\\)";
              }
              infoCaption += paramsText;

              const keyboard = [[{ text: '⬅️ Back to Spell', callback_data: `view_gen_info:${spellGenId}` }]];
              
              // Check for media in the step output
              let imageUrl, animationUrl;
              const stepOutput = stepGen.responsePayload?.[0];
              if (stepOutput?.data?.images?.[0]?.url) imageUrl = stepOutput.data.images[0].url;
              if (stepOutput?.data?.animations?.[0]?.url) animationUrl = stepOutput.data.animations[0].url;
              if (stepOutput?.data?.videos?.[0]?.url) animationUrl = stepOutput.data.videos[0].url;
              if (!imageUrl && !animationUrl && stepOutput?.url) {
                  if (stepOutput.url.endsWith('.gif') || stepOutput.url.endsWith('.mp4')) animationUrl = stepOutput.url;
                  else if (['.png', '.jpg', '.jpeg', '.webp'].some(ext => stepOutput.url.endsWith(ext))) imageUrl = stepOutput.url;
              }

              // If we found media, we cannot edit the text message. We must delete and resend.
              if (imageUrl || animationUrl) {
                  await bot.deleteMessage(message.chat.id, message.message_id);
                  const replyToId = spellGen.metadata?.notificationContext?.replyToMessageId || message.reply_to_message?.message_id;
                  const mediaUrl = imageUrl || animationUrl;

                  const sendAction = imageUrl ? bot.sendPhoto.bind(bot) : bot.sendAnimation.bind(bot);
                  
                  await sendAction(message.chat.id, mediaUrl, {
                      caption: infoCaption.trim(),
                      parse_mode: 'MarkdownV2',
                      reply_to_message_id: replyToId,
                      reply_markup: { inline_keyboard: keyboard }
                  });

              } else {
                  // No media, just edit the text of the existing message
                  await bot.editMessageText(infoCaption.trim(), {
                      chat_id: message.chat.id,
                      message_id: message.message_id,
                      parse_mode: 'MarkdownV2',
                      reply_markup: { inline_keyboard: keyboard }
                  });
              }

              await bot.answerCallbackQuery(callbackQuery.id);

          } catch (error) {
              logger.error(`[Bot CB] Error in view_spell_step for spell ${spellGenId}:`, error.response ? error.response.data : error.message, error.stack);
              await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't fetch step info.", show_alert: true });
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
          const originalParams = generationRecord.requestPayload || {};
          
          // Log for toolId derivation
          logger.info(`[Bot CB] tweak_gen: Deriving toolId. generationRecord.serviceName: '${generationRecord.serviceName}', generationRecord.metadata: ${JSON.stringify(generationRecord.metadata)}, requestPayload: ${JSON.stringify(generationRecord.requestPayload)}`);

          let toolId = generationRecord.serviceName; // Fallback to serviceName if no specific toolId found
          if (generationRecord.requestPayload?.invoked_tool_id) {
            toolId = generationRecord.requestPayload.invoked_tool_id;
          } else if (generationRecord.requestPayload?.tool_id) {
            toolId = generationRecord.requestPayload.tool_id;
          } else if (generationRecord.metadata?.toolId) {
            toolId = generationRecord.metadata.toolId;
          }
          logger.info(`[Bot CB] tweak_gen: Resolved toolId: '${toolId}'`);

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
          
          // MODIFICATION: Use userInputPrompt for the editable prompt in pendingTweaks
          const userFacingPrompt = generationRecord.metadata?.userInputPrompt || originalParams.input_prompt;
          pendingTweaks[tweakSessionKey] = { 
            ...originalParams,
            input_prompt: userFacingPrompt, // Ensure the user edits their original prompt
            __canonicalToolId__: toolId // Store the canonicalToolId
          }; 
          logger.info(`[Bot CB] tweak_gen: Initialized pendingTweaks for sessionKey: ${tweakSessionKey} with user-facing prompt and params: ${JSON.stringify(pendingTweaks[tweakSessionKey])}`);

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
            logger.error(`[Bot CB] tweak_gen: Failed to build tweak UI menu for ${generationId}. Menu object: ${JSON.stringify(tweakMenu)}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not generate the tweak interface.", show_alert: true });
            // Clean up pending tweak session if menu build fails
            delete pendingTweaks[tweakSessionKey]; 
          }

        } catch (error) {
          let errorDetails = 'No details available';
          try {
            let loggableError = { message: error.message, stack: error.stack, name: error.name };
            if (error.response && error.response.data) {
              loggableError.responseData = error.response.data;
            }
            if (error.code) {
                loggableError.code = error.code;
            }
            errorDetails = JSON.stringify(loggableError, null, 2);
          } catch (stringifyError) {
            logger.error(`[Bot CB] tweak_gen: Failed to stringify error object: ${stringifyError.message}`);
            errorDetails = `Message: ${error.message}, Stack: ${error.stack}, Name: ${error.name}, Code: ${error.code || 'N/A'}`;
          }
          logger.error(`[Bot CB] Error in tweak_gen callback for ${generationId}: ${errorDetails}`);
          
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error initiating tweak mode.", show_alert: true });
          
          // We need clickerMasterAccountId to safely delete the session key
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId, // clickerTelegramId should be defined earlier
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountIdForCatch = findOrCreateUserResponse.data.masterAccountId;

          if (clickerMasterAccountIdForCatch) {
            const tweakSessionKey = `${generationId}_${clickerMasterAccountIdForCatch}`;
            delete pendingTweaks[tweakSessionKey];
            logger.info(`[Bot CB] tweak_gen (catch): Cleared pendingTweaks for sessionKey: ${tweakSessionKey} after error.`);
          } else {
            logger.warn(`[Bot CB] tweak_gen (catch): Could not retrieve MAID for ${clickerTelegramId} to clear session after error.`);
          }
        }
      } else if (data.startsWith('tweak_gen_menu_render:')) {
        const parts = data.split(':');
        const generationId = parts[1];
        const clickerTelegramId = callbackQuery.from.id.toString();

        logger.info(`[Bot CB] tweak_gen_menu_render callback for GenID: ${generationId}`);

        try {
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId,
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountId = findOrCreateUserResponse.data.masterAccountId;

          if (!clickerMasterAccountId) {
            logger.error(`[Bot CB] tweak_gen_menu_render: MAID not found for ${clickerTelegramId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Account not identified.", show_alert: true });
            return;
          }

          const tweakSessionKey = `${generationId}_${clickerMasterAccountId}`;
          const currentTweaks = pendingTweaks[tweakSessionKey];

          if (!currentTweaks) {
            logger.warn(`[Bot CB] tweak_gen_menu_render: No pending tweak session found for key ${tweakSessionKey}. Re-initiating tweak.`);
            // Attempt to re-trigger the main tweak_gen flow as if the button was just pressed.
            // This requires fetching the original generation to get toolId and original command context.
            const genResponse = await internalApiClient.get(`/generations/${generationId}`);
            const generationRecord = genResponse.data;
            if (!generationRecord) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Original generation not found to restart tweak.", show_alert: true });
                return;
            }
            let toolId = generationRecord.serviceName; // Basic fallback
            if (generationRecord.requestPayload?.invoked_tool_id) toolId = generationRecord.requestPayload.invoked_tool_id;
            else if (generationRecord.requestPayload?.tool_id) toolId = generationRecord.requestPayload.tool_id;
            else if (generationRecord.metadata?.toolId) toolId = generationRecord.metadata.toolId;

            const originalUserCommandMessageId = generationRecord.metadata?.telegramMessageId;
            const originalUserCommandChatId = generationRecord.metadata?.telegramChatId;

            if (!toolId || !originalUserCommandMessageId || !originalUserCommandChatId) {
                 await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Missing critical info to restart tweak.", show_alert: true });
                return;
            }
            
            pendingTweaks[tweakSessionKey] = { ...(generationRecord.requestPayload || {}) }; // Re-initialize

            const newTweakMenu = await buildTweakUIMenu(
                clickerMasterAccountId,
                toolId,
                pendingTweaks[tweakSessionKey],
                originalUserCommandMessageId,
                originalUserCommandChatId,
                generationId,
                { logger, toolRegistry, userSettingsService }
            );
             if (newTweakMenu && newTweakMenu.text && newTweakMenu.reply_markup) {
                // This is a callback, so we edit the message that had the 'cancel edit' button
                await bot.editMessageText(newTweakMenu.text, {
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    reply_markup: newTweakMenu.reply_markup,
                    parse_mode: 'MarkdownV2'
                });
            } else { throw new Error('Failed to rebuild tweak menu after session loss.'); }

          } else {
            // Session found, just re-render the main menu.
            // We need toolId. It should be part of pendingTweaks or retrievable.
            // For now, assume we re-fetch generation to get toolId consistently.
            const genResponse = await internalApiClient.get(`/generations/${generationId}`);
            const generationRecord = genResponse.data;
             if (!generationRecord) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Original generation not found to refresh tweak menu.", show_alert: true });
                return;
            }
            let toolId = generationRecord.serviceName; // Basic fallback
            if (generationRecord.requestPayload?.invoked_tool_id) toolId = generationRecord.requestPayload.invoked_tool_id;
            else if (generationRecord.requestPayload?.tool_id) toolId = generationRecord.requestPayload.tool_id;
            else if (generationRecord.metadata?.toolId) toolId = generationRecord.metadata.toolId;
            
            const originalUserCommandMessageId = generationRecord.metadata?.telegramMessageId; // Needed for buildTweakUIMenu
            const originalUserCommandChatId = generationRecord.metadata?.telegramChatId; // Needed for buildTweakUIMenu

            if (!toolId || !originalUserCommandMessageId || !originalUserCommandChatId) {
                 await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Missing critical info to refresh tweak menu.", show_alert: true });
                return;
            }

            const refreshedMenu = await buildTweakUIMenu(
                clickerMasterAccountId,
                toolId,
                currentTweaks,
                originalUserCommandMessageId,
                originalUserCommandChatId,
                generationId,
                { logger, toolRegistry, userSettingsService }
            );

            if (refreshedMenu && refreshedMenu.text && refreshedMenu.reply_markup) {
                await bot.editMessageText(refreshedMenu.text, {
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    reply_markup: refreshedMenu.reply_markup,
                    parse_mode: 'MarkdownV2'
                });
            } else { throw new Error('Failed to refresh tweak menu.'); }
          }
          await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
          logger.error(`[Bot CB] Error in tweak_gen_menu_render for ${generationId}:`, error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error refreshing tweak menu.", show_alert: true });
        }
      } else if (data.startsWith('tweak_apply:')) {
        const parts = data.split(':');
        const generationId = parts[1]; // This is the ID of the *original* generation being tweaked
        const clickerTelegramId = callbackQuery.from.id.toString();

        // ADD LOGGING FOR DEPENDENCIES WITHIN THIS CALLBACK SCOPE
        logger.info(`[Bot CB] tweak_apply callback for original GenID: ${generationId} from UserID: ${clickerTelegramId}`);

        try {
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId,
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountId = findOrCreateUserResponse.data.masterAccountId;

          if (!clickerMasterAccountId) {
            logger.error(`[Bot CB] tweak_apply: MAID not found for ${clickerTelegramId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Account not identified.", show_alert: true });
            return;
          }

          const tweakSessionKey = `${generationId}_${clickerMasterAccountId}`;
          const finalTweakedParams = pendingTweaks[tweakSessionKey];

          if (!finalTweakedParams) {
            logger.warn(`[Bot CB] tweak_apply: No pending tweak session found for key ${tweakSessionKey}. Cannot apply.`);
            await bot.editMessageText("Error: Your tweak session has expired. Please start tweaking again.", {
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: null
            });
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Session expired.", show_alert: true });
            return;
          }

          // Fetch the original generation record for toolId and original command context
          const genResponse = await internalApiClient.get(`/generations/${generationId}`);
          const originalGenerationRecord = genResponse.data;

          if (!originalGenerationRecord) {
            logger.error(`[Bot CB] tweak_apply: Original generation record ${generationId} not found.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Original generation not found.' });
            return;
          }

          const toolId = originalGenerationRecord.metadata?.toolId; // Corrected: toolId from metadata
          if (!toolId) {
            logger.error(`[Bot CB] tweak_apply: Original generation ${generationId} has no toolId in metadata.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Original generation has no tool ID.' });
            return;
          }

          // Use getToolById instead of getWorkflowById
          const workflow = await workflowsService.getToolById(toolId);

          if (!workflow) {
            logger.error(`[Bot CB] tweak_apply: Workflow not found for toolId ${toolId}. Original GenID: ${generationId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Original generation has no corresponding workflow.' });
            return;
          }

          const originalUserCommandMessageId = originalGenerationRecord.metadata?.telegramMessageId;
          const originalUserCommandChatId = originalGenerationRecord.metadata?.telegramChatId;
          const originalPlatformContext = originalGenerationRecord.metadata?.platformContext; // If used

          if (!toolId || !originalUserCommandMessageId || !originalUserCommandChatId) {
            logger.error(`[Bot CB] tweak_apply: Missing critical info (toolId, originalMsgId, originalChatId) from original gen ${generationId}.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Critical context from original generation is missing.", show_alert: true });
            delete pendingTweaks[tweakSessionKey];
            return;
          }

          // Determine initiatingEventId for the new generation
          let initiatingEventIdForNewGen;
          if (originalGenerationRecord.metadata?.initiatingEventId) {
            initiatingEventIdForNewGen = originalGenerationRecord.metadata.initiatingEventId;
            logger.info(`[Bot CB] tweak_apply: Copied initiatingEventId '${initiatingEventIdForNewGen}' from parent generation ${generationId}.`);
          } else {
            initiatingEventIdForNewGen = uuidv4();
            logger.info(`[Bot CB] tweak_apply: Parent generation ${generationId} missing initiatingEventId. Generated new one: '${initiatingEventIdForNewGen}'.`);
          }

          // Construct the payload for the new generation request
          const newGenerationPayload = {
            toolId: toolId, // The ID of the tool/service to run
            requestPayload: { ...finalTweakedParams }, // The tweaked parameters
            masterAccountId: clickerMasterAccountId, // User initiating this new tweaked generation
            platform: 'telegram',
            metadata: {
              telegramMessageId: originalUserCommandMessageId, // So new gen replies to original command
              telegramChatId: originalUserCommandChatId,
              platformContext: originalPlatformContext || { // Carry over or default
                telegramUserId: clickerTelegramId, // User who tweaked
                username: callbackQuery.from.username,
                firstName: callbackQuery.from.first_name
              },
              parentGenerationId: generationId, // Link to the generation that was tweaked
              isTweaked: true,
              initiatingEventId: initiatingEventIdForNewGen, // Store it in metadata as well
              costRate: originalGenerationRecord.metadata?.costRate, // ADDED: Carry over costRate
              notificationContext: originalGenerationRecord.metadata?.notificationContext, // ADDED: Carry over notificationContext
              toolId: toolId, // ADDED: Ensure specific toolId is in metadata
              userInputPrompt: finalTweakedParams.input_prompt // MODIFICATION: Store user's final prompt here
            }
          };

          logger.info(`[Bot CB] tweak_apply: Dispatching new tweaked generation for tool ${newGenerationPayload.toolId}. Original GenID: ${generationId}.`);

          // Step 1: Fetch/Create DB UserSession to get its _id
          let dbUserSessionId;
          try {
            const dbSessionResponse = await internalApiClient.post('/sessions', {
              masterAccountId: clickerMasterAccountId,
              platform: 'telegram'
            });
            if (dbSessionResponse && dbSessionResponse.data && dbSessionResponse.data._id) {
              dbUserSessionId = dbSessionResponse.data._id;
              logger.info(`[Bot CB] tweak_apply: Successfully fetched/created DB UserSession. ID: ${dbUserSessionId} for MAID ${clickerMasterAccountId}`);
            } else {
              logger.error(`[Bot CB] tweak_apply: Failed to get _id from DB UserSession response for MAID ${clickerMasterAccountId}. Response: ${JSON.stringify(dbSessionResponse.data)}`);
              // Critical step failed, alert user and abort
              await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Failed to initialize user session for tweak.", show_alert: true });
              return;
            }
          } catch (dbSessionError) {
            logger.error(`[Bot CB] tweak_apply: Error creating/fetching DB UserSession for MAID ${clickerMasterAccountId}: ${dbSessionError.message}.`, dbSessionError.response?.data || dbSessionError);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not establish session for tweak.", show_alert: true });
            return;
          }

          // Step 2: Log the User Event for this tweak action
          let newEventId;
          try {
            const eventPayload = {
              masterAccountId: clickerMasterAccountId,
              sessionId: dbUserSessionId, // Use the DB UserSession ID
              eventType: 'tweak_generation_request',
              eventData: {
                originalGenerationId: generationId,
                toolId: newGenerationPayload.toolId,
                tweakedParameters: finalTweakedParams // Contains __canonicalToolId__ if stored
              },
              sourcePlatform: 'telegram'
            };
            const eventResponse = await internalApiClient.post('/events', eventPayload);
            if (eventResponse && eventResponse.data && eventResponse.data._id) {
              newEventId = eventResponse.data._id;
              logger.info(`[Bot CB] tweak_apply: Successfully logged UserEvent for tweak. EventID: ${newEventId}`);
            } else {
              logger.error(`[Bot CB] tweak_apply: Failed to log UserEvent or get _id. Response: ${JSON.stringify(eventResponse.data)}`);
              // Non-critical for generation itself, but important for audit. Log and continue.
              // OR: Decide if this is critical enough to stop. For now, let's assume we can proceed.
            }
          } catch (eventLogError) {
            logger.error(`[Bot CB] tweak_apply: Error logging UserEvent: ${eventLogError.message}.`, eventLogError.response?.data || eventLogError);
            // Continue, newEventId will be undefined. Generation logging will fail if API requires it.
          }
          
          // If newEventId is still undefined, the /generations POST will likely fail due to schema validation.
          // We should handle this more gracefully. For now, the API will reject.
          // Consider using the original initiatingEventId if this step fails and parent has one?
          // For now, let's enforce creating a new event or using a valid existing one.
          // The previous logic for copying initiatingEventId if present in parent is GONE.
          // We MUST have a newEventId (or make the API for /generations allow it to be optional).
          // Let's re-introduce the logic to use parent's initiatingEventId if it exists AND new event logging fails.
          
          let finalInitiatingEventId = newEventId; // Prefer the new event
          if (!finalInitiatingEventId && originalGenerationRecord.metadata?.initiatingEventId) {
              // Only use parent's if our attempt to create a new one failed AND parent had one.
              finalInitiatingEventId = originalGenerationRecord.metadata.initiatingEventId;
              logger.warn(`[Bot CB] tweak_apply: Failed to log new UserEvent, falling back to parent's initiatingEventId: ${finalInitiatingEventId}`);
          } else if (!finalInitiatingEventId) {
              // If still no eventId, and parent didn't have one either, we have a problem.
              // The API for POST /generations expects initiatingEventId.
              // For robustness, we might generate a fallback UUID here *if and only if* the API allows it.
              // Given the previous "Invalid initiatingEventId format" error for UUIDs, this is unlikely.
              // Best to make sure the API for POST /events is robust.
              // If it's truly missing, the POST /generations will fail with the schema validation as intended.
              logger.error(`[Bot CB] tweak_apply: Critical - No valid initiatingEventId could be determined (new event failed, parent had none). POST /generations will likely fail.`);
          }

          // 3. Log the new generation intent
          const generationToLog = {
            toolId: newGenerationPayload.toolId,
            requestPayload: { ...finalTweakedParams }, // MODIFICATION: User's tweaked prompt goes here directly
            masterAccountId: clickerMasterAccountId,
            platform: 'telegram',
            sessionId: dbUserSessionId, 
            initiatingEventId: finalInitiatingEventId, // Use the eventId from the logged UserEvent
            status: 'pending',
            deliveryStatus: 'pending',
            notificationPlatform: 'telegram', // So notifier knows
            serviceName: originalGenerationRecord.serviceName || 'ComfyUI', // Carry over service name
            workflowId: originalGenerationRecord.workflowId, // Carry over workflowId
            metadata: newGenerationPayload.metadata // Contains reply info, parentGenId, isTweaked, userInputPrompt etc.
          };

          const newGenerationLogResponse = await internalApiClient.post('/generations', generationToLog);
          const newGeneratedId = newGenerationLogResponse.data._id;
          logger.info(`[Bot CB] tweak_apply: New generation successfully logged with ID: ${newGeneratedId}.`);

          // 4. Dispatch to the actual service (e.g., ComfyUI)
          let run_id;
          // Determine deploymentId - dynamicCommands.js uses tool.metadata.deploymentId
          // We should use what was likely used for the original generation.
          let deploymentId = originalGenerationRecord.metadata?.deploymentId || originalGenerationRecord.workflowId || originalGenerationRecord.metadata?.toolId;
          
          if (deploymentId && typeof deploymentId === 'string' && deploymentId.startsWith('comfy-')) {
            deploymentId = deploymentId.substring(6);
          }

          if (!deploymentId) {
            logger.error(`[Bot CB] tweak_apply: Could not determine ComfyUI deploymentId for new gen ${newGeneratedId} (from original ${generationId}). Original metadata: ${JSON.stringify(originalGenerationRecord.metadata)}`);
            throw new Error('ComfyUI Deployment ID not found for tweaked generation.');
          }
          
          logger.info(`[Bot CB] tweak_apply: Submitting to ComfyUI. DeploymentID: ${deploymentId}, GenID (new): ${newGeneratedId}. Inputs: ${JSON.stringify(finalTweakedParams)}`);

          if (originalGenerationRecord.serviceName === 'comfyui' && comfyuiService) {
            const submissionResult = await comfyuiService.submitRequest({
              deploymentId: deploymentId, // This should be the specific Comfy workflow/deployment identifier
              inputs: finalTweakedParams, // These are the tweaked parameters
            });
            
            run_id = (typeof submissionResult === 'string') ? submissionResult : submissionResult?.run_id;

            if (!run_id) {
              const errorMessage = submissionResult?.error ? (typeof submissionResult.error === 'string' ? submissionResult.error : submissionResult.error.message) : 'Unknown error during ComfyUI submission';
              logger.error(`[Bot CB] tweak_apply: ComfyUI submission failed for new GenID ${newGeneratedId}. Error: ${errorMessage}`);
              await internalApiClient.put(`/generations/${newGeneratedId}`, { status: 'failed', statusReason: `ComfyUI submission failed: ${errorMessage}` });
              throw new Error(`ComfyUI submission failed: ${errorMessage}`);
            }
            logger.info(`[Bot CB] tweak_apply: ComfyUI submission successful for new GenID ${newGeneratedId}. Run ID: ${run_id}. Linking...`);
            await internalApiClient.put(`/generations/${newGeneratedId}`, { "metadata.run_id": run_id, status: 'processing' }); // Update status to processing
          } else {
            // Handle other services if necessary, or throw error if service unknown/unsupported for tweak
            logger.error(`[Bot CB] tweak_apply: Service ${originalGenerationRecord.serviceName} not supported for direct tweak dispatch or comfyui service in dependencies is missing/invalid. Has comfyuiService: ${!!comfyuiService}`);
            await internalApiClient.put(`/generations/${newGeneratedId}`, { status: 'failed', statusReason: `Service ${originalGenerationRecord.serviceName} not supported for tweaked dispatch.` });
            throw new Error(`Service ${originalGenerationRecord.serviceName} not supported for tweaked generation.`);
          }
          
          // Feedback to user & cleanup
          await bot.editMessageText("🚀 Your tweaked generation is on its way!", {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: null // Remove keyboard
          });
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Tweaked generation sent!" });

          delete pendingTweaks[tweakSessionKey];
          logger.info(`[Bot CB] tweak_apply: Cleared pendingTweaks for sessionKey: ${tweakSessionKey}`);

        } catch (error) {
          logger.error(`[Bot CB] Error in tweak_apply for original GenID ${generationId}:`, error.response?.data || error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error sending tweaked generation.", show_alert: true });
          // Optionally, keep the pendingTweaks session if dispatch fails, allowing user to retry?
          // For now, it's cleared on next successful apply or cancel.
        }
      } else if (data.startsWith('rerun_gen:')) {
        const parts = data.split(':');
        const originalGenerationId = parts[1];
        const pressCount = parseInt(parts[2] || '0', 10); // Parse current press count, default 0 if not present
        const clickerTelegramId = callbackQuery.from.id.toString();

        logger.info(`[Bot CB] rerun_gen callback for Original GenID: ${originalGenerationId}, Press Count: ${pressCount}, from UserID: ${clickerTelegramId}`);
        // ADD LOGGING FOR DEPENDENCIES SIMILAR TO TWEAK_APPLY IF NEEDED

        try {
          let newEventIdForRerun; // Declare newEventIdForRerun here
          const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: clickerTelegramId,
            platformContext: { firstName: callbackQuery.from.first_name, username: callbackQuery.from.username }
          });
          const clickerMasterAccountId = findOrCreateUserResponse.data.masterAccountId;

          if (!clickerMasterAccountId) {
            logger.error(`[Bot CB] rerun_gen: MAID not found for ${clickerTelegramId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Account not identified.", show_alert: true });
            return;
          }

          // Fetch the original generation record
          const genResponse = await internalApiClient.get(`/generations/${originalGenerationId}`);
          const originalGenerationRecord = genResponse.data;

          if (!originalGenerationRecord || !originalGenerationRecord.requestPayload) {
            logger.error(`[Bot CB] rerun_gen: Original generation record ${originalGenerationId} or its requestPayload not found.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Original generation details missing for rerun.", show_alert: true });
            return;
          }

          // Robust toolId resolution
          let toolId = originalGenerationRecord.serviceName; // Fallback to serviceName
          if (originalGenerationRecord.requestPayload?.invoked_tool_id) {
            toolId = originalGenerationRecord.requestPayload.invoked_tool_id;
          } else if (originalGenerationRecord.requestPayload?.tool_id) {
            toolId = originalGenerationRecord.requestPayload.tool_id;
          } else if (originalGenerationRecord.metadata?.toolId) {
            toolId = originalGenerationRecord.metadata.toolId;
          }
          
          if (!toolId) {
            logger.error(`[Bot CB] rerun_gen: Could not resolve toolId for original generation ${originalGenerationId}. Checked serviceName, requestPayload, and metadata.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Original generation has no resolvable tool ID.' });
            return;
          }
          logger.info(`[Bot CB] rerun_gen: Resolved toolId as '${toolId}' for original generation ${originalGenerationId}.`);

          // Use getToolById instead of getWorkflowById
          const workflow = await workflowsService.getToolById(toolId);

          if (!workflow) {
            logger.error(`[Bot CB] rerun_gen: Workflow not found for toolId ${toolId}. Original GenID: ${originalGenerationId}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Original generation has no corresponding workflow.' });
            return;
          }

          const originalUserCommandMessageId = originalGenerationRecord.metadata?.telegramMessageId;
          const originalUserCommandChatId = originalGenerationRecord.metadata?.telegramChatId;
          const originalPlatformContext = originalGenerationRecord.metadata?.platformContext;

          if (!toolId || !originalUserCommandMessageId || !originalUserCommandChatId) {
            logger.error(`[Bot CB] rerun_gen: Missing critical info (toolId, originalMsgId, originalChatId) from original gen ${originalGenerationId}.`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Critical context from original generation is missing.", show_alert: true });
            return;
          }

          // Prepare the new request payload by copying the original and modifying the seed
          const newRequestPayload = { ...originalGenerationRecord.requestPayload };
          const oldSeed = newRequestPayload.input_seed;
          newRequestPayload.input_seed = Math.floor(Math.random() * 1000000000);
          logger.info(`[Bot CB] rerun_gen: Assigned new random seed: ${newRequestPayload.input_seed} (old seed was: ${oldSeed === undefined ? 'N/A' : oldSeed})`);

          // MODIFICATION: Determine user-facing prompt for rerun
          const userFacingPromptForRerun = originalGenerationRecord.metadata?.userInputPrompt || originalGenerationRecord.requestPayload.input_prompt;
          newRequestPayload.input_prompt = userFacingPromptForRerun; // Set it in the payload to be sent

          // Step X: Fetch/Create DB UserSession to get its _id for the rerun
          // NOTE: Moved this earlier to ensure dbUserSessionIdForRerun is available for event logging
          let dbUserSessionIdForRerun;
          try {
            const dbSessionResponse = await internalApiClient.post('/sessions', {
              masterAccountId: clickerMasterAccountId,
              platform: 'telegram'
            });
            if (dbSessionResponse && dbSessionResponse.data && dbSessionResponse.data._id) {
              dbUserSessionIdForRerun = dbSessionResponse.data._id;
              logger.info(`[Bot CB] rerun_gen: Successfully fetched/created DB UserSession. ID: ${dbUserSessionIdForRerun} for MAID ${clickerMasterAccountId}`);
            } else {
              logger.error(`[Bot CB] rerun_gen: Failed to get _id from DB UserSession response for MAID ${clickerMasterAccountId}. Response: ${JSON.stringify(dbSessionResponse.data)}`);
              await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Failed to initialize user session for rerun.", show_alert: true });
              return;
            }
          } catch (dbSessionError) {
            logger.error(`[Bot CB] rerun_gen: Error creating/fetching DB UserSession for MAID ${clickerMasterAccountId}: ${dbSessionError.message}.`, dbSessionError.response?.data || dbSessionError);
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Could not establish session for rerun.", show_alert: true });
            return;
          }

          // BEGIN ADDITION: Log the User Event for this rerun action
          try {
            const rerunEventPayload = {
              masterAccountId: clickerMasterAccountId,
              sessionId: dbUserSessionIdForRerun, // Use the DB UserSession ID obtained above
              eventType: 'rerun_generation_request',
              eventData: {
                originalGenerationId: originalGenerationId,
                toolId: toolId, // toolId resolved earlier
                newSeed: newRequestPayload.input_seed // Log the new seed specifically for rerun
              },
              sourcePlatform: 'telegram'
            };
            const rerunEventResponse = await internalApiClient.post('/events', rerunEventPayload);
            if (rerunEventResponse && rerunEventResponse.data && rerunEventResponse.data._id) {
              newEventIdForRerun = rerunEventResponse.data._id;
              logger.info(`[Bot CB] rerun_gen: Successfully logged UserEvent for rerun. EventID: ${newEventIdForRerun}`);
            } else {
              logger.error(`[Bot CB] rerun_gen: Failed to log UserEvent for rerun or get _id. Response: ${JSON.stringify(rerunEventResponse.data)}`);
              // newEventIdForRerun will remain undefined, fallback logic will apply
            }
          } catch (rerunEventLogError) {
            logger.error(`[Bot CB] rerun_gen: Error logging UserEvent for rerun: ${rerunEventLogError.message}.`, rerunEventLogError.response?.data || rerunEventLogError);
            // newEventIdForRerun will remain undefined, fallback logic will apply
          }
          // END ADDITION

          // Determine the top-level initiatingEventId for the new generation record.
          // Priority: 
          // 1. newEventIdForRerun (event for this specific rerun action).
          // 2. If newEventIdForRerun failed, use parent\'s metadata.initiatingEventId.
          // 3. If both above are unavailable, generate a new UUID as a last resort.
          let finalTopLevelInitiatingEventId;
          if (newEventIdForRerun) {
            finalTopLevelInitiatingEventId = newEventIdForRerun;
          } else if (originalGenerationRecord.metadata?.initiatingEventId) {
            finalTopLevelInitiatingEventId = originalGenerationRecord.metadata.initiatingEventId;
            logger.warn(`[Bot CB] rerun_gen: New event logging failed. Using parent's initiatingEventId from metadata (${finalTopLevelInitiatingEventId}) for the new generation record's top-level initiatingEventId.`);
          } else {
            finalTopLevelInitiatingEventId = uuidv4();
            logger.error(`[Bot CB] rerun_gen: Critical - New event logging failed AND parent metadata missing initiatingEventId. Generated fallback UUID ${finalTopLevelInitiatingEventId} for new generation's top-level initiatingEventId.`);
          }

          // Determine the initiatingEventId to be stored IN THE METADATA of the new generation.
          // This should ideally trace back to the true original user command.
          // Priority:
          // 1. Parent's metadata.initiatingEventId (if it exists, it's the true origin).
          // 2. newEventIdForRerun (if parent didn't have one, this rerun event is the origin for this chain in metadata).
          // 3. finalTopLevelInitiatingEventId (as a last fallback, though less ideal for metadata's purpose here).
          const metadataInitiatingEventId = originalGenerationRecord.metadata?.initiatingEventId || newEventIdForRerun || finalTopLevelInitiatingEventId;
          if (originalGenerationRecord.metadata?.initiatingEventId) {
            logger.info(`[Bot CB] rerun_gen: Parent generation ${originalGenerationId} had metadata.initiatingEventId: ${originalGenerationRecord.metadata.initiatingEventId}. This will be used in new gen's metadata.`);
          } else {
            logger.info(`[Bot CB] rerun_gen: Parent generation ${originalGenerationId} did NOT have metadata.initiatingEventId. Using ${metadataInitiatingEventId} for new gen's metadata.`);
          }
          // let checkpointVariable = 'ALPHA_REACHED';
          // logger.info(`<<<<< CHECKPOINT VAR: ${checkpointVariable} >>>>>`); // REMOVED DEBUG LOG
          logger.debug('[Bot CB] rerun_gen: PRE-CONSTRUCTING rerunGenerationMetadata object.');
          
          // Construct metadata for the RERUN generation itself
          const rerunGenerationMetadata = {
            telegramMessageId: originalUserCommandMessageId, 
            telegramChatId: originalUserCommandChatId,
            platformContext: originalPlatformContext || {
              telegramUserId: clickerTelegramId,
              username: callbackQuery.from.username,
              firstName: callbackQuery.from.first_name
            },
            parentGenerationId: originalGenerationId,
            isRerun: true,
            costRate: originalGenerationRecord.metadata?.costRate, 
            notificationContext: originalGenerationRecord.metadata?.notificationContext, 
            initiatingEventId: metadataInitiatingEventId, // Use the correctly scoped variable from above
            toolId: toolId, 
            rerunCount: (originalGenerationRecord.metadata?.rerunCount || 0) + 1,
            userInputPrompt: userFacingPromptForRerun // MODIFICATION: Store the user-facing prompt here
          };
          
          logger.debug('[Bot CB] rerun_gen: POST-CONSTRUCTED rerunGenerationMetadata object. Content:', JSON.stringify(rerunGenerationMetadata, null, 2));
          logger.debug(`[Bot CB] rerun_gen: PRE-JSON.STRINGIFY for newRequestPayload. typeof newRequestPayload: ${typeof newRequestPayload}. Keys: ${newRequestPayload ? Object.keys(newRequestPayload).join(', ') : 'N/A'}`);
          let stringifiedPayloadForLog;
          try {
            stringifiedPayloadForLog = JSON.stringify(newRequestPayload);
          } catch (stringifyError) {
            logger.error(`[Bot CB] rerun_gen: ERROR during JSON.stringify(newRequestPayload): ${stringifyError.message}`, { payloadKeys: newRequestPayload ? Object.keys(newRequestPayload) : 'N/A' });
            stringifiedPayloadForLog = "[Error stringifying payload]";
          }
          logger.debug('[Bot CB] rerun_gen: POST-JSON.STRINGIFY for newRequestPayload.');

          logger.info(`[Bot CB] rerun_gen: Dispatching rerun for tool ${toolId}. Original GenID: ${originalGenerationId}. New payload (seed modified): ${stringifiedPayloadForLog}`);
          
          // 3. Log the new generation intent (this section title "3. Log the new generation intent" is a bit confusingly placed, it refers to the DB record below)
          const generationToLog = {
            toolId: toolId,
            requestPayload: newRequestPayload, // MODIFICATION: This now contains the correct user-facing prompt
            masterAccountId: clickerMasterAccountId,
            platform: 'telegram',
            sessionId: dbUserSessionIdForRerun, 
            initiatingEventId: finalTopLevelInitiatingEventId, // Use the determined top-level ID
            status: 'pending',
            deliveryStatus: 'pending',
            notificationPlatform: 'telegram',
            serviceName: originalGenerationRecord.serviceName || 'ComfyUI',
            workflowId: originalGenerationRecord.workflowId,
            metadata: rerunGenerationMetadata
          };

          const newGenerationLogResponse = await internalApiClient.post('/generations', generationToLog);
          const newGeneratedId = newGenerationLogResponse.data._id;
          logger.info(`[Bot CB] rerun_gen: New generation (rerun) successfully logged with ID: ${newGeneratedId}.`);

          // 4. Dispatch to the actual service (e.g., ComfyUI)
          let run_id;
          let deploymentId = originalGenerationRecord.metadata?.deploymentId || originalGenerationRecord.workflowId || originalGenerationRecord.metadata?.toolId;
          if (deploymentId && typeof deploymentId === 'string' && deploymentId.startsWith('comfy-')) {
            deploymentId = deploymentId.substring(6);
          }

          if (!deploymentId) {
            logger.error(`[Bot CB] rerun_gen: Could not determine ComfyUI deploymentId for new gen ${newGeneratedId}.`);
            throw new Error('ComfyUI Deployment ID not found for rerun generation.');
          }

          if (originalGenerationRecord.serviceName === 'comfyui' && comfyuiService) {
            const submissionResult = await comfyuiService.submitRequest({
              deploymentId: deploymentId,
              inputs: newRequestPayload,
            });
            run_id = (typeof submissionResult === 'string') ? submissionResult : submissionResult?.run_id;

            if (!run_id) {
              const errorMessage = submissionResult?.error ? (typeof submissionResult.error === 'string' ? submissionResult.error : submissionResult.error.message) : 'Unknown error during ComfyUI submission';
              logger.error(`[Bot CB] rerun_gen: ComfyUI submission failed for new GenID ${newGeneratedId}. Error: ${errorMessage}`);
              await internalApiClient.put(`/generations/${newGeneratedId}`, { status: 'failed', statusReason: `ComfyUI submission failed: ${errorMessage}` });
              throw new Error(`ComfyUI submission failed: ${errorMessage}`);
            }
            logger.info(`[Bot CB] rerun_gen: ComfyUI submission successful for new GenID ${newGeneratedId}. Run ID: ${run_id}. Linking...`);
            await internalApiClient.put(`/generations/${newGeneratedId}`, { "metadata.run_id": run_id, status: 'processing' });

            // Update the inline keyboard to reflect the new press count for this button
            const newPressCount = pressCount + 1;
            if (message.reply_markup && message.reply_markup.inline_keyboard) {
              const newKeyboard = JSON.parse(JSON.stringify(message.reply_markup.inline_keyboard)); // Deep copy
              let buttonFoundAndUpdated = false;
              for (let i = 0; i < newKeyboard.length; i++) {
                for (let j = 0; j < newKeyboard[i].length; j++) {
                  // Match based on originalGenerationId part of callback_data
                  const buttonCallbackParts = newKeyboard[i][j].callback_data.split(':');
                  if (buttonCallbackParts[0] === 'rerun_gen' && buttonCallbackParts[1] === originalGenerationId) {
                    newKeyboard[i][j].text = `↻${newPressCount}`; // Update text with new press count
                    newKeyboard[i][j].callback_data = `rerun_gen:${originalGenerationId}:${newPressCount}`; // Update callback_data with new press count
                    buttonFoundAndUpdated = true;
                    break;
                  }
                }
                if (buttonFoundAndUpdated) break;
              }

              if (buttonFoundAndUpdated) {
                try {
                  await bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, {
                    chat_id: message.chat.id,
                    message_id: message.message_id
                  });
                  logger.info(`[Bot CB] rerun_gen: Successfully updated keyboard for GenID ${originalGenerationId} to PressCount ${newPressCount}`);
                } catch (editError) {
                  const errorResponse = editError.response?.body ? JSON.stringify(editError.response.body) : editError.message;
                  logger.warn(`[Bot CB] rerun_gen: Failed to update keyboard for PressCount. GenID ${originalGenerationId}. Error: ${errorResponse}`);
                }
              } else {
                logger.warn(`[Bot CB] rerun_gen: Could not find the original rerun button (matching GenID ${originalGenerationId}) to update its count.`);
              }
            } else {
              logger.warn(`[Bot CB] rerun_gen: Original message for GenID ${originalGenerationId} did not have an inline keyboard to update.`);
            }
          } else {
            logger.error(`[Bot CB] rerun_gen: Service ${originalGenerationRecord.serviceName} not supported or comfyui service in dependencies is missing/invalid. Has comfyuiService: ${!!comfyuiService}`);
            await internalApiClient.put(`/generations/${newGeneratedId}`, { status: 'failed', statusReason: `Service ${originalGenerationRecord.serviceName} not supported for rerun.` });
            throw new Error(`Service ${originalGenerationRecord.serviceName} not supported for rerun.`);
          }

          await bot.answerCallbackQuery(callbackQuery.id, { text: "Rerun initiated!" });

        } catch (error) {
          // logger.info('[DEBUG_CATCH_BLOCK] Entered CATCH block in rerun_gen.'); // REMOVED DEBUG LOG
          
          // logger.error(`[Bot CB] RAW ERROR CAUGHT for GenID ${originalGenerationId}. Attempting to log basic info.`); // REMOVED DEBUG LOG
          
          // try { // REMOVED DEBUG LOGGING BLOCK
          //   logger.error(`[Bot CB] Error type: ${typeof error}`);
          //   if (error && typeof error === 'object') {
          //     logger.error(`[Bot CB] Error keys: ${Object.keys(error).join(', ')}`);
          //   }
          // } catch (e) {
          //   logger.error('[Bot CB] Failed to log error type/keys.');
          // }

          // try { // REMOVED DEBUG LOGGING BLOCK
          //   const errorMessage = error ? (error.message || 'No error.message property') : 'Error object is null/undefined';
          //   logger.error(`[Bot CB] Minimal Error Message for GenID ${originalGenerationId}: ${errorMessage}`);
          // } catch (e) {
          //   logger.error(`[Bot CB] CRITICAL: Failed to even get error.message for GenID ${originalGenerationId}. Logging raw error object next.`);
          //   try {
          //       console.error("[RAW CONSOLE ERROR]", error); 
          //   } catch (rawErr) {
          //       console.error("[RAW CONSOLE ERROR FAILED]", rawErr);
          //   }
          // }
          
          logger.error(`[Bot CB] Error in rerun_gen for Original GenID ${originalGenerationId}:`, error.response?.data || error.message, error.stack); 

          await bot.answerCallbackQuery(callbackQuery.id, { text: "Error rerunning generation.", show_alert: true });
        }
      } else if (data.startsWith('admin_mod_approve:') || data.startsWith('admin_mod_reject:')) {
        const callbackUserIdStr = callbackQuery.from.id.toString();
        const adminTelegramId = '5472638766'; // Your Telegram User ID for admin actions

        logger.info(`[Bot CB] Admin Mod approval/rejection callback: ${data} from UserID: ${callbackUserIdStr}`);

        if (callbackUserIdStr !== adminTelegramId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "🚫 This action is for admins only.", show_alert: true });
          return;
        }

        const parts = data.split(':');
        const action = parts[0]; // 'admin_mod_approve' or 'admin_mod_reject'
        const loraIdentifier = parts[1];

        let apiEndpoint = '';
        let successMessage = '';
        let failureMessage = '';

        if (action === 'admin_mod_approve') {
          apiEndpoint = `/loras/${loraIdentifier}/admin-approve`;
          successMessage = '✅ Mod Approved & Deployment Initiated';
          failureMessage = '⚠️ Error approving Mod';
        } else { // admin_mod_reject
          apiEndpoint = `/loras/${loraIdentifier}/admin-reject`;
          successMessage = '❌ Mod Rejected';
          failureMessage = '⚠️ Error rejecting Mod';
        }

        try {
          // Call the internal API - Assuming POST request, adjust if different
          // We'll need to pass the admin's MasterAccountId if the API needs to record who approved/rejected.
          // For now, the API endpoint itself implies admin action.
          logger.info(`[Bot CB] Calling internal API: POST ${apiEndpoint}`);
          const response = await internalApiClient.post(apiEndpoint, {}); // Empty body for now, or add admin MAID if needed

          if (response.status === 200 || response.status === 202) {
            await bot.editMessageText(
              escapeMarkdownV2(message.text + `\n\n---\n*Action Taken: ${successMessage}* by Admin ${callbackUserIdStr} at ${new Date().toISOString()}`),
              {
                chat_id: message.chat.id,
                message_id: message.message_id,
                parse_mode: 'MarkdownV2',
                reply_markup: null // Remove buttons
              }
            );
            await bot.answerCallbackQuery(callbackQuery.id, { text: response.data.message || successMessage });
          } else {
            const errorDetail = response.data?.details || response.data?.error || 'Unknown API error';
            logger.error(`[Bot CB] Admin Mod action API call failed for ${loraIdentifier}. Status: ${response.status}, Error: ${errorDetail}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `${failureMessage}: ${errorDetail}`, show_alert: true });
          }
        } catch (error) {
          const errorDetail = error.response?.data?.details || error.response?.data?.error || error.message;
          logger.error(`[Bot CB] Error in admin Mod action for ${loraIdentifier} (${action}):`, errorDetail, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: `${failureMessage}. Details: ${errorDetail}`, show_alert: true });
        }

      } else if (data.startsWith('admin_mod_approve_private:')) {
        const callbackUserIdStr = callbackQuery.from.id.toString();
        const adminTelegramId = '5472638766'; // Your Telegram User ID for admin actions

        logger.info(`[Bot CB] Admin Mod private approval callback: ${data} from UserID: ${callbackUserIdStr}`);

        if (callbackUserIdStr !== adminTelegramId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "🚫 This action is for admins only.", show_alert: true });
          return;
        }

        const parts = data.split(':');
        const loraIdentifier = parts[1];
        const apiEndpoint = `/loras/${loraIdentifier}/admin-approve-private`;
        const successMessageBase = '🔒 Mod Approved Privately';
        const failureMessage = '⚠️ Error privately approving Mod';

        try {
          logger.info(`[Bot CB] Calling internal API: POST ${apiEndpoint}`);
          const response = await internalApiClient.post(apiEndpoint, {}); 

          if (response.status === 200 || response.status === 202) {
            await bot.editMessageText(
              escapeMarkdownV2(message.text + `\n\n---\n*Action Taken: ${successMessageBase}* by Admin ${callbackUserIdStr} at ${new Date().toISOString()}`), 
              {
                chat_id: message.chat.id,
                message_id: message.message_id,
                parse_mode: 'MarkdownV2',
                reply_markup: null 
              }
            );
            await bot.answerCallbackQuery(callbackQuery.id, { text: response.data.message || successMessageBase });
          } else {
            const errorDetail = response.data?.details || response.data?.error || 'Unknown API error';
            logger.error(`[Bot CB] Admin Mod private approval API call failed for ${loraIdentifier}. Status: ${response.status}, Error: ${errorDetail}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: `${failureMessage}: ${errorDetail}`, show_alert: true });
          }
        } catch (error) {
          const errorDetail = error.response?.data?.details || error.response?.data?.error || error.message;
          logger.error(`[Bot CB] Error in admin Mod private approval action for ${loraIdentifier}:`, errorDetail, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: `${failureMessage}. Details: ${errorDetail}`, show_alert: true });
        }

      } else if (data.startsWith('mods:')) {
        const telegramUserId = message.from.id.toString();
        const platform = 'telegram';
        logger.info(`[Bot] /mods command received from Telegram User ID: ${telegramUserId}`);
        try {
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: telegramUserId,
            platformContext: { firstName: message.from.first_name, username: message.from.username }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;
          logger.info(`[Bot] MasterAccountId ${masterAccountId} found/created for Telegram User ID: ${telegramUserId} for /mods`);
          
          // Pass all dependencies that modsMenuManager might need
          await handleModsCommand(bot, message, masterAccountId, 
            { logger, internalApiClient, userSettingsService, toolRegistry } // Add other deps as needed
          );
        } catch (error) {
          logger.error(`[Bot] Error processing /mods command for ${telegramUserId}:`, error.response ? error.response.data : error.message, error.stack);
          bot.sendMessage(message.chat.id, "Sorry, there was an error trying to open the Mods menu. Please try again.", { reply_to_message_id: message.message_id });
        }
      } else if (data.startsWith('train_')) {
        if (message.reply_to_message && originalCommandUser && originalCommandUser.id !== callbackUserId) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "This training menu isn't for you.", show_alert: true });
          return;
        }
        const platform = 'telegram';
        const userForMaid = originalCommandUser || callbackQuery.from; // User who initiated or clicked
        logger.info(`[Bot CB] 'train_' callback '${data}' from UserID ${callbackUserId} (MAID for user ${userForMaid.id})`);
        try {
          const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: platform,
            platformId: userForMaid.id.toString(), 
            platformContext: { 
              firstName: userForMaid.first_name, 
              username: userForMaid.username 
            }
          });
          const masterAccountId = findOrCreateResponse.data.masterAccountId;
          logger.info(`[Bot] MasterAccountId ${masterAccountId} determined for user ${userForMaid.id} for training menu callback.`);
          
          await handleTrainingCallbackQuery(bot, callbackQuery, masterAccountId, { logger, replyContextManager });
        } catch (error) {
          logger.error(`[Bot CB] Error in 'train_' callback logic (fetching MAID) for user ${userForMaid.id}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, {text: "Error accessing your account for training.", show_alert: true});
        }
      } else if (data.startsWith('restore_delivery:')) {
        // Restore the original delivery message with all action buttons
        const generationId = data.split(':')[1];
        logger.info(`[Bot CB] restore_delivery callback for generationId: ${generationId}`);
        try {
          const response = await internalApiClient.get(`/generations/${generationId}`);
          const generationRecord = response.data;
          if (!generationRecord) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: "Delivery not found.", show_alert: true });
            return;
          }
          // Rebuild the original delivery message (mimic what telegramNotifier would send)
          const chatId = message.chat.id;
          const msgId = message.message_id;
          const replyToId = generationRecord.metadata?.notificationContext?.replyToMessageId || message.reply_to_message?.message_id;
          const options = { parse_mode: 'MarkdownV2', reply_markup: undefined };
          // Build the inline keyboard (copied from telegramNotifier)
          const generationIdForButtons = generationRecord._id || generationRecord.id;
          options.reply_markup = {
            inline_keyboard: [
              [
                { text: '😻', callback_data: `rate_gen:${generationIdForButtons}:beautiful` },
                { text: '😹', callback_data: `rate_gen:${generationIdForButtons}:funny` },
                { text: '😿', callback_data: `rate_gen:${generationIdForButtons}:negative` }
              ],
              [
                { text: '-', callback_data: 'hide_menu'},
                { text: 'ℹ︎', callback_data: `view_gen_info:${generationIdForButtons}` },
                { text: '✎', callback_data: `tweak_gen:${generationIdForButtons}` },
                { text: (generationRecord.metadata?.rerunCount || 0) > 0 ? `↻${generationRecord.metadata.rerunCount}` : '↻', callback_data: `rerun_gen:${generationIdForButtons}` }
              ]
            ]
          };
          // Determine if we need to send media or text
          let imageUrl, animationUrl, specificTextOutput;
          const firstOutput = generationRecord.responsePayload?.[0];
          if (firstOutput?.data) {
            if (firstOutput.data.text) specificTextOutput = firstOutput.data.text;
            if (firstOutput.data.images?.[0]?.url) imageUrl = firstOutput.data.images[0].url;
            else if (firstOutput.data.animations?.[0]?.url) animationUrl = firstOutput.data.animations[0].url;
            else if (firstOutput.data.videos?.[0]?.url) animationUrl = firstOutput.data.videos[0].url;
          }
          if (!imageUrl && !animationUrl && firstOutput?.url) {
            if (firstOutput.url.endsWith('.gif') || firstOutput.url.endsWith('.mp4')) animationUrl = firstOutput.url;
            else if (['.png', '.jpg', '.jpeg', '.webp'].some(ext => firstOutput.url.endsWith(ext))) imageUrl = firstOutput.url;
          }
          // Clean up: delete the info message before restoring delivery
          await bot.deleteMessage(chatId, msgId);
          if (imageUrl) {
            await bot.sendPhoto(chatId, imageUrl, { caption: specificTextOutput || '', ...options, reply_to_message_id: replyToId });
          } else if (animationUrl) {
            await bot.sendAnimation(chatId, animationUrl, { caption: specificTextOutput || '', ...options, reply_to_message_id: replyToId });
          } else {
            const finalMessageText = specificTextOutput || generationRecord.responsePayload?.[0]?.data?.text || '✅ Generation completed.';
            await bot.sendMessage(chatId, finalMessageText, { ...options, reply_to_message_id: replyToId });
          }
          await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
          logger.error(`[Bot CB] Error in restore_delivery for ${generationId}:`, error.response ? error.response.data : error.message, error.stack);
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Couldn't restore delivery.", show_alert: true });
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
    // Ignore messages that aren't text or replies
    if (!message.text || !message.reply_to_message) {
      // If it's not a reply, it might be a dynamic command.
      if (message.text && !message.text.startsWith('/')) {
        if (dependencies.commandRegistry && typeof dependencies.commandRegistry.findDynamicCommandHandler === 'function') {
            const commandHandler = dependencies.commandRegistry.findDynamicCommandHandler(message.text, 'telegram');
            if (commandHandler) {
                logger.info(`[Bot] Handling general message "${message.text.substring(0,30)}..." with dynamic command handler for tool: ${commandHandler.toolId}`);
                try {
                    await commandHandler.handler(message, ''); 
                } catch (error) {
                    logger.error('[Bot] Error executing dynamic command handler:', error);
                    bot.sendMessage(message.chat.id, "Sorry, I couldn't process that.", { reply_to_message_id: message.message_id });
                }
            }
        } else {
            logger.warn('[Bot] commandRegistry or findDynamicCommandHandler is not available in dependencies.');
        }
      }
      return;
    }

    const repliedToMessage = message.reply_to_message;
    const context = replyContextManager.getContext(repliedToMessage);

    // If there's no context, it's not a special reply we need to handle.
    // The dynamic command handler logic is now above, for non-replies.
    if (!context) {
      // logger.debug(`[Bot] Message received is a reply, but no special context found. Ignoring. MsgID: ${message.message_id}, RepliedToID: ${repliedToMessage.message_id}`);
      return;
    }
    
    // Context found, so we must handle it. 
    // Once context is retrieved, we clear it to prevent replay attacks or accidental re-triggering.
    replyContextManager.removeContext(repliedToMessage);
    logger.info(`[Bot] Found and removed reply context of type: ${context.type}`);
    
    const telegramUserId = message.from.id.toString();

    try {
        switch (context.type) {
            case 'settings_param_edit':
                {
                    const { masterAccountId, toolDisplayName, paramName } = context;
                    const value = message.text;
                    logger.info(`[Bot] Reply received for settings param edit via Context. User: ${telegramUserId}, MAID: ${masterAccountId}, Tool: ${toolDisplayName}, Param: ${paramName}, Value: '${value}'`);

                    const result = await handleParameterValueReply(masterAccountId, toolDisplayName, paramName, value, { logger, toolRegistry, userSettingsService });

                    if (result.success) {
                        await bot.sendMessage(message.chat.id, result.message, { reply_to_message_id: message.message_id });
                        if (result.canonicalToolId) {
                            const updatedToolParamsMenu = await buildToolParamsMenu(masterAccountId, result.canonicalToolId, { logger, toolRegistry, userSettingsService });
                            await bot.editMessageText(updatedToolParamsMenu.text, {
                                chat_id: repliedToMessage.chat.id,
                                message_id: repliedToMessage.message_id,
                                reply_markup: updatedToolParamsMenu.reply_markup
                            });
                        }
                    } else {
                        await bot.sendMessage(message.chat.id, result.message || "Failed to update setting.", { reply_to_message_id: message.message_id });
                    }
                    break;
                }

            case 'tweak_param_edit':
                {
                    const { generationId, masterAccountId, canonicalToolId, paramName } = context;
                    const newValue = message.text;
                    const toolDef = toolRegistry.getToolById(canonicalToolId);

                    logger.info(`[Bot] Reply received for TWEAK param edit via Context. User: ${telegramUserId}, MAID: ${masterAccountId}, GenID: ${generationId}, Param: ${paramName}, NewValue: '${newValue.replace(/'/g, "''")}'`);

                    if (telegramUserId !== masterAccountId.split(':')[1]) {
                        const findOrCreateUserResponse = await internalApiClient.post('/users/find-or-create', {
                            platform: 'telegram',
                            platformId: telegramUserId,
                            platformContext: { firstName: message.from.first_name, username: message.from.username }
                        });
                        const replierMasterAccountId = findOrCreateUserResponse.data.masterAccountId;
                        if (replierMasterAccountId !== masterAccountId) {
                            logger.warn(`[Bot] Tweak reply attempt by wrong user. Expected MAID ${masterAccountId}, got ${replierMasterAccountId}.`);
                            await bot.sendMessage(message.chat.id, "You cannot edit a tweak session started by someone else.", { reply_to_message_id: message.message_id });
                            return;
                        }
                    }
                    
                    const tweakSessionKey = `${generationId}_${masterAccountId}`;
                    const currentToolTweaks = pendingTweaks[tweakSessionKey];

                    if (!currentToolTweaks) {
                        logger.error(`[Bot] Tweak reply: No pending tweak session found for key ${tweakSessionKey}. Cannot save value.`);
                        await bot.sendMessage(message.chat.id, "Error: Your tweak session seems to have expired. Please try tweaking again.", { reply_to_message_id: message.message_id });
                        await bot.deleteMessage(repliedToMessage.chat.id, repliedToMessage.message_id);
                        return;
                    }

                    if (!toolDef || !toolDef.inputSchema || !toolDef.inputSchema[paramName]) {
                        logger.error(`[Bot] Tweak reply: ToolDef or ParamDef not found for ToolID ${canonicalToolId}, Param ${paramName}`);
                        await bot.sendMessage(message.chat.id, "Error: Tool or parameter definition is missing. Cannot save value.", { reply_to_message_id: message.message_id });
                        return;
                    }
                    
                    const paramDef = toolDef.inputSchema[paramName];
                    let parsedValue = newValue;
                    let validationError = null;
                    switch (paramDef.type) {
                        case 'number':
                        case 'integer':
                            parsedValue = parseFloat(newValue);
                            if (isNaN(parsedValue)) validationError = "Invalid number. Please provide a valid number.";
                            if (paramDef.type === 'integer' && !Number.isInteger(parsedValue)) validationError = "Not a valid whole number.";
                            break;
                        case 'boolean':
                            if (['true', 'yes', '1', 'on'].includes(newValue.toLowerCase())) parsedValue = true;
                            else if (['false', 'no', '0', 'off'].includes(newValue.toLowerCase())) parsedValue = false;
                            else validationError = "Invalid boolean. Use true/false, yes/no, etc.";
                            break;
                    }

                    if (validationError) {
                        logger.warn(`[Bot] Tweak reply: Validation failed for ${paramName} with value '${newValue.replace(/'/g, "''")}'. Error: ${validationError}`);
                        await bot.sendMessage(message.chat.id, validationError, { reply_to_message_id: message.message_id });
                        return;
                    }

                    pendingTweaks[tweakSessionKey][paramName] = parsedValue;
                    logger.info(`[Bot] Tweak reply: Updated pendingTweaks for ${tweakSessionKey} - ${paramName} = ${parsedValue}`);

                    await bot.deleteMessage(message.chat.id, message.message_id);

                    const genResponse = await internalApiClient.get(`/generations/${generationId}`);
                    const generationRecord = genResponse.data;
                    if (!generationRecord || !generationRecord.metadata) { throw new Error('Failed to fetch gen record for menu rebuild'); }
                    
                    const originalUserCommandMessageId = generationRecord.metadata.telegramMessageId;
                    const originalUserCommandChatId = generationRecord.metadata.telegramChatId;
                    if (!originalUserCommandMessageId || !originalUserCommandChatId) { throw new Error('Missing original command context'); }

                    const refreshedMenu = await buildTweakUIMenu(
                        masterAccountId,
                        canonicalToolId,
                        pendingTweaks[tweakSessionKey],
                        originalUserCommandMessageId,
                        originalUserCommandChatId,
                        generationId,
                        { logger, toolRegistry, userSettingsService }
                    );

                    if (refreshedMenu && refreshedMenu.text && refreshedMenu.reply_markup) {
                        await bot.editMessageText(refreshedMenu.text, {
                            chat_id: repliedToMessage.chat.id,
                            message_id: repliedToMessage.message_id,
                            reply_markup: refreshedMenu.reply_markup,
                            parse_mode: 'MarkdownV2'
                        });
                    } else {
                        throw new Error('Failed to build refreshed tweak menu.');
                    }
                    break;
                }
            
            case 'mod_import_url':
                {
                    const { masterAccountId } = context;
                    const submittedUrl = message.text.trim();
                    logger.info(`[Bot] Mod Import URL reply received via Context. MAID: ${masterAccountId}, User: ${telegramUserId}, URL: '${submittedUrl}'.`);

                    if (!submittedUrl.startsWith('http://') && !submittedUrl.startsWith('https://')) {
                        await bot.sendMessage(message.chat.id, "That doesn't look like a valid URL. Please provide a full URL starting with http:// or https://.", { reply_to_message_id: message.message_id });
                        return;
                    }

                    const importResponse = await internalApiClient.post('/loras/import-from-url', {
                        loraUrl: submittedUrl,
                        masterAccountId: masterAccountId
                    });

                    if (importResponse.status === 202 && importResponse.data && importResponse.data.lora) {
                        const loraDetailsForAdmin = importResponse.data.lora;
                        await bot.sendMessage(message.chat.id, importResponse.data.message, { reply_to_message_id: message.message_id });

                        const adminChatId = '5472638766';
                        const loraIdentifier = loraDetailsForAdmin.slug || loraDetailsForAdmin._id;
                        if (!loraIdentifier) {
                            logger.error(`[Bot] Mod identifier missing from import API response. URL: ${submittedUrl}`);
                            return;
                        }
                        const rawMAID = masterAccountId;
                        const rawUrl = submittedUrl;
                        const rawLoraName = loraDetailsForAdmin.name || 'N/A';
                        const adminMessageText =
                            '*New Mod Submission for Review* 🤖\n' +
                            `User MAID: \`${rawMAID}\`\n` +
                            `Original URL: ${rawUrl}\n` +
                            `Mod Name: ${rawLoraName}\n\n` +
                            'Please approve or reject this Mod.';
                        
                        await bot.sendMessage(adminChatId, adminMessageText, {
                            parse_mode: null,
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ Approve Publicly', callback_data: 'admin_mod_approve:' + loraIdentifier },
                                    { text: '🔒 Approve Privately', callback_data: 'admin_mod_approve_private:' + loraIdentifier },
                                    { text: '❌ Reject', callback_data: 'admin_mod_reject:' + loraIdentifier }
                                ]]
                            }
                        });
                         logger.info(`[Bot] Admin notification sent successfully for Mod: ${loraIdentifier}`);
                    } else {
                        const errorMessage = importResponse.data?.error || importResponse.data?.message || "Could not process Mod import request.";
                        logger.warn(`[Bot] Mod import API call for URL ${submittedUrl} returned status ${importResponse.status}. Message: ${errorMessage}`);
                        await bot.sendMessage(message.chat.id, `Import request failed or had an unexpected status: ${errorMessage}`, { reply_to_message_id: message.message_id });
                    }
                    break;
                }

            case 'training_name_prompt':
                {
                    const { masterAccountId } = context;
                    logger.info(`[Bot] Reply received for Training Name Prompt via Context. MAID: ${masterAccountId}, Replier: ${telegramUserId}, Value: '${message.text}'`);
                    await processNewTrainingName(bot, message, masterAccountId, { logger });
                    break;
                }
            
            case 'spell_create_name':
                logger.info(`[Bot] Processing spell_create_name reply from UserID: ${telegramUserId}`);
                await handleNewSpellNameReply(bot, message, context, { logger, toolRegistry });
                break;
            
            case 'spell_param_value':
                logger.info(`[Bot] Processing spell_param_value reply from UserID: ${telegramUserId}`);
                await handleStepParameterValueReply(bot, message, context, { logger, toolRegistry });
                break;

            default:
                logger.warn(`[Bot] Unhandled reply context type: ${context.type}`);
        }
    } catch (error) {
        logger.error(`[Bot] Error processing reply with context type ${context.type}:`, error.response ? error.response.data : error.message, error.stack);
        await bot.sendMessage(message.chat.id, "Sorry, an unexpected error occurred while processing your reply.", { reply_to_message_id: message.message_id });
    }
  });
  // -- END MESSAGE HANDLER --

  logger.info('Telegram bot configured and ready');
  
  return bot;
}

module.exports = createTelegramBot; 