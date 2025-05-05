/**
 * Telegram Platform Adapter
 * 
 * Main entry point for the Telegram bot implementation.
 * Registers command handlers and provides the bot interface.
 */

const TelegramBot = require('node-telegram-bot-api');
const createUpscaleCommandHandler = require('./commands/upscaleCommand');
const createMakeImageCommandHandler = require('./commands/makeImageCommand');
const createSettingsCommandHandler = require('./commands/settingsCommand');
const createCollectionsCommandHandler = require('./commands/collectionsCommand');
const createTrainModelCommandHandler = require('./commands/trainModelCommand');
const createStatusCommandHandler = require('./commands/statusCommand');

/**
 * Create and configure the Telegram bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Telegram bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createTelegramBot(dependencies, token, options = {}) {
  const {
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    db,
    logger = console,
    appStartTime
  } = dependencies;
  
  // Create the Telegram bot instance
  const bot = new TelegramBot(token, {
    polling: options.polling !== false,
    ...options
  });
  
  // Initialize command handlers
  const handleUpscaleCommand = createUpscaleCommandHandler({
    mediaService,
    bot,
    logger
  });
  
  const handleMakeImageCommand = createMakeImageCommandHandler({
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    bot,
    logger
  });
  
  const handleSettingsCommand = createSettingsCommandHandler({
    sessionService,
    pointsService,
    bot,
    logger
  });
  
  // Temporarily disable collections command due to missing dependencies
  // const handleCollectionsCommand = createCollectionsCommandHandler({
  //   sessionService,
  //   mediaService,
  //   db,
  //   bot,
  //   logger
  // });
  
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
      internal: dependencies.internal
    }
  });
  
  // Register command handlers
  
  // /make command - Generate images
  bot.onText(/^\/make(?:@\w+)?\s*(.*)/i, (message, match) => {
    const prompt = match[1];
    handleMakeImageCommand(message, prompt);
  });
  
  // /upscale command - Upscale images
  bot.onText(/^\/upscale(?:@\w+)?/i, (message) => {
    handleUpscaleCommand(message);
  });
  
  // /settings command - Manage user settings
  bot.onText(/^\/settings(?:@\w+)?\s*(.*)/i, (message, match) => {
    const args = match[1] || '';
    handleSettingsCommand(message, args);
  });
  
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
  
  // Handle callback queries for inline buttons
  bot.on('callback_query', async (query) => {
    const { data, message } = query;
    
    try {
      // First, acknowledge the callback query
      await bot.answerCallbackQuery(query.id);
      
      // Check if this is a settings callback
      if (data.startsWith('settings:')) {
        // Handle settings button press
        const parts = data.split(':');
        const setting = parts[1];
        const value = parts[2];
        const userId = query.from.id;
        
        // Create a fake message for the settings handler
        const settingsMessage = {
          ...message,
          from: query.from,
          message_id: message.message_id
        };
        
        await handleSettingsCommand(settingsMessage, `set ${setting} ${value}`);
      } else if (data.startsWith('collection:')) {
        // Handle collection button press
        const parts = data.split(':');
        const action = parts[1];
        const collectionId = parts[2];
        const userId = query.from.id;
        
        switch (action) {
          case 'view':
            // Create a fake message for the command handler
            const viewMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand(viewMessage, `view ${collectionId}`);
            break;
          
          case 'edit':
            await bot.sendMessage(
              message.chat.id,
              'To edit your collection, use one of the following commands:\n\n' +
              '• /collections rename <collectionId> <new name>\n' +
              '• /collections prompt <collectionId> <master prompt>\n',
              { reply_to_message_id: message.message_id }
            );
            break;
          
          case 'delete':
            // Create a confirmation message with buttons
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
            break;
          
          case 'confirm_delete':
            // Create a fake message for the command handler
            const deleteMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand(deleteMessage, `delete ${collectionId}`);
            break;
          
          case 'cancel_delete':
            await bot.sendMessage(
              message.chat.id,
              'Collection deletion cancelled.',
              { reply_to_message_id: message.message_id }
            );
            break;
            
          case 'share':
            // Create a fake message for the command handler
            const shareMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // Call the share function from collections command handler
            // await handleCollectionsCommand._shareCollection(shareMessage, userId, collectionId);
            break;
            
          case 'shareProcess':
            // Process sharing with specific user and permissions
            const targetUserId = parts[3];
            const sharePermissions = parts[4];
            const processShareMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand._processShareCollection(
            //   processShareMessage, 
            //   userId, 
            //   collectionId, 
            //   targetUserId, 
            //   sharePermissions
            // );
            break;
            
          case 'createShareLink':
            // Create a fake message for the command handler
            const createShareLinkMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand._createShareLink(createShareLinkMessage, userId, collectionId);
            break;
            
          case 'createShareLinkProcess':
            // Process share link creation with selected expiry
            const expiry = parts[3];
            const permissions = parts[4];
            const processShareLinkMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand._processCreateShareLink(
            //   processShareLinkMessage, 
            //   userId, 
            //   collectionId, 
            //   expiry, 
            //   permissions
            // );
            break;
            
          case 'manageShares':
            // Create a fake message for the command handler
            const manageSharesMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand._manageShares(manageSharesMessage, userId, collectionId);
            break;
            
          case 'unshare':
            // Unshare collection with specific user
            const unshareTargetUserId = parts[3];
            const unshareMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand._unshareCollection(
            //   unshareMessage, 
            //   userId, 
            //   collectionId, 
            //   unshareTargetUserId
            // );
            break;
            
          case 'changePermissions':
            // Change permissions for shared user
            const permTargetUserId = parts[3];
            const newPermissions = parts[4];
            const changePermMessage = {
              ...message,
              from: query.from,
              message_id: message.message_id
            };
            // await handleCollectionsCommand._updateSharePermissions(
            //   changePermMessage, 
            //   userId, 
            //   collectionId, 
            //   permTargetUserId, 
            //   newPermissions
            // );
            break;
        }
      } else if (data.startsWith('train:')) {
        // Handle train model button press
        const parts = data.split(':');
        const action = parts[1];
        const loraId = parts[2];
        
        // Create a fake message for the command handler
        const trainMessage = {
          ...message,
          from: query.from,
          message_id: message.message_id
        };
        
        switch (action) {
          case 'view':
            await handleTrainModelCommand(trainMessage, `view ${loraId}`);
            break;
          
          case 'submit':
            await handleTrainModelCommand(trainMessage, `submit ${loraId}`);
            break;
          
          case 'delete':
            // Create a confirmation message with buttons
            await bot.sendMessage(
              message.chat.id,
              `Are you sure you want to delete this training dataset? This cannot be undone.`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: 'Yes, delete it', callback_data: `train:confirm_delete:${loraId}` },
                      { text: 'No, keep it', callback_data: 'train:cancel_delete' }
                    ]
                  ]
                }
              }
            );
            break;
          
          case 'confirm_delete':
            // TODO: Implement delete training dataset handler
            await bot.sendMessage(
              message.chat.id,
              'Training dataset deletion is not implemented yet.',
              { reply_to_message_id: message.message_id }
            );
            break;
          
          case 'cancel_delete':
            await bot.sendMessage(
              message.chat.id,
              'Training dataset deletion cancelled.',
              { reply_to_message_id: message.message_id }
            );
            break;
        }
      }
    } catch (error) {
      logger.error('Error handling callback query:', error);
    }
  });
  
  // Log errors
  bot.on('polling_error', (error) => {
    logger.error('Telegram polling error:', error);
  });
  
  logger.info('Telegram bot configured and ready');
  
  return bot;
}

module.exports = createTelegramBot; 