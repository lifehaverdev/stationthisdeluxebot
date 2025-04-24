/**
 * Media Commands Module
 * 
 * Implements commands for media management:
 * - /images: View, upload, and manage images
 * - /audios: View, upload, and manage audio files
 * - /videos: View, upload, and manage video files
 */

const { CommandBuilder } = require('../utils/commandBuilder');
const { createMenu, createPaginatedMenu } = require('../utils/menuBuilder');
const { MediaService } = require('../services/mediaService');
const logger = require('../utils/logger');
const { handleError } = require('../utils/errorHandler');
const { sanitizeFilename } = require('../utils/fileUtils');

// Initialize services
const mediaService = new MediaService();

/**
 * Base command builder for media types
 * @param {string} mediaType - Type of media (image, audio, video)
 * @returns {CommandBuilder} Configured command builder for the specified media type
 */
function createMediaCommand(mediaType) {
  const commandName = `${mediaType}s`;
  const singularType = mediaType.charAt(0).toUpperCase() + mediaType.slice(1);
  const pluralType = `${singularType}s`;
  
  return new CommandBuilder()
    .setName(commandName)
    .setDescription(`View and manage your ${mediaType} files`)
    .setExecute(async (ctx) => {
      try {
        const userId = ctx.user.id;
        logger.info(`User ${userId} accessed ${mediaType} library`);
        
        // Get media files for this user
        const mediaFiles = await mediaService.getUserMedia(userId, mediaType);
        
        if (mediaFiles.length === 0) {
          const menu = createMenu({
            title: `My ${pluralType}`,
            message: `You don't have any ${mediaType} files yet.`,
            options: [
              { id: `${mediaType}:upload`, text: `Upload ${singularType}` }
            ]
          });
          
          return ctx.reply(menu);
        }
        
        // Create paginated menu for files
        const paginatedMenu = createPaginatedMenu({
          title: `My ${pluralType}`,
          items: mediaFiles,
          itemsPerPage: 5,
          renderItem: (item) => ({
            id: `${mediaType}:view:${item.id}`,
            text: item.name || `${singularType} ${item.id}`
          }),
          footerOptions: [
            { id: `${mediaType}:upload`, text: `Upload ${singularType}` }
          ]
        });
        
        return ctx.reply(paginatedMenu);
      } catch (error) {
        return handleError(ctx, `Error retrieving ${mediaType} files`, error);
      }
    })
    
    // View a specific media file
    .addSubcommand(
      new CommandBuilder()
        .setName('view')
        .setDescription(`View a specific ${mediaType} file`)
        .setDynamicHandler(/^view:(.+)$/, async (ctx, mediaId) => {
          try {
            const userId = ctx.user.id;
            logger.info(`User ${userId} viewing ${mediaType} ${mediaId}`);
            
            const mediaFile = await mediaService.getMediaById(userId, mediaId);
            
            if (!mediaFile) {
              return ctx.reply(`${singularType} not found.`);
            }
            
            // Prepare file details
            const fileDetails = {
              name: mediaFile.name,
              url: mediaFile.url,
              size: mediaFile.size,
              uploadDate: new Date(mediaFile.createdAt).toLocaleDateString(),
              mediaType: mediaFile.mediaType
            };
            
            // Send the media file based on type
            await ctx.sendMedia(mediaFile.mediaType, mediaFile.url, {
              caption: mediaFile.name
            });
            
            // Create options menu for this file
            const menu = createMenu({
              title: mediaFile.name,
              message: `Size: ${fileDetails.size}\nUploaded: ${fileDetails.uploadDate}`,
              options: [
                { id: `${mediaType}:rename:${mediaId}`, text: 'Rename' },
                { id: `${mediaType}:delete:${mediaId}`, text: 'Delete' },
                { id: `${mediaType}:back`, text: 'Back to Library' }
              ]
            });
            
            return ctx.reply(menu);
          } catch (error) {
            return handleError(ctx, `Error retrieving ${mediaType} details`, error);
          }
        })
    )
    
    // Upload a new media file
    .addSubcommand(
      new CommandBuilder()
        .setName('upload')
        .setDescription(`Upload a new ${mediaType} file`)
        .setExecute(async (ctx) => {
          try {
            const userId = ctx.user.id;
            logger.info(`User ${userId} initiated ${mediaType} upload`);
            
            // Start upload conversation
            await ctx.conversation.start(`${mediaType}Upload`);
            
            return ctx.reply(`Please send me the ${mediaType} file you want to upload.`);
          } catch (error) {
            return handleError(ctx, `Error starting ${mediaType} upload`, error);
          }
        })
        // Handle the conversation for media upload
        .setConversation(`${mediaType}Upload`, async (ctx) => {
          try {
            const userId = ctx.user.id;
            
            // Check if we received a file of the correct type
            if (!ctx.message.hasMedia(mediaType)) {
              return ctx.reply(`Please send a valid ${mediaType} file. Try again or type 'cancel' to abort.`);
            }
            
            // Get the file from the message
            const file = await ctx.message.getMedia();
            const fileName = file.filename || `${singularType}_${Date.now()}`;
            
            // Upload the file
            const uploadedFile = await mediaService.uploadMedia(userId, {
              name: sanitizeFilename(fileName),
              mediaType: mediaType,
              file: file.data,
              size: file.size
            });
            
            logger.info(`User ${userId} uploaded ${mediaType}: ${uploadedFile.id}`);
            
            // End conversation
            await ctx.conversation.end();
            
            // Confirm upload
            await ctx.reply(`Your ${mediaType} has been uploaded successfully!`);
            
            // Return to library view
            return ctx.executeCommand(commandName);
          } catch (error) {
            return handleError(ctx, `Error uploading ${mediaType}`, error);
          }
        })
    )
    
    // Rename a media file
    .addSubcommand(
      new CommandBuilder()
        .setName('rename')
        .setDescription(`Rename a ${mediaType} file`)
        .setDynamicHandler(/^rename:(.+)$/, async (ctx, mediaId) => {
          try {
            const userId = ctx.user.id;
            logger.info(`User ${userId} initiated rename for ${mediaType} ${mediaId}`);
            
            // Verify the file exists and belongs to the user
            const mediaFile = await mediaService.getMediaById(userId, mediaId);
            
            if (!mediaFile) {
              return ctx.reply(`${singularType} not found.`);
            }
            
            // Start rename conversation
            await ctx.conversation.start(`${mediaType}Rename`, { mediaId });
            
            return ctx.reply(`Current name: ${mediaFile.name}\nEnter a new name for this ${mediaType}:`);
          } catch (error) {
            return handleError(ctx, `Error renaming ${mediaType}`, error);
          }
        })
        // Handle the conversation for renaming
        .setConversation(`${mediaType}Rename`, async (ctx, conversationData) => {
          try {
            const userId = ctx.user.id;
            const newName = ctx.message.text;
            const { mediaId } = conversationData;
            
            if (!newName || newName.trim().length < 2) {
              return ctx.reply(`Name must be at least 2 characters. Please try again:`);
            }
            
            // Update the file name
            await mediaService.updateMedia(userId, mediaId, { name: sanitizeFilename(newName) });
            logger.info(`User ${userId} renamed ${mediaType} ${mediaId} to ${newName}`);
            
            // End conversation
            await ctx.conversation.end();
            
            // Confirm rename
            await ctx.reply(`${singularType} renamed successfully.`);
            
            // Return to view
            return ctx.executeCommand(`${commandName} view:${mediaId}`);
          } catch (error) {
            return handleError(ctx, `Error renaming ${mediaType}`, error);
          }
        })
    )
    
    // Delete a media file
    .addSubcommand(
      new CommandBuilder()
        .setName('delete')
        .setDescription(`Delete a ${mediaType} file`)
        .setDynamicHandler(/^delete:(.+)$/, async (ctx, mediaId) => {
          try {
            const userId = ctx.user.id;
            logger.info(`User ${userId} initiated delete for ${mediaType} ${mediaId}`);
            
            // Verify the file exists and belongs to the user
            const mediaFile = await mediaService.getMediaById(userId, mediaId);
            
            if (!mediaFile) {
              return ctx.reply(`${singularType} not found.`);
            }
            
            // Create confirmation menu
            const menu = createMenu({
              title: `Delete ${singularType}`,
              message: `Are you sure you want to delete "${mediaFile.name}"? This action cannot be undone.`,
              options: [
                { id: `${mediaType}:delete:confirm:${mediaId}`, text: 'Yes, Delete' },
                { id: `${mediaType}:view:${mediaId}`, text: 'Cancel' }
              ]
            });
            
            return ctx.reply(menu);
          } catch (error) {
            return handleError(ctx, `Error deleting ${mediaType}`, error);
          }
        })
        // Confirm deletion handler
        .setDynamicHandler(/^delete:confirm:(.+)$/, async (ctx, mediaId) => {
          try {
            const userId = ctx.user.id;
            
            // Delete the file
            await mediaService.deleteMedia(userId, mediaId);
            logger.info(`User ${userId} deleted ${mediaType} ${mediaId}`);
            
            // Confirm deletion
            await ctx.reply(`${singularType} has been deleted successfully.`);
            
            // Return to library view
            return ctx.executeCommand(commandName);
          } catch (error) {
            return handleError(ctx, `Error deleting ${mediaType}`, error);
          }
        })
    )
    
    // Back to library
    .addSubcommand(
      new CommandBuilder()
        .setName('back')
        .setExecute(async (ctx) => {
          return ctx.executeCommand(commandName);
        })
    );
}

// Create commands for each media type
const imageCommand = createMediaCommand('image');
const audioCommand = createMediaCommand('audio');
const videoCommand = createMediaCommand('video');

module.exports = {
  imageCommand,
  audioCommand,
  videoCommand
}; 