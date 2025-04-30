/**
 * Upscale Command Handler for Discord
 * 
 * Handles the /upscale command which upscales images using the MediaService.
 */

const { upscaleImageWorkflow } = require('../../../workflows/mediaProcessing');
const createDiscordMediaAdapter = require('../mediaAdapter');

/**
 * Create upscale command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createUpscaleCommandHandler(dependencies) {
  const { 
    mediaService,
    client,
    logger = console
  } = dependencies;
  
  // Check if mediaService is provided
  if (!mediaService) {
    logger.error('MediaService is missing in dependencies for Discord upscaleCommand');
    return async function handleUpscaleCommandError(interaction) {
      await interaction.reply({
        content: 'Sorry, the upscale feature is not available right now.',
        ephemeral: true
      });
    };
  }
  
  // Create Discord adapter for media operations
  const discordMediaAdapter = createDiscordMediaAdapter(client);
  
  // Register the Discord adapter with the MediaService
  if (typeof mediaService.registerPlatformHandlers === 'function') {
    mediaService.registerPlatformHandlers({
      discord: {
        getFileUrl: discordMediaAdapter.getFileUrl
      }
    });
  } else {
    logger.error('MediaService does not have registerPlatformHandlers method for Discord');
  }
  
  /**
   * Handle the upscale command
   * @param {Object} interaction - Discord interaction object
   * @returns {Promise<void>}
   */
  return async function handleUpscaleCommand(interaction) {
    const userId = interaction.user.id;
    
    try {
      // Defer reply to show loading state
      await interaction.deferReply();
      
      // Get the last message with an image from the user
      // We need to find the last message with an attachment in the same channel
      const channel = interaction.channel;
      const messages = await channel.messages.fetch({ limit: 10 });
      
      // Find the most recent message with an image attachment from the same user
      const messageWithImage = messages.find(msg => 
        msg.author.id === userId && 
        msg.attachments.size > 0 && 
        msg.attachments.some(attachment => 
          attachment.contentType?.startsWith('image/')
        )
      );
      
      if (!messageWithImage) {
        await interaction.editReply('Please upload an image first, then use the /upscale command.');
        return;
      }
      
      // Call the upscale workflow
      const result = await upscaleImageWorkflow(
        {
          mediaService,
          platformAdapter: discordMediaAdapter,
          logger
        },
        {
          message: messageWithImage,
          userId,
          platform: 'discord',
          processingOptions: {
            quality: 90, // High quality output
            saveOutput: false // Don't persist to storage
          }
        }
      );
      
      // Handle workflow result
      if (!result.success) {
        await interaction.editReply(`Error: ${result.error || 'Could not process image'}`);
      } else {
        // Send the processed image
        await interaction.editReply({
          content: 'Here is your upscaled image:',
          files: [result.filePath]
        });
      }
    } catch (error) {
      logger.error('Error in upscale command:', error);
      
      // If the interaction was already replied to, we need to follow up
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply('Sorry, an error occurred while processing your image.');
      } else {
        await interaction.reply({
          content: 'Sorry, an error occurred while processing your image.',
          ephemeral: true
        });
      }
    }
  };
}

module.exports = createUpscaleCommandHandler; 