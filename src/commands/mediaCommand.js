/**
 * Media Command implementations
 * 
 * Platform-agnostic implementations of media-related commands
 * such as image-to-image, background removal, upscaling, etc.
 */

const { v4: uuidv4 } = require('uuid');
const { AppError, ERROR_SEVERITY } = require('../core/shared/errors');
const config = require('../services/comfydeploy/config');

/**
 * Common function to handle all media operations
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance (ComfyDeployMediaService)
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.operationType - Type of operation ('image-to-image', 'background-removal', etc.)
 * @param {Object} context.params - Operation-specific parameters
 * @returns {Promise<Object>} - Operation result
 */
async function processMediaOperation(context) {
  const {
    mediaService,
    sessionManager,
    pointsService,
    userId,
    operationType,
    params = {}
  } = context;

  if (!mediaService) {
    throw new AppError('Media service is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MEDIA_SERVICE_REQUIRED'
    });
  }

  if (!sessionManager) {
    throw new AppError('SessionManager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_MANAGER_REQUIRED'
    });
  }

  // Get or create user session
  let session;
  try {
    session = await sessionManager.getSession(userId);
    
    // If session doesn't exist, create it
    if (!session) {
      session = await sessionManager.createSession(userId, {
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    } else {
      // Update last activity
      await sessionManager.updateSession(userId, {
        lastActivity: Date.now(),
        lastCommand: `/${operationType}`
      });
    }
  } catch (error) {
    console.error('Error accessing session:', error);
    throw new AppError('Failed to access session data', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_ACCESS_FAILED',
      cause: error
    });
  }

  // Check if user has sufficient points if points service is available
  if (pointsService) {
    // Get cost for this operation type
    const operationCost = config.getOperationCost(operationType);
    
    const hasEnoughPoints = await pointsService.hasSufficientPoints(
      userId, 
      operationCost, 
      'points'
    );
    
    if (!hasEnoughPoints) {
      throw new AppError('Insufficient points for this operation', {
        severity: ERROR_SEVERITY.WARNING,
        code: 'INSUFFICIENT_POINTS',
        userFacing: true
      });
    }
  }

  // Process the operation based on type
  let result;
  try {
    switch (operationType) {
      case 'image-to-image':
        result = await mediaService.processImageToImage({
          userId,
          prompt: params.prompt,
          imageUrl: params.imageUrl,
          settings: params.settings,
          callbackUrl: params.callbackUrl,
          metadata: params.metadata
        });
        break;
        
      case 'background-removal':
        result = await mediaService.removeBackground({
          userId,
          imageUrl: params.imageUrl,
          settings: params.settings,
          callbackUrl: params.callbackUrl
        });
        break;
        
      case 'upscale':
        result = await mediaService.upscaleImage({
          userId,
          imageUrl: params.imageUrl,
          settings: params.settings,
          callbackUrl: params.callbackUrl
        });
        break;
        
      case 'interrogate':
        result = await mediaService.interrogateImage({
          userId,
          imageUrl: params.imageUrl,
          settings: params.settings,
          callbackUrl: params.callbackUrl
        });
        break;
        
      case 'animate':
        result = await mediaService.animateImage({
          userId,
          prompt: params.prompt,
          imageUrl: params.imageUrl,
          settings: params.settings,
          callbackUrl: params.callbackUrl
        });
        break;
        
      case 'video':
        result = await mediaService.generateVideo({
          userId,
          prompt: params.prompt,
          settings: params.settings,
          callbackUrl: params.callbackUrl
        });
        break;
        
      default:
        throw new AppError(`Unknown operation type: ${operationType}`, {
          severity: ERROR_SEVERITY.ERROR,
          code: 'UNKNOWN_OPERATION_TYPE',
          userFacing: true
        });
    }
  } catch (error) {
    console.error(`Error processing ${operationType} operation:`, error);
    throw new AppError(`Failed to process ${operationType} operation`, {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MEDIA_OPERATION_FAILED',
      cause: error,
      userFacing: true
    });
  }

  // Store the operation in the session for tracking
  const userOperations = session.get('mediaOperations') || [];
  userOperations.push({
    id: result.taskId,
    type: operationType,
    createdAt: Date.now(),
    runId: result.run_id,
    status: 'queued'
  });

  // Update session
  await sessionManager.updateSession(userId, {
    mediaOperations: userOperations.slice(-10), // Keep only the 10 most recent operations
    lastMediaOperation: operationType
  });

  // Return operation result
  return {
    taskId: result.taskId,
    runId: result.run_id,
    status: result.status,
    operationType,
    timestamp: Date.now()
  };
}

