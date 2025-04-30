/**
 * Make Image Command Handler for Discord
 * 
 * Handles the /make command which generates images using the makeImageWorkflow.
 */

const { makeImageWorkflow } = require('../../../workflows/makeImage');
const createDiscordMediaAdapter = require('../mediaAdapter');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Create make image command handler for Discord
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
    client,
    logger = console
  } = dependencies;
  
  // Create Discord adapter for media operations
  const discordMediaAdapter = createDiscordMediaAdapter(client);
  
  /**
   * Handle the make image command
   * @param {Object} interaction - Discord interaction
   * @param {string} prompt - User's text prompt for image generation
   * @returns {Promise<void>}
   */
  return async function handleMakeImageCommand(interaction, prompt) {
    const userId = interaction.user.id;
    
    if (!prompt || prompt.trim() === '') {
      await interaction.reply({
        content: 'Please provide a prompt for image generation.',
        ephemeral: true
      });
      return;
    }
    
    try {
      // Send a deferred response as processing might take time
      await interaction.deferReply();
      
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
          platform: 'discord',
          interaction,
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
        
        await interaction.editReply({
          content: errorMessage
        });
      } else {
        // Success case - send each generated image
        // For first image, use editReply, then use followUp for any additional images
        if (result.images.length === 0) {
          await interaction.editReply({
            content: 'Generation completed but no images were produced.'
          });
          return;
        }
        
        // Create buttons for regenerate and upscale actions
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`regenerate:${result.generationId}`)
              .setLabel('🔄 Regenerate')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`upscale:${result.images[0].id}`)
              .setLabel('⬆️ Upscale')
              .setStyle(ButtonStyle.Secondary)
          );
        
        // Send the first image
        await discordMediaAdapter.sendPhoto(
          interaction,
          result.images[0].url,
          {
            caption: `"${prompt}"\n\nGenerated with ${result.workflowName || 'default'} workflow.`,
            components: [row]
          }
        );
        
        // Send any additional images as follow-ups
        for (let i = 1; i < result.images.length; i++) {
          const additionalRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`regenerate:${result.generationId}`)
                .setLabel('🔄 Regenerate')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`upscale:${result.images[i].id}`)
                .setLabel('⬆️ Upscale')
                .setStyle(ButtonStyle.Secondary)
            );
          
          await interaction.followUp({
            files: [result.images[i].url],
            content: `"${prompt}"\n\nGenerated with ${result.workflowName || 'default'} workflow.`,
            components: [additionalRow]
          });
        }
      }
    } catch (error) {
      logger.error('Error in make image command:', error);
      
      // Handle the response based on whether we've already replied
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: 'Sorry, an error occurred while generating your image.'
        });
      } else {
        await interaction.reply({
          content: 'Sorry, an error occurred while generating your image.',
          ephemeral: true
        });
      }
    }
  };
}

module.exports = createMakeImageCommandHandler; 