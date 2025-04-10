/**
 * Telegram Media Adapter
 * 
 * Adapts media-related commands for Telegram integration
 */

const { AppError, ERROR_SEVERITY } = require('../../../core/shared/errors');
const {
  processImageToImage,
  removeBackground,
  upscaleImage,
  interrogateImage,
  animateImage,
  generateVideo,
  checkMediaOperationStatus
} = require('../../../commands/mediaCommand');

/**
 * MediaTelegramAdapter
 * 
 * Handles media-related operations for Telegram
 */
class MediaTelegramAdapter {
  /**
   * Extract image from Telegram message
   * @param {Object} message - Telegram message
   * @returns {Promise<string|null>} - Image URL or null if no image
   */
  async extractImageFromMessage(message) {
    // No photo in message
    if (!message.photo && !message.document && !message.reply_to_message) {
      return null;
    }
    
    let fileId = null;
    
    // Get fileId from message photo (highest resolution)
    if (message.photo && message.photo.length > 0) {
      fileId = message.photo[message.photo.length - 1].file_id;
    }
    // Or from document if it's an image
    else if (message.document && message.document.mime_type && 
             message.document.mime_type.startsWith('image/')) {
      fileId = message.document.file_id;
    }
    // Or from replied message if it has a photo
    else if (message.reply_to_message && message.reply_to_message.photo) {
      const replyPhotos = message.reply_to_message.photo;
      fileId = replyPhotos[replyPhotos.length - 1].file_id;
    }
    
    if (!fileId) {
      return null;
    }
    
    try {
      // Get file path using Telegram Bot API
      // Note: This is a placeholder - the actual implementation
      // would need to use the bot instance to get the file path
      const filePath = await this._getFileUrl(fileId);
      return filePath;
    } catch (error) {
      console.error('Error getting file URL:', error);
      return null;
    }
  }
  
  /**
   * Get file URL from file ID (placeholder)
   * @private
   * @param {string} fileId - Telegram file ID
   * @returns {Promise<string>} - File URL
   */
  async _getFileUrl(fileId) {
    // In a real implementation, this would call bot.getFile(fileId)
    // and construct a proper URL
    return `https://api.telegram.org/file/bot{TOKEN}/${fileId}`;
  }
  
