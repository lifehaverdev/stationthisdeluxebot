/**
 * Train Model Workflow
 * 
 * Platform-agnostic workflow for training LoRA models using ComfyUI.
 * Handles the complete process from image collection to model training.
 */

/**
 * Train a LoRA model using ComfyUI
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.comfyuiService - The ComfyUI service
 * @param {Object} deps.pointsService - The Points service
 * @param {Object} deps.sessionService - The Session service
 * @param {Object} deps.mediaService - The Media service
 * @param {Object} deps.workflowsService - The Workflows service
 * @param {Object} deps.logger - Logger (defaults to console)
 * @param {Object} params - Training parameters
 * @param {string} params.userId - User identifier
 * @param {string} params.loraId - Optional loraId for existing training
 * @param {string} params.name - Name for the LoRA (if creating new)
 * @param {string} params.platform - Platform identifier (telegram, discord, web)
 * @param {Object} params.images - Optional array of image data
 * @param {Object} params.captions - Optional array of caption data
 * @param {Object} params.options - Additional training options
 * @returns {Promise<Object>} - Result of the training process
 */
async function trainModelWorkflow(deps, params) {
  const {
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    logger = console
  } = deps;

  const {
    userId,
    loraId = null,
    name = null,
    platform = 'telegram',
    images = [],
    captions = [],
    options = {}
  } = params;

  logger.debug(`Starting trainModel workflow for user ${userId}`);

  try {
    // Step 1: Check if we're creating a new LoRA or modifying an existing one
    let loraData;
    
    if (loraId) {
      // Get existing LoRA data
      const userSession = await sessionService.getSession(userId);
      loraData = userSession?.loras?.find(lora => lora.loraId === loraId);
      
      if (!loraData) {
        logger.error(`LoRA with ID ${loraId} not found for user ${userId}`);
        return {
          success: false,
          error: 'lora_not_found',
          message: `Training dataset with ID ${loraId} not found`
        };
      }
      
      logger.debug(`Found existing LoRA: ${loraData.name} (ID: ${loraId})`);
    } else if (name) {
      // Create a new LoRA
      const newLoraId = generateLoraId();
      
      loraData = {
        loraId: newLoraId,
        name,
        userId,
        images: new Array(20).fill(''),
        captions: new Array(20).fill(''),
        initiated: Date.now(),
        status: 'incomplete'
      };
      
      // Add to user's session
      const userSession = await sessionService.getSession(userId);
      if (!userSession.loras) {
        userSession.loras = [];
      }
      userSession.loras.push(loraData);
      await sessionService.updateSession(userId, userSession);
      
      logger.debug(`Created new LoRA: ${name} (ID: ${newLoraId})`);
      
      return {
        success: true,
        action: 'created',
        loraId: newLoraId,
        name: loraData.name
      };
    } else {
      // No loraId or name provided
      return {
        success: false,
        error: 'invalid_params',
        message: 'Either loraId or name must be provided'
      };
    }
    
    // Step 2: If images or captions were provided, update the LoRA data
    if (images.length > 0 || captions.length > 0) {
      const userSession = await sessionService.getSession(userId);
      const loraIndex = userSession.loras.findIndex(lora => lora.loraId === loraData.loraId);
      
      if (loraIndex === -1) {
        return {
          success: false,
          error: 'lora_not_found',
          message: 'LoRA not found in session'
        };
      }
      
      if (images.length > 0) {
        // Process and save images
        const processedImages = await processTrainingImages(images, userId, loraData.loraId, deps);
        
        // Update specific slots or add to empty ones
        for (let i = 0; i < processedImages.length; i++) {
          // Find an empty slot or use the specified slot index
          const slotIndex = options.slotIndex !== undefined ? 
            options.slotIndex : 
            userSession.loras[loraIndex].images.findIndex(slot => !slot);
          
          if (slotIndex >= 0 && slotIndex < userSession.loras[loraIndex].images.length) {
            userSession.loras[loraIndex].images[slotIndex] = processedImages[i];
          }
        }
      }
      
      if (captions.length > 0) {
        // Update captions in specific slots
        for (let i = 0; i < captions.length; i++) {
          const slotIndex = i;
          if (slotIndex >= 0 && slotIndex < userSession.loras[loraIndex].captions.length) {
            userSession.loras[loraIndex].captions[slotIndex] = captions[i];
          }
        }
      }
      
      // Update session
      await sessionService.updateSession(userId, userSession);
      
      return {
        success: true,
        action: 'updated',
        loraId: loraData.loraId,
        name: loraData.name,
        updatedImages: images.length,
        updatedCaptions: captions.length
      };
    }
    
    // Step 3: If submitting for training, validate and start the training process
    if (options.submitTraining) {
      // Check if we have enough images and captions
      const userSession = await sessionService.getSession(userId);
      const lora = userSession.loras.find(l => l.loraId === loraData.loraId);
      
      // Check if training dataset is complete
      const filledImageSlots = lora.images.filter(img => img).length;
      const filledCaptionSlots = lora.captions.filter(caption => caption).length;
      
      if (filledImageSlots < 4) {
        return {
          success: false,
          error: 'insufficient_images',
          message: 'At least 4 training images are required',
          currentCount: filledImageSlots
        };
      }
      
      if (filledCaptionSlots < filledImageSlots) {
        return {
          success: false,
          error: 'missing_captions',
          message: 'Each image must have a caption',
          imageCount: filledImageSlots,
          captionCount: filledCaptionSlots
        };
      }
      
      // Calculate point cost
      const pointCost = await calculateTrainingCost(lora, options, deps);
      
      // Check if user has enough points
      const hasEnoughPoints = await pointsService.checkBalance(userId, pointCost);
      
      if (!hasEnoughPoints) {
        return {
          success: false,
          error: 'not_enough_points',
          requiredPoints: pointCost
        };
      }
      
      // Prepare training parameters
      const trainingParams = prepareTrainingParams(lora, options);
      
      // Get the appropriate ComfyUI workflow
      const trainingWorkflow = await workflowsService.getWorkflowByName('lora_training');
      
      if (!trainingWorkflow) {
        logger.error('LoRA training workflow not found');
        return {
          success: false,
          error: 'workflow_not_found',
          message: 'LoRA training workflow not available'
        };
      }

      // Deduct points
      const pointsDeducted = await pointsService.deductPoints(userId, pointCost, {
        action: 'lora_training',
        loraId: lora.loraId,
        loraName: lora.name
      });
      
      if (!pointsDeducted) {
        logger.error(`Failed to deduct ${pointCost} points from user ${userId}`);
        return {
          success: false,
          error: 'points_deduction_failed',
          message: 'Failed to deduct points'
        };
      }

      try {
        // Start training process
        logger.debug(`Starting LoRA training for user ${userId}, LoRA ${lora.name}`);
        const runId = await comfyuiService.submitRequest({
          workflowId: trainingWorkflow.deploymentIds[0],
          inputs: trainingParams
        });
        
        // Update LoRA status in session
        lora.status = 'training';
        lora.runId = runId;
        lora.trainingStarted = Date.now();
        lora.pointsCost = pointCost;
        
        await sessionService.updateSession(userId, userSession);
        
        logger.debug(`Training started for LoRA ${lora.name}, run ID: ${runId}`);
        
        return {
          success: true,
          action: 'training_started',
          loraId: lora.loraId,
          name: lora.name,
          runId,
          estimatedCompletionTime: Date.now() + (options.trainingSteps || 1500) * 1000
        };
      } catch (trainingError) {
        logger.error(`Training submission failed: ${trainingError.message}`);
        
        // Refund points
        await pointsService.addPoints(userId, pointCost, {
          action: 'refund_training_error',
          loraId: lora.loraId,
          loraName: lora.name,
          error: trainingError.message
        });
        
        return {
          success: false,
          error: 'training_submission_failed',
          message: `Training submission failed: ${trainingError.message}`
        };
      }
    }
    
    // Step 4: If checking training status
    if (options.checkStatus && loraData.runId) {
      try {
        const status = await comfyuiService.checkStatus(loraData.runId);
        
        // Update LoRA status in session
        const userSession = await sessionService.getSession(userId);
        const loraIndex = userSession.loras.findIndex(l => l.loraId === loraData.loraId);
        
        if (loraIndex !== -1) {
          userSession.loras[loraIndex].lastStatusCheck = Date.now();
          userSession.loras[loraIndex].progress = status.progress;
          
          if (status.status === 'completed') {
            // Training completed, get results
            const results = await comfyuiService.getResults(loraData.runId);
            
            if (results.success) {
              userSession.loras[loraIndex].status = 'completed';
              userSession.loras[loraIndex].completedAt = Date.now();
              userSession.loras[loraIndex].loraFile = results.outputs.lora_file;
              
              // Add to user's collection
              if (!userSession.models) {
                userSession.models = [];
              }
              
              userSession.models.push({
                id: loraData.loraId,
                name: loraData.name,
                type: 'lora',
                created: Date.now(),
                file: results.outputs.lora_file,
                trainingImages: loraData.images.filter(img => img).length
              });
              
              await sessionService.updateSession(userId, userSession);
              
              return {
                success: true,
                action: 'training_completed',
                loraId: loraData.loraId,
                name: loraData.name,
                status: 'completed',
                loraFile: results.outputs.lora_file
              };
            } else {
              userSession.loras[loraIndex].status = 'failed';
              userSession.loras[loraIndex].error = 'Training failed to produce results';
              
              await sessionService.updateSession(userId, userSession);
              
              return {
                success: false,
                error: 'training_failed',
                message: 'Training completed but failed to produce a model'
              };
            }
          } else if (status.status === 'failed') {
            userSession.loras[loraIndex].status = 'failed';
            userSession.loras[loraIndex].error = status.error || 'Training failed';
            
            // Refund points
            await pointsService.addPoints(userId, userSession.loras[loraIndex].pointsCost, {
              action: 'refund_training_failed',
              loraId: loraData.loraId,
              loraName: loraData.name
            });
            
            await sessionService.updateSession(userId, userSession);
            
            return {
              success: false,
              error: 'training_failed',
              message: status.error || 'Training process failed'
            };
          }
          
          // Still in progress
          await sessionService.updateSession(userId, userSession);
          
          return {
            success: true,
            action: 'status_check',
            loraId: loraData.loraId,
            name: loraData.name,
            status: status.status,
            progress: status.progress
          };
        }
      } catch (statusError) {
        logger.error(`Status check failed: ${statusError.message}`);
        
        return {
          success: false,
          error: 'status_check_failed',
          message: `Failed to check training status: ${statusError.message}`
        };
      }
    }
    
    // Step 5: If no specific action requested, return LoRA data
    return {
      success: true,
      action: 'info',
      loraId: loraData.loraId,
      name: loraData.name,
      status: loraData.status,
      images: loraData.images.filter(img => img).length,
      captions: loraData.captions.filter(caption => caption).length,
      initiated: loraData.initiated,
      trainingStarted: loraData.trainingStarted,
      completedAt: loraData.completedAt
    };
    
  } catch (error) {
    logger.error(`LoRA training workflow error: ${error.message}`);
    
    return {
      success: false,
      error: 'workflow_error',
      message: `LoRA training workflow error: ${error.message}`
    };
  }
}

