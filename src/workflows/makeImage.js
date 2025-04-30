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
    const workflow = await workflowsService.getWorkflowByName(workflowType);
    
    if (!workflow) {
      logger.error(`Workflow type ${workflowType} not found`);
      return {
        success: false,
        error: 'invalid_workflow',
        message: `Workflow type ${workflowType} not found`
      };
    }

    // Get deployment IDs for the workflow
    const deploymentIds = workflow.deploymentIds;
    if (!deploymentIds || deploymentIds.length === 0) {
      logger.error(`No deployment IDs found for workflow ${workflowType}`);
      return {
        success: false,
        error: 'invalid_workflow_deployment',
        message: `No deployments available for workflow ${workflowType}`
      };
    }

    // Select the appropriate deployment ID
    const deploymentId = selectDeploymentId(deploymentIds, options);
    
    // Step 4: Prepare generation parameters using the workflow's required inputs
    const generationParams = prepareGenerationParams(prompt, options, userPreferences, workflow.inputs);
    
    // Step 5: Deduct points from user's balance
    await pointsService.deductPoints(userId, pointCost, {
      operation: 'image_generation',
      workflow: workflowType,
    });
    
    // Step 6: Submit generation request to ComfyUI Deploy
    logger.info(`Submitting generation request for user ${userId} with deployment ID ${deploymentId}`);
    
    let runId;
    try {
      // Submit the request with our updated ComfyUIService
      runId = await comfyuiService.submitRequest({
        deploymentId: deploymentId,
        inputs: generationParams
      });
      
      logger.info(`Request submitted with run ID: ${runId}`);
    } catch (error) {
      // If submission fails, refund points to user
      await pointsService.addPoints(userId, pointCost, {
        operation: 'refund',
        reason: 'submission_failed'
      });
      
      logger.error(`Submission failed for user ${userId}: ${error.message}`);
      return {
        success: false,
        error: 'submission_failed',
        message: error.message
      };
    }
    
    // Step 7: Poll for generation status with timeout
    const maxAttempts = 60; // 10 minutes at 10-second intervals
    let attempts = 0;
    let finalStatus = null;
    
    while (attempts < maxAttempts) {
      attempts++;
      const status = await comfyuiService.checkStatus(runId);
      
      logger.info(`Run ${runId} status check ${attempts}/${maxAttempts}: ${status.status}, progress: ${status.progress}`);
      
      if (status.status === 'error') {
        // Refund points and return error
        await pointsService.addPoints(userId, pointCost, {
          operation: 'refund',
          reason: 'generation_error'
        });
        
        return {
          success: false,
          error: 'generation_error',
          message: status.error || 'An error occurred during generation'
        };
      }
      
      if (status.status === 'completed' || status.status === 'success') {
        finalStatus = status;
        break;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    // Handle timeout case
    if (!finalStatus) {
      logger.warn(`Generation timed out for run ${runId}`);
      return {
        success: false,
        error: 'generation_timeout',
        message: 'Generation is taking longer than expected. Please check status later.',
        runId: runId
      };
    }
    
    // Step 8: Get final results
    const generationResult = await comfyuiService.getResults(runId);
    
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
    
    // Step 9: Process and save the generated images
    const processedResults = await processGenerationResults(
      generationResult,
      userId,
      deps
    );
    
    // Step 10: Update user session with generation history
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
      generationId: runId,
      images: processedResults.images,
      metadata: {
        prompt,
        workflow: workflowType,
        deploymentId,
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
 * Select the appropriate deployment ID based on options
 * @param {Array<string>} deploymentIds - Available deployment IDs for the workflow
 * @param {Object} options - Generation options
 * @returns {string} - Selected deployment ID
 */
function selectDeploymentId(deploymentIds, options) {
  if (deploymentIds.length === 1) {
    return deploymentIds[0];
  }
  
  // Select deployment ID based on priority or settings
  // This can be expanded with more sophisticated selection logic
  if (options.priority === 'speed') {
    return deploymentIds[0]; // Assuming first deployment is optimized for speed
  } else if (options.priority === 'quality') {
    return deploymentIds[deploymentIds.length - 1]; // Assuming last deployment is highest quality
  } else if (options.deploymentIndex !== undefined && 
             options.deploymentIndex >= 0 && 
             options.deploymentIndex < deploymentIds.length) {
    return deploymentIds[options.deploymentIndex];
  }
  
  // Default to middle deployment for balance of speed/quality
  const middleIndex = Math.floor(deploymentIds.length / 2);
  return deploymentIds[middleIndex];
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
 * @param {Array<string>} requiredInputs - Required input keys for the workflow
 * @returns {Object} - Prepared parameters for ComfyUI Deploy
 */
function prepareGenerationParams(prompt, options, preferences, requiredInputs = []) {
  // Start with a base object for all inputs
  const params = {};
  
  // Add required input fields with proper prefixes
  if (requiredInputs.includes('input_prompt') || requiredInputs.includes('prompt')) {
    params.input_prompt = prompt;
  } else {
    // Default to generic input_prompt if no specific requirement
    params.input_prompt = prompt;
  }
  
  // Handle negative prompt
  const negativePrompt = options.negative_prompt || preferences.negative_prompt || '';
  if (requiredInputs.includes('input_negative')) {
    params.input_negative = negativePrompt;
  }
  
  // Add other commonly used parameters with proper field mapping
  // Map parameters based on what the workflow requires
  const paramMappings = [
    { key: 'width', inputKey: 'input_width' },
    { key: 'height', inputKey: 'input_height' },
    { key: 'steps', inputKey: 'input_steps' },
    { key: 'cfg_scale', inputKey: 'input_cfg' },
    { key: 'sampler', inputKey: 'input_sampler' },
    { key: 'seed', inputKey: 'input_seed' }
  ];
  
  // Add parameters that are required by the workflow
  paramMappings.forEach(mapping => {
    if (requiredInputs.includes(mapping.inputKey)) {
      const value = options[mapping.key] || preferences[mapping.key] || getDefaultValue(mapping.key);
      params[mapping.inputKey] = value;
    }
  });
  
  // Add any additional custom parameters from options
  Object.keys(options).forEach(key => {
    if (key.startsWith('input_') && !params[key]) {
      params[key] = options[key];
    }
  });
  
  return params;
}

/**
 * Get default value for a parameter
 * @param {string} key - Parameter key
 * @returns {any} - Default value
 */
function getDefaultValue(key) {
  const defaults = {
    width: 512,
    height: 512,
    steps: 20,
    cfg_scale: 7.0,
    sampler: 'euler_a',
    seed: Math.floor(Math.random() * 2147483647)
  };
  
  return defaults[key] || null;
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
  for (const imageUrl of generationResult.images) {
    try {
      // Download the image
      const localPath = await mediaService.downloadFromUrl(imageUrl, userId);
      
      // Get image metadata
      const metadata = await mediaService.getImageMetadata(localPath);
      
      // Save to user's media library if applicable
      const savedMedia = await mediaService.saveMedia(localPath, userId, {
        type: 'generated',
        source: 'comfyui_deploy',
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
    
    // Create history entry
    const historyEntry = {
      timestamp: Date.now(),
      prompt,
      workflowType,
      imageCount: results.images.length,
      images: results.images.map(img => ({
        url: img.url,
        path: img.savedPath
      }))
    };
    
    // Add to history array
    if (!session.history) {
      session.history = [];
    }
    
    session.history.unshift(historyEntry);
    
    // Limit history size
    if (session.history.length > 50) {
      session.history = session.history.slice(0, 50);
    }
    
    // Update session
    await sessionService.updateSession(userId, { history: session.history });
    
  } catch (error) {
    logger.error(`Error updating session history for user ${userId}:`, error);
  }
}

module.exports = makeImageWorkflow; 