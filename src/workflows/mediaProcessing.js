/**
 * Media Processing Workflow
 * 
 * Demonstrates how to use the MediaService for common operations like
 * downloading, processing, and sending media files across different platforms.
 */

/**
 * Process an image with options and return the processed image
 * @param {Object} deps - Injected dependencies
 * @param {Object} params - Processing parameters
 * @returns {Promise<Object>} - Result of the processing
 */
async function processImageWorkflow(deps, params) {
  const { 
    mediaService, 
    platformAdapter,
    logger = console
  } = deps;
  
  const {
    message,
    userId,
    platform = 'telegram',
    processingType,
    processingOptions = {}
  } = params;
  
  logger.debug(`Starting ${processingType} workflow for user ${userId}`);
  
  try {
    // Step 1: Get media URL from the message
    const mediaUrl = await mediaService.getMediaUrl(message, platform);
    
    if (!mediaUrl) {
      logger.error('No media found in message');
      return { success: false, error: 'No media found in message' };
    }
    
    // Step 2: Download the media file
    const localFilePath = await mediaService.downloadFromUrl(mediaUrl, userId);
    logger.debug(`Media downloaded to ${localFilePath}`);

    // Step 3: Get image metadata
    const metadata = await mediaService.getImageMetadata(localFilePath);
    logger.debug(`Image metadata: ${JSON.stringify(metadata)}`);
    
    // Step 4: Process the image based on processing type
    let processedFilePath;
    
    switch (processingType) {
      case 'resize':
        // Example: Resize image
        processedFilePath = await mediaService.processImage(localFilePath, {
          width: processingOptions.width || Math.floor(metadata.width / 2),
          height: processingOptions.height || Math.floor(metadata.height / 2),
          userId,
          quality: processingOptions.quality || 90
        });
        break;
        
      case 'format':
        // Example: Convert image format
        processedFilePath = await mediaService.processImage(localFilePath, {
          format: processingOptions.format || 'jpg',
          userId,
          quality: processingOptions.quality || 90
        });
        break;
        
      // Additional processing types can be added here
        
      default:
        // Default processing
        processedFilePath = localFilePath;
    }
    
    logger.debug(`Image processed: ${processedFilePath}`);
    
    // Step 5: Send the processed media back to the user
    // This uses the platform-specific adapter
    let sendResult;
    
    if (platform === 'telegram' && platformAdapter) {
      // Determine the appropriate sending method based on file type
      const fileExtension = processedFilePath.split('.').pop().toLowerCase();
      
      if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExtension)) {
        sendResult = await platformAdapter.sendPhoto(message, processedFilePath, {
          caption: `Processed with ${processingType}`
        });
      } else if (['gif'].includes(fileExtension)) {
        sendResult = await platformAdapter.sendAnimation(message, processedFilePath, {
          caption: `Processed with ${processingType}`
        });
      } else if (['mp4', 'webm'].includes(fileExtension)) {
        sendResult = await platformAdapter.sendVideo(message, processedFilePath, {
          caption: `Processed with ${processingType}`
        });
      } else {
        sendResult = await platformAdapter.sendDocument(message, processedFilePath, {
          caption: `Processed with ${processingType}`
        });
      }
      
      logger.debug('Sent processed media back to user');
    }
    
    // Step 6: Optionally save the media to persistent storage
    if (processingOptions.saveOutput) {
      const savedMedia = await mediaService.saveMedia(processedFilePath, userId, {
        originalUrl: mediaUrl,
        processingType,
        processingOptions,
        metadata
      });
      
      logger.debug(`Media saved to persistent storage: ${savedMedia.path}`);
      return { 
        success: true, 
        filePath: processedFilePath,
        savedMedia 
      };
    }
    
    return { 
      success: true, 
      filePath: processedFilePath
    };
  } catch (error) {
    logger.error('Error in media processing workflow:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Remove the background from an image
 * @param {Object} deps - Injected dependencies
 * @param {Object} params - Processing parameters
 * @returns {Promise<Object>} - Result of the background removal
 */
async function removeBackgroundWorkflow(deps, params) {
  // For demonstration, this is a simplified version
  // In a real implementation, this would call an external service
  // or use a local library for background removal
  
  return processImageWorkflow(deps, {
    ...params,
    processingType: 'removeBackground',
    processingOptions: {
      ...params.processingOptions,
      // Add specialized options for background removal
    }
  });
}

/**
 * Upscale an image
 * @param {Object} deps - Injected dependencies
 * @param {Object} params - Processing parameters
 * @returns {Promise<Object>} - Result of the upscaling
 */
async function upscaleImageWorkflow(deps, params) {
  // This would normally use a specialized upscaling service
  // For now, we'll simulate it by doubling the dimensions
  
  // Get the original dimensions first
  const { mediaService } = deps;
  const { message, userId, platform } = params;
  
  try {
    const mediaUrl = await mediaService.getMediaUrl(message, platform);
    if (!mediaUrl) {
      return { success: false, error: 'No media found in message' };
    }
    
    const localFilePath = await mediaService.downloadFromUrl(mediaUrl, userId);
    const metadata = await mediaService.getImageMetadata(localFilePath);
    
    // Upscale by multiplying dimensions by 2
    return processImageWorkflow(deps, {
      ...params,
      processingType: 'upscale',
      processingOptions: {
        ...params.processingOptions,
        width: metadata.width * 2,
        height: metadata.height * 2,
        quality: 90
      }
    });
  } catch (error) {
    console.error('Error in upscale workflow:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

module.exports = {
  processImageWorkflow,
  removeBackgroundWorkflow,
  upscaleImageWorkflow
}; 