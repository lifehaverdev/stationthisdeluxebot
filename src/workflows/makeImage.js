/**
 * Make Image Workflow
 * 
 * Platform-agnostic workflow for generating images using ComfyUI.
 * Handles the complete process from prompt processing to image delivery.
 */

/**
 * Generate an image from a prompt using ComfyUI
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.comfyuiService - The ComfyUI service
 * @param {Object} deps.pointsService - The Points service
 * @param {Object} deps.sessionService - The Session service
 * @param {Object} deps.workflowsService - The Workflows service
 * @param {Object} deps.mediaService - The Media service
 * @param {Object} deps.logger - Logger (defaults to console)
 * @param {Object} params - Generation parameters
 * @param {string} params.userId - User identifier
 * @param {string} params.prompt - Text prompt for image generation
 * @param {string} params.platform - Platform identifier (telegram, discord, web)
 * @param {Object} params.message - Original message object (platform-specific)
 * @param {Object} params.options - Additional generation options
 * @returns {Promise<Object>} - Result of the generation process
 */
async function makeImageWorkflow(deps, params) {
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
    prompt,
    platform = 'telegram',
    message,
    options = {}
  } = params;

  logger.info(`Starting makeImage workflow for user ${userId} with prompt: ${prompt}`);

  try {
    // Step 1: Check if user has enough points
    const pointCost = await calculatePointCost(options, deps);
    const hasEnoughPoints = await pointsService.checkBalance(userId, pointCost);
    
    if (!hasEnoughPoints) {
      logger.info(`User ${userId} does not have enough points for this operation`);
      return {
        success: false,
        error: 'not_enough_points',
        requiredPoints: pointCost
      };
    }

    // Step 2: Get user preferences from session
    const userSession = await sessionService.getSession(userId);
    const userPreferences = userSession?.preferences || {};
    
    // Step 3: Select workflow based on user preferences and options
    const workflowType = options.workflowType || userPreferences.defaultWorkflow || 'standard';
    const workflow = await workflowsService.getWorkflow(workflowType);
    
    if (!workflow) {
      logger.error(`Workflow type ${workflowType} not found`);
      return {
        success: false,
        error: 'invalid_workflow',
        message: `Workflow type ${workflowType} not found`
      };
    }

    // Step 4: Prepare generation parameters
    const generationParams = prepareGenerationParams(prompt, options, userPreferences);
    
    // Step 5: Deduct points from user's balance
    await pointsService.deductPoints(userId, pointCost, {
      operation: 'image_generation',
      workflow: workflowType,
    });
    
    // Step 6: Submit generation request to ComfyUI
    logger.info(`Submitting generation request for user ${userId}`);
    const generationResult = await comfyuiService.generateImage(
      workflow,
      generationParams,
      { userId, trackProgress: true }
    );
    
    if (!generationResult.success) {
      // If generation failed, refund points to user
      await pointsService.addPoints(userId, pointCost, {
        operation: 'refund',
        reason: 'generation_failed'
      });
      
      logger.error(`Generation failed for user ${userId}: ${generationResult.error}`);
      return {
        success: false,
        error: 'generation_failed',
        message: generationResult.error
      };
    }
    
    // Step 7: Process and save the generated images
    const processedResults = await processGenerationResults(
      generationResult,
      userId,
      deps
    );
    
    // Step 8: Update user session with generation history
    await updateSessionWithHistory(
      userId,
      processedResults,
      prompt,
      workflowType,
      deps
    );
    
    // Return complete result object
    return {
      success: true,
      generationId: generationResult.id,
      images: processedResults.images,
      metadata: {
        prompt,
        workflow: workflowType,
        options: generationParams,
        pointCost
      }
    };
    
  } catch (error) {
    logger.error(`Error in makeImage workflow for user ${userId}:`, error);
    return {
      success: false,
      error: 'workflow_error',
      message: error.message
    };
  }
}

/**
 * Calculate the point cost for the requested generation
 * @param {Object} options - Generation options
 * @param {Object} deps - Injected dependencies
 * @returns {Promise<number>} - Calculated point cost
 */