/**
 * Generate a unique LoRA ID
 * @returns {string} A unique ID for the LoRA
 */
function generateLoraId() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 7);
  
  return `lora-${timestamp}-${randomPart}`;
}

/**
 * Process and store training images
 * @param {Array<string>} images - Array of image data (or URLs)
 * @param {string} userId - User ID
 * @param {string} loraId - LoRA ID
 * @param {Object} deps - Dependencies
 * @returns {Promise<Array<string>>} Array of processed image URLs/paths
 */
async function processTrainingImages(images, userId, loraId, deps) {
  const { mediaService, logger } = deps;
  
  const processedImages = [];
  
  for (const imageData of images) {
    try {
      // Process the image using mediaService
      const processedImage = await mediaService.processImage({
        imageData: imageData,
        userId: userId,
        options: {
          resize: { width: 512, height: 512 },
          format: 'jpg',
          quality: 90,
          metadata: { loraId }
        }
      });
      
      processedImages.push(processedImage);
    } catch (error) {
      logger.error(`Failed to process training image: ${error.message}`);
      // Continue with next image
    }
  }
  
  return processedImages;
}

/**
 * Calculate the point cost for training
 * @param {Object} lora - LoRA data
 * @param {Object} options - Training options
 * @param {Object} deps - Dependencies
 * @returns {Promise<number>} The point cost
 */