/**
 * Process image-to-image generation
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.prompt - Generation prompt
 * @param {string} context.imageUrl - Source image URL
 * @param {Object} [context.settings] - Additional settings
 * @returns {Promise<Object>} - Operation result
 */
async function processImageToImage(context) {
  return processMediaOperation({
    ...context,
    operationType: 'image-to-image',
    params: {
      prompt: context.prompt,
      imageUrl: context.imageUrl,
      settings: context.settings,
      callbackUrl: context.callbackUrl,
      metadata: context.metadata
    }
  });
}

/**
 * Remove background from image
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.imageUrl - Source image URL
 * @param {Object} [context.settings] - Additional settings
 * @returns {Promise<Object>} - Operation result
 */
async function removeBackground(context) {
  return processMediaOperation({
    ...context,
    operationType: 'background-removal',
    params: {
      imageUrl: context.imageUrl,
      settings: context.settings,
      callbackUrl: context.callbackUrl
    }
  });
}

/**
 * Upscale image
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.imageUrl - Source image URL
 * @param {Object} [context.settings] - Additional settings
 * @returns {Promise<Object>} - Operation result
 */
async function upscaleImage(context) {
  return processMediaOperation({
    ...context,
    operationType: 'upscale',
    params: {
      imageUrl: context.imageUrl,
      settings: context.settings,
      callbackUrl: context.callbackUrl
    }
  });
}

/**
 * Analyze image content (interrogate)
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.imageUrl - Source image URL
 * @param {Object} [context.settings] - Additional settings
 * @returns {Promise<Object>} - Operation result
 */
async function interrogateImage(context) {
  return processMediaOperation({
    ...context,
    operationType: 'interrogate',
    params: {
      imageUrl: context.imageUrl,
      settings: context.settings,
      callbackUrl: context.callbackUrl
    }
  });
}

/**
 * Generate animation from image
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.prompt - Generation prompt
 * @param {string} context.imageUrl - Source image URL
 * @param {Object} [context.settings] - Additional settings
 * @returns {Promise<Object>} - Operation result
 */
async function animateImage(context) {
  return processMediaOperation({
    ...context,
    operationType: 'animate',
    params: {
      prompt: context.prompt,
      imageUrl: context.imageUrl,
      settings: context.settings,
      callbackUrl: context.callbackUrl
    }
  });
}

/**
 * Generate video from prompt
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID
 * @param {string} context.prompt - Generation prompt
 * @param {Object} [context.settings] - Additional settings
 * @returns {Promise<Object>} - Operation result
 */
async function generateVideo(context) {
  return processMediaOperation({
    ...context,
    operationType: 'video',
    params: {
      prompt: context.prompt,
      settings: context.settings,
      callbackUrl: context.callbackUrl
    }
  });
}

/**
 * Check status of a media operation
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.mediaService - Media service instance
 * @param {string} context.runId - ComfyDeploy run ID
 * @param {string} context.taskId - Task ID
 * @param {string} context.userId - User ID
 * @returns {Promise<Object>} - Operation status
 */
async function checkMediaOperationStatus(context) {
  const { mediaService, runId, taskId, userId } = context;
  
  if (!mediaService) {
    throw new AppError('Media service is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MEDIA_SERVICE_REQUIRED'
    });
  }
  
  try {
    const status = await mediaService.checkStatus({
      run_id: runId,
      taskId,
      userId
    });
    
    return status;
  } catch (error) {
    console.error('Error checking media operation status:', error);
    throw new AppError('Failed to check operation status', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'STATUS_CHECK_FAILED',
      cause: error
    });
  }
}

module.exports = {
  processMediaOperation,
  processImageToImage,
  removeBackground,
  upscaleImage,
  interrogateImage,
  animateImage,
  generateVideo,
  checkMediaOperationStatus
}; 