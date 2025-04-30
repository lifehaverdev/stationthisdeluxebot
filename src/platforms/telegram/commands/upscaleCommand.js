/**
 * Upscale Command Handler for Telegram
 * 
 * Handles the /upscale command which upscales images using the MediaService.
 */

const { upscaleImageWorkflow } = require('../../../workflows/mediaProcessing');
const createTelegramMediaAdapter = require('../mediaAdapter');

/**
 * Create upscale command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createUpscaleCommandHandler(dependencies) {
  const { 
    mediaService,
    bot,
    logger = console
  } = dependencies;
  
  // Check if mediaService is provided
  if (!mediaService) {
    logger.error('MediaService is missing in dependencies for upscaleCommand');
    return async function handleUpscaleCommandError(message) {
      await bot.sendMessage(
        message.chat.id,
        'Sorry, the upscale feature is not available right now.',
        { reply_to_message_id: message.message_id }
      );
    };
  }
  
  // Create Telegram adapter for media operations
  const telegramMediaAdapter = createTelegramMediaAdapter(bot);
  
  // Register the Telegram adapter with the MediaService
  if (typeof mediaService.registerPlatformHandlers === 'function') {
    mediaService.registerPlatformHandlers({
      telegram: {
        getFileUrl: telegramMediaAdapter.getFileUrl
      }
    });
  } else {
    logger.error('MediaService does not have registerPlatformHandlers method');
  }
  
  /**
   * Handle the upscale command
   * @param {Object} message - Telegram message
   * @returns {Promise<void>}
   */
  return async function handleUpscaleCommand(message) {
    const userId = message.from.id;
    
    try {
      // Send status message
      const statusMessage = await bot.sendMessage(
        message.chat.id, 
        'Processing your image...', 
        { reply_to_message_id: message.message_id }
      );
      
      // Call the upscale workflow
      const result = await upscaleImageWorkflow(
        {
          mediaService,
          platformAdapter: telegramMediaAdapter,
          logger
        },
        {
          message,
          userId,
          platform: 'telegram',
          processingOptions: {
            quality: 90, // High quality output
            saveOutput: false // Don't persist to storage
          }
        }
      );
      
      // Handle workflow result
      if (!result.success) {
        await bot.editMessageText(
          `Error: ${result.error || 'Could not process image'}`,
          {
            chat_id: statusMessage.chat.id,
            message_id: statusMessage.message_id
          }
        );
      } else {
        // Success case is handled by the workflow which sends the media
        await bot.deleteMessage(
          statusMessage.chat.id,
          statusMessage.message_id
        );
      }
    } catch (error) {
      logger.error('Error in upscale command:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while processing your image.',
        { reply_to_message_id: message.message_id }
      );
    }
  };
}

module.exports = createUpscaleCommandHandler; 