  /**
   * Process image-to-image generation for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async processImageToImage(message, services, options = {}) {
    try {
      const {
        mediaService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      const prompt = options.prompt;
      
      // Get image URL
      let imageUrl = options.imageUrl;
      if (!imageUrl) {
        imageUrl = await this.extractImageFromMessage(message);
        
        if (!imageUrl) {
          throw new AppError('No image found in message', {
            severity: ERROR_SEVERITY.WARNING,
            code: 'NO_IMAGE_FOUND',
            userFacing: true
          });
        }
      }
      
      // Process image-to-image operation
      const result = await processImageToImage({
        mediaService,
        sessionManager,
        pointsService,
        userId,
        prompt,
        imageUrl,
        settings: options.settings || {},
        callbackUrl: options.callbackUrl,
        metadata: {
          telegramChatId: message.chat.id,
          telegramMessageId: message.message_id,
          username: message.from.username,
          source: 'telegram'
        }
      });
      
      return {
        success: true,
        taskId: result.taskId,
        runId: result.runId,
        message: `🔄 Processing image with prompt: "${prompt}"`
      };
    } catch (error) {
      console.error('Error processing image-to-image for Telegram:', error);
      
      // Determine if this is a user-facing error
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while processing your image';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'IMAGE_TO_IMAGE_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Remove background from image for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async removeBackground(message, services, options = {}) {
    try {
      const {
        mediaService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      
      // Get image URL
      let imageUrl = options.imageUrl;
      if (!imageUrl) {
        imageUrl = await this.extractImageFromMessage(message);
        
        if (!imageUrl) {
          throw new AppError('No image found in message', {
            severity: ERROR_SEVERITY.WARNING,
            code: 'NO_IMAGE_FOUND',
            userFacing: true
          });
        }
      }
      
      // Process background removal
      const result = await removeBackground({
        mediaService,
        sessionManager,
        pointsService,
        userId,
        imageUrl,
        settings: options.settings || {},
        callbackUrl: options.callbackUrl
      });
      
      return {
        success: true,
        taskId: result.taskId,
        runId: result.runId,
        message: '🖼️ Removing background from image...'
      };
    } catch (error) {
      console.error('Error removing background for Telegram:', error);
      
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while removing the background';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'BACKGROUND_REMOVAL_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Upscale image for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async upscaleImage(message, services, options = {}) {
    try {
      const {
        mediaService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      
      // Get image URL
      let imageUrl = options.imageUrl;
      if (!imageUrl) {
        imageUrl = await this.extractImageFromMessage(message);
        
        if (!imageUrl) {
          throw new AppError('No image found in message', {
            severity: ERROR_SEVERITY.WARNING,
            code: 'NO_IMAGE_FOUND',
            userFacing: true
          });
        }
      }
      
      // Process upscaling
      const result = await upscaleImage({
        mediaService,
        sessionManager,
        pointsService,
        userId,
        imageUrl,
        settings: options.settings || {},
        callbackUrl: options.callbackUrl
      });
      
      return {
        success: true,
        taskId: result.taskId,
        runId: result.runId,
        message: '🔍 Upscaling image...'
      };
    } catch (error) {
      console.error('Error upscaling image for Telegram:', error);
      
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while upscaling the image';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'UPSCALE_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Analyze image content for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async interrogateImage(message, services, options = {}) {
    try {
      const {
        mediaService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      
      // Get image URL
      let imageUrl = options.imageUrl;
      if (!imageUrl) {
        imageUrl = await this.extractImageFromMessage(message);
        
        if (!imageUrl) {
          throw new AppError('No image found in message', {
            severity: ERROR_SEVERITY.WARNING,
            code: 'NO_IMAGE_FOUND',
            userFacing: true
          });
        }
      }
      
      // Process interrogation
      const result = await interrogateImage({
        mediaService,
        sessionManager,
        pointsService,
        userId,
        imageUrl,
        settings: options.settings || {},
        callbackUrl: options.callbackUrl
      });
      
      return {
        success: true,
        taskId: result.taskId,
        runId: result.runId,
        message: '🔍 Analyzing image content...'
      };
    } catch (error) {
      console.error('Error interrogating image for Telegram:', error);
      
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while analyzing the image';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'INTERROGATE_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Generate animation from image for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async animateImage(message, services, options = {}) {
    try {
      const {
        mediaService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      const prompt = options.prompt || '';
      
      // Get image URL
      let imageUrl = options.imageUrl;
      if (!imageUrl) {
        imageUrl = await this.extractImageFromMessage(message);
        
        if (!imageUrl) {
          throw new AppError('No image found in message', {
            severity: ERROR_SEVERITY.WARNING,
            code: 'NO_IMAGE_FOUND',
            userFacing: true
          });
        }
      }
      
      // Process animation
      const result = await animateImage({
        mediaService,
        sessionManager,
        pointsService,
        userId,
        prompt,
        imageUrl,
        settings: options.settings || {},
        callbackUrl: options.callbackUrl
      });
      
      return {
        success: true,
        taskId: result.taskId,
        runId: result.runId,
        message: '🎬 Generating animation from image...'
      };
    } catch (error) {
      console.error('Error animating image for Telegram:', error);
      
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while generating the animation';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'ANIMATE_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Generate video from prompt for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async generateVideo(message, services, options = {}) {
    try {
      const {
        mediaService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      const prompt = options.prompt;
      
      if (!prompt) {
        throw new AppError('Prompt is required for video generation', {
          severity: ERROR_SEVERITY.WARNING,
          code: 'NO_PROMPT_PROVIDED',
          userFacing: true
        });
      }
      
      // Process video generation
      const result = await generateVideo({
        mediaService,
        sessionManager,
        pointsService,
        userId,
        prompt,
        settings: options.settings || {},
        callbackUrl: options.callbackUrl
      });
      
      return {
        success: true,
        taskId: result.taskId,
        runId: result.runId,
        message: `🎬 Generating video with prompt: "${prompt}"`
      };
    } catch (error) {
      console.error('Error generating video for Telegram:', error);
      
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while generating the video';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'VIDEO_GENERATION_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
}

// Create singleton instance
const mediaTelegramAdapter = new MediaTelegramAdapter();

module.exports = {
  mediaTelegramAdapter
}; 