async function calculatePointCost(options, deps) {
  const { pointsService } = deps;
  
  // Basic cost calculation based on options
  // In a real implementation, this would use the pointsService's calculation methods
  const baseCost = options.workflowType === 'standard' ? 10 : 20;
  const sizeCost = options.width && options.height 
    ? Math.ceil((options.width * options.height) / (512 * 512)) * 5
    : 0;
  const stepsCost = options.steps ? Math.max(0, options.steps - 20) * 0.5 : 0;
  
  return baseCost + sizeCost + stepsCost;
}

/**
 * Prepare generation parameters from prompt, options and user preferences
 * @param {string} prompt - User prompt
 * @param {Object} options - User-provided options
 * @param {Object} preferences - User preferences from session
 * @returns {Object} - Prepared parameters for ComfyUI
 */
function prepareGenerationParams(prompt, options, preferences) {
  // Combine user options with their saved preferences
  // Prioritizing explicitly provided options over preferences
  return {
    prompt: prompt,
    negative_prompt: options.negative_prompt || preferences.negative_prompt || '',
    width: options.width || preferences.width || 512,
    height: options.height || preferences.height || 512,
    steps: options.steps || preferences.steps || 20,
    cfg_scale: options.cfg_scale || preferences.cfg_scale || 7.0,
    sampler: options.sampler || preferences.sampler || 'euler_a',
    seed: options.seed || Math.floor(Math.random() * 2147483647),
    batch_size: options.batch_size || preferences.batch_size || 1,
    // Add any other parameters needed for generation
  };
}

/**
 * Process the generation results, downloading and saving images
 * @param {Object} generationResult - Result from ComfyUI service
 * @param {string} userId - User identifier
 * @param {Object} deps - Injected dependencies
 * @returns {Promise<Object>} - Processed results with local file paths
 */
async function processGenerationResults(generationResult, userId, deps) {
  const { mediaService, logger } = deps;
  const images = [];
  
  // For each output image URL in the generation result
  for (const imageUrl of generationResult.imageUrls) {
    try {
      // Download the image
      const localPath = await mediaService.downloadFromUrl(imageUrl, userId);
      
      // Get image metadata
      const metadata = await mediaService.getImageMetadata(localPath);
      
      // Save to user's media library if applicable
      const savedMedia = await mediaService.saveMedia(localPath, userId, {
        type: 'generated',
        source: 'comfyui',
        metadata
      });
      
      images.push({
        url: imageUrl,
        localPath,
        savedPath: savedMedia?.path,
        metadata
      });
      
    } catch (error) {
      logger.error(`Error processing generated image ${imageUrl}:`, error);
      // Continue with other images even if one fails
    }
  }
  
  return { images };
}

/**
 * Update user session with generation history
 * @param {string} userId - User identifier
 * @param {Object} results - Processed generation results
 * @param {string} prompt - Original prompt
 * @param {string} workflowType - Workflow type used
 * @param {Object} deps - Injected dependencies
 * @returns {Promise<void>}
 */
async function updateSessionWithHistory(userId, results, prompt, workflowType, deps) {
  const { sessionService, logger } = deps;
  
  try {
    const session = await sessionService.getSession(userId);
    
    if (!session) {
      logger.warn(`Cannot update history: no session found for user ${userId}`);
      return;
    }
    
    // Get current history or initialize empty array
    const history = session.generationHistory || [];
    
    // Add new generation to history
    history.unshift({
      timestamp: Date.now(),
      prompt,
      workflowType,
      imageCount: results.images.length,
      // Store references to the first image for quick access
      previewImage: results.images[0]?.localPath,
    });
    
    // Limit history size (keep last 10 entries)
    const limitedHistory = history.slice(0, 10);
    
    // Update session
    await sessionService.setSessionValue(userId, 'generationHistory', limitedHistory);
    
  } catch (error) {
    logger.error(`Error updating session history for user ${userId}:`, error);
    // Non-critical error, don't throw
  }
}

module.exports = {
  makeImageWorkflow
}; 