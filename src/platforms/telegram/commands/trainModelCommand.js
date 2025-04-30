/**
 * Train Model Command Handler for Telegram
 * 
 * Handles the /train command for LoRA model training using the trainModelWorkflow.
 */

const { trainModelWorkflow } = require('../../../workflows/trainModel');
const createTelegramMediaAdapter = require('../mediaAdapter');

/**
 * Create train model command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createTrainModelCommandHandler(dependencies) {
  const { 
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    bot,
    logger = console
  } = dependencies;
  
  // Create Telegram adapter for media operations
  const telegramMediaAdapter = createTelegramMediaAdapter(bot);
  
  /**
   * Handle create new training dataset command
   * @param {Object} message - Telegram message
   * @param {string} args - Command arguments
   * @returns {Promise<void>}
   */
  async function handleCreateTrainingDataset(message, name) {
    const userId = message.from.id;
    
    if (!name || name.trim() === '') {
      await bot.sendMessage(
        message.chat.id,
        'Please provide a name for your training dataset. Example: /train create my_character',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    try {
      const result = await trainModelWorkflow(
        {
          comfyuiService,
          pointsService,
          sessionService,
          workflowsService,
          mediaService,
          logger
        },
        {
          userId,
          name: name.trim(),
          platform: 'telegram'
        }
      );
      
      if (result.success) {
        await bot.sendMessage(
          message.chat.id,
          `Created new training dataset: "${result.name}" (ID: ${result.loraId})\n\nYou can now add images to your dataset with the /train add command, or by replying to an image with /train add ${result.loraId}`,
          { reply_to_message_id: message.message_id }
        );
      } else {
        let errorMessage = 'Could not create training dataset.';
        if (result.message) {
          errorMessage = result.message;
        }
        
        await bot.sendMessage(
          message.chat.id,
          errorMessage,
          { reply_to_message_id: message.message_id }
        );
      }
    } catch (error) {
      logger.error('Error creating training dataset:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while creating your training dataset.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Handle add image to training dataset command
   * @param {Object} message - Telegram message
   * @param {string} loraId - LoRA ID
   * @returns {Promise<void>}
   */
  async function handleAddToTrainingDataset(message, loraId) {
    const userId = message.from.id;
    
    if (!loraId || loraId.trim() === '') {
      await bot.sendMessage(
        message.chat.id,
        'Please provide the ID of your training dataset. Example: /train add loraId',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    // Check if this is a reply to an image
    if (!message.reply_to_message || !message.reply_to_message.photo) {
      await bot.sendMessage(
        message.chat.id,
        'Please reply to an image with this command to add it to your training dataset.',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    try {
      // Process the image
      const statusMessage = await bot.sendMessage(
        message.chat.id, 
        'Processing image for training dataset...',
        { reply_to_message_id: message.message_id }
      );
      
      // Get photo from reply
      const photo = message.reply_to_message.photo;
      const fileId = photo[photo.length - 1].file_id; // Get the highest resolution
      
      // Download the image using the media adapter
      const imageData = await telegramMediaAdapter.getPhotoData(fileId);
      
      // Get caption if any
      const caption = message.reply_to_message.caption || '';
      
      // Call the workflow to add the image
      const result = await trainModelWorkflow(
        {
          comfyuiService,
          pointsService,
          sessionService,
          workflowsService,
          mediaService,
          logger
        },
        {
          userId,
          loraId: loraId.trim(),
          platform: 'telegram',
          images: [imageData],
          captions: [caption]
        }
      );
      
      if (result.success) {
        await bot.editMessageText(
          `Image added to training dataset "${result.name}"`,
          {
            chat_id: statusMessage.chat.id,
            message_id: statusMessage.message_id
          }
        );
      } else {
        let errorMessage = 'Could not add image to training dataset.';
        if (result.message) {
          errorMessage = result.message;
        }
        
        await bot.editMessageText(
          errorMessage,
          {
            chat_id: statusMessage.chat.id,
            message_id: statusMessage.message_id
          }
        );
      }
    } catch (error) {
      logger.error('Error adding image to training dataset:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while processing your image.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Handle list training datasets command
   * @param {Object} message - Telegram message
   * @returns {Promise<void>}
   */
  async function handleListTrainingDatasets(message) {
    const userId = message.from.id;
    
    try {
      // Get user session
      const userSession = await sessionService.getSession(userId);
      const loras = userSession?.loras || [];
      
      if (loras.length === 0) {
        await bot.sendMessage(
          message.chat.id,
          'You don\'t have any training datasets yet. Use /train create [name] to create one.',
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // Create inline keyboard with training datasets
      const inlineKeyboard = loras.map(lora => {
        const status = lora.status === 'trained' ? '✅' : lora.status === 'training' ? '⏳' : '🔄';
        const buttonText = `${status} ${lora.name} (${lora.images.filter(img => img).length} images)`;
        return [{ text: buttonText, callback_data: `train:view:${lora.loraId}` }];
      });
      
      await bot.sendMessage(
        message.chat.id,
        'Your training datasets:',
        {
          reply_to_message_id: message.message_id,
          reply_markup: { inline_keyboard: inlineKeyboard }
        }
      );
    } catch (error) {
      logger.error('Error listing training datasets:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while retrieving your training datasets.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Handle submit training command
   * @param {Object} message - Telegram message
   * @param {string} loraId - LoRA ID
   * @returns {Promise<void>}
   */
  async function handleSubmitTraining(message, loraId) {
    const userId = message.from.id;
    
    if (!loraId || loraId.trim() === '') {
      await bot.sendMessage(
        message.chat.id,
        'Please provide the ID of your training dataset. Example: /train submit loraId',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    try {
      const statusMessage = await bot.sendMessage(
        message.chat.id, 
        'Submitting training request...',
        { reply_to_message_id: message.message_id }
      );
      
      // Call the workflow to submit training
      const result = await trainModelWorkflow(
        {
          comfyuiService,
          pointsService,
          sessionService,
          workflowsService,
          mediaService,
          logger
        },
        {
          userId,
          loraId: loraId.trim(),
          platform: 'telegram',
          options: { submitTraining: true }
        }
      );
      
      if (result.success) {
        await bot.editMessageText(
          `Training started for "${result.name}"!\n\nThis will take approximately ${result.estimatedTime} minutes. You will be notified when training is complete.`,
          {
            chat_id: statusMessage.chat.id,
            message_id: statusMessage.message_id
          }
        );
      } else {
        let errorMessage = 'Could not submit training request.';
        
        // Handle specific error cases
        if (result.error === 'not_enough_points') {
          errorMessage = `You don't have enough points for training. Required: ${result.requiredPoints} points.`;
        } else if (result.error === 'insufficient_images') {
          errorMessage = `Not enough training images. You need at least 4 images (current: ${result.currentCount}).`;
        } else if (result.error === 'missing_captions') {
          errorMessage = `Missing captions. Each image must have a caption (images: ${result.imageCount}, captions: ${result.captionCount}).`;
        } else if (result.message) {
          errorMessage = result.message;
        }
        
        await bot.editMessageText(
          errorMessage,
          {
            chat_id: statusMessage.chat.id,
            message_id: statusMessage.message_id
          }
        );
      }
    } catch (error) {
      logger.error('Error submitting training request:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while submitting your training request.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Handle view training dataset command
   * @param {Object} message - Telegram message
   * @param {string} loraId - LoRA ID
   * @returns {Promise<void>}
   */
  async function handleViewTrainingDataset(message, loraId) {
    const userId = message.from.id;
    
    if (!loraId || loraId.trim() === '') {
      await bot.sendMessage(
        message.chat.id,
        'Please provide the ID of your training dataset. Example: /train view loraId',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    try {
      // Get user session
      const userSession = await sessionService.getSession(userId);
      const lora = userSession?.loras?.find(l => l.loraId === loraId.trim());
      
      if (!lora) {
        await bot.sendMessage(
          message.chat.id,
          `Training dataset with ID ${loraId} not found.`,
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // Calculate status
      const filledImageSlots = lora.images.filter(img => img).length;
      const filledCaptionSlots = lora.captions.filter(caption => caption).length;
      
      let statusText;
      if (lora.status === 'trained') {
        statusText = '✅ Trained';
      } else if (lora.status === 'training') {
        statusText = '⏳ Training in progress';
      } else if (filledImageSlots < 4) {
        statusText = `🔄 Incomplete (need ${4 - filledImageSlots} more images)`;
      } else if (filledCaptionSlots < filledImageSlots) {
        statusText = `🔄 Incomplete (missing ${filledImageSlots - filledCaptionSlots} captions)`;
      } else {
        statusText = '🔄 Ready to train';
      }
      
      // Create inline keyboard
      const inlineKeyboard = [
        [
          { text: 'Submit for training', callback_data: `train:submit:${lora.loraId}` },
          { text: 'Delete dataset', callback_data: `train:delete:${lora.loraId}` }
        ]
      ];
      
      await bot.sendMessage(
        message.chat.id,
        `Training dataset: "${lora.name}"\n` +
        `ID: ${lora.loraId}\n` +
        `Status: ${statusText}\n` +
        `Images: ${filledImageSlots}/20\n` +
        `Captions: ${filledCaptionSlots}/${filledImageSlots}\n\n` +
        `To add images, reply to an image with:\n/train add ${lora.loraId}`,
        {
          reply_to_message_id: message.message_id,
          reply_markup: { inline_keyboard: inlineKeyboard }
        }
      );
    } catch (error) {
      logger.error('Error viewing training dataset:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while retrieving your training dataset.',
        { reply_to_message_id: message.message_id }
      );
    }
  }
  
  /**
   * Main command handler for /train
   * @param {Object} message - Telegram message
   * @param {string} args - Command arguments
   * @returns {Promise<void>}
   */
  return async function handleTrainModelCommand(message, args = '') {
    const [subCommand, ...params] = args.trim().split(' ');
    
    switch (subCommand.toLowerCase()) {
      case 'create':
        await handleCreateTrainingDataset(message, params.join(' '));
        break;
      case 'add':
        await handleAddToTrainingDataset(message, params[0]);
        break;
      case 'list':
        await handleListTrainingDatasets(message);
        break;
      case 'view':
        await handleViewTrainingDataset(message, params[0]);
        break;
      case 'submit':
        await handleSubmitTraining(message, params[0]);
        break;
      case '':
        // No subcommand, show help
        await bot.sendMessage(
          message.chat.id,
          'Train Model Commands:\n\n' +
          '/train create [name] - Create a new training dataset\n' +
          '/train add [loraId] - Add an image to dataset (reply to image)\n' +
          '/train list - List all your training datasets\n' +
          '/train view [loraId] - View details of a training dataset\n' +
          '/train submit [loraId] - Submit dataset for training',
          { reply_to_message_id: message.message_id }
        );
        break;
      default:
        await bot.sendMessage(
          message.chat.id,
          `Unknown subcommand: ${subCommand}\n\nUse /train without arguments to see available commands.`,
          { reply_to_message_id: message.message_id }
        );
    }
  };
}

module.exports = createTrainModelCommandHandler; 