async function calculateTrainingCost(lora, options, deps) {
  const { pointsService } = deps;
  
  // Base cost for LoRA training
  let baseCost = 1000;
  
  // Additional cost based on number of training images
  const imageCount = lora.images.filter(img => img).length;
  const imageCost = imageCount * 50;
  
  // Additional cost based on training steps
  const trainingSteps = options.trainingSteps || 1500;
  const stepsCost = Math.floor(trainingSteps / 100) * 20;
  
  // Calculate total cost
  let totalCost = baseCost + imageCost + stepsCost;
  
  // Apply user discount if any
  const discount = await pointsService.getUserDiscount(lora.userId);
  
  if (discount > 0) {
    totalCost = Math.floor(totalCost * (1 - discount / 100));
  }
  
  return totalCost;
}

/**
 * Prepare training parameters for ComfyUI
 * @param {Object} lora - LoRA data
 * @param {Object} options - Additional options
 * @returns {Object} Parameters for ComfyUI
 */
function prepareTrainingParams(lora, options = {}) {
  // Filter out empty slots
  const trainingImages = lora.images.filter(img => img);
  const trainingCaptions = lora.captions.filter((caption, index) => caption && lora.images[index]);
  
  // Build training dataset
  const dataset = trainingImages.map((image, index) => ({
    image: image,
    caption: trainingCaptions[index] || ''
  }));
  
  // Set training parameters
  return {
    training_data: dataset,
    lora_name: lora.name.replace(/\s+/g, '_').toLowerCase(),
    training_steps: options.trainingSteps || 1500,
    learning_rate: options.learningRate || 1e-4,
    batch_size: options.batchSize || 1,
    optimizer: options.optimizer || 'AdamW8bit',
    model_type: options.modelType || 'SD1.5',
    base_model: options.baseModel || 'runwayml/stable-diffusion-v1-5'
  };
}

module.exports = trainModelWorkflow; 