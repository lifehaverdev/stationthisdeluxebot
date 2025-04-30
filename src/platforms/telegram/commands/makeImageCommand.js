/**
 * Make Image Command Handler for Telegram
 * 
 * Handles the /make command which generates images using the makeImageWorkflow.
 */

const { makeImageWorkflow } = require('../../../workflows/makeImage');
const createTelegramMediaAdapter = require('../mediaAdapter');

/**
 * Create make image command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createMakeImageCommandHandler(dependencies) {
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
   * Handle the make image command
   * @param {Object} message - Telegram message
   * @param {string} prompt - User's text prompt for image generation
   * @returns {Promise<void>}
   */
  return async function handleMakeImageCommand(message, prompt) {
    const userId = message.from.id;
    
    if (!prompt || prompt.trim() === '') {
      await bot.sendMessage(
        message.chat.id,
        'Please provide a prompt for image generation. Example: /make a beautiful sunset over mountains',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    
    try {
      // Send status message
      const statusMessage = await bot.sendMessage(
        message.chat.id, 
        'Generating your image... This may take a minute.',
        { reply_to_message_id: message.message_id }
      );
      
      // Get user session for preferences
      const userSession = await sessionService.getSession(userId);
      const options = userSession?.preferences?.image || {};
      
      // Call the makeImage workflow
      const result = await makeImageWorkflow(
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
          prompt,
          platform: 'telegram',
          message,
          options
        }
      );
      
      // Handle workflow result
      if (!result.success) {
        let errorMessage = 'Could not generate image.';
        
        // Handle specific error cases
        if (result.error === 'not_enough_points') {
          errorMessage = `You don't have enough points for this operation. Required: ${result.requiredPoints} points.`;
        } else if (result.error === 'invalid_workflow') {
          errorMessage = 'The selected workflow is not available.';
        } else if (result.error === 'generation_error' || result.error === 'generation_failed') {
          errorMessage = `Generation failed: ${result.message || 'An error occurred during generation.'}`;
        } else if (result.error === 'generation_timeout') {
          errorMessage = 'Generation is taking longer than expected. The result will be sent when ready.';
        } else if (result.message) {
          errorMessage = result.message;
        }
        
        await bot.editMessageText(errorMessage, {
          chat_id: statusMessage.chat.id,
          message_id: statusMessage.message_id
        });
      } else {
        // Success case
        await bot.deleteMessage(statusMessage.chat.id, statusMessage.message_id);
        
        // Send each generated image
        for (const image of result.images) {
          await telegramMediaAdapter.sendPhoto(
            message, 
            image.url, 
            { 
              caption: `"${prompt}"\n\nGenerated with ${result.workflowName || 'default'} workflow.`,
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔄 Regenerate', callback_data: `regenerate:${result.generationId}` },
                    { text: '⬆️ Upscale', callback_data: `upscale:${image.id}` }
                  ]
                ]
              }
            }
          );
        }
      }
    } catch (error) {
      logger.error('Error in make image command:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while generating your image.',
        { reply_to_message_id: message.message_id }
      );
    }
  };
}

module.exports = createMakeImageCommandHandler; 