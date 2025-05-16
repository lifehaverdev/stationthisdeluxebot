/**
 * Media Command implementations
 * 
 * Platform-agnostic implementations of media-related commands
 * such as image-to-image, background removal, upscaling, etc.
 * 
 * This implementation follows the clean architecture pattern and uses
 * the workflow system for complex interactions.
 */

const { v4: uuidv4 } = require('uuid');
const { AppError, ERROR_SEVERITY } = require('../core/shared/errors');
const { createMediaOperationWorkflow, resumeWorkflowWithWebhook } = require('../core/workflow/workflows/MediaOperationWorkflow');

/**
 * Handler for the media operations commands
 * 
 * @param {Object} context - Command execution context
 * @returns {Promise<Object>} Command execution result
 */
async function mediaCommandHandler(context) {
  const {
    userId,
    platform,
    sessionManager,
    uiManager,
    mediaService,
    pointsService,
    analyticsService,
    workflowEngine,
    parameters = {},
    messageContext = {},
    operationType
  } = context;

  if (!userId) {
    throw new AppError('User ID is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_USER_ID',
      userFacing: true
    });
  }

  if (!operationType) {
    throw new AppError('Operation type is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_OPERATION_TYPE',
      userFacing: true
    });
  }

  if (!mediaService) {
    throw new AppError('Media service is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_MEDIA_SERVICE'
    });
  }

  try {
    // Track command usage
    analyticsService?.trackEvent('command:media:initiated', {
      userId,
      platform,
      operationType,
      timestamp: Date.now()
    });

    // Get user's session if available
    let userSession;
    if (sessionManager) {
      userSession = await sessionManager.getSession(userId);
      if (!userSession) {
        // Create a new session if none exists
        userSession = await sessionManager.createSession(userId, {
          createdAt: Date.now(),
          lastActivity: Date.now()
        });
      } else {
        // Update existing session
        await sessionManager.updateSession(userId, {
          lastActivity: Date.now(),
          lastCommand: operationType
        });
      }
    }

    // Prepare the workflow options
    const workflowOptions = {
      mediaService,
      pointsService,
      analyticsService,
      deliveryAdapter: createPlatformDeliveryAdapter(platform, uiManager, messageContext)
    };

    // Create the workflow instance
    const workflow = createMediaOperationWorkflow(workflowOptions);

    // Initialize the workflow state with user context
    const initialState = {
      userId,
      platform,
      operationType,
      username: messageContext.username || userSession?.get('username'),
      chatId: messageContext.chatId,
      threadId: messageContext.threadId,
      locale: messageContext.locale || userSession?.get('locale') || 'en',
      balance: userSession?.get('points')?.balance,
      workflowId: uuidv4(),
      startedAt: Date.now(),
      platformContext: messageContext,
      callbackUrl: messageContext.callbackUrl
    };

    // If we have a pre-defined image URL or prompt, add it to the workflow context
    if (parameters.imageUrl) {
      initialState.imageUrl = parameters.imageUrl;
    }

    if (parameters.prompt) {
      initialState.prompt = parameters.prompt;
    }

    // If we have settings, add them to the workflow context
    if (parameters.settings) {
      initialState.settings = parameters.settings;
    }

    // Start the workflow using the WorkflowEngine if available
    if (workflowEngine) {
      const startedWorkflow = await workflowEngine.startWorkflow('MediaOperationWorkflow', initialState, workflow);
      
      // Return information about the started workflow
      return {
        success: true,
        message: `${operationType} workflow started`,
        workflowId: startedWorkflow.id,
        initialStep: startedWorkflow.currentStep
      };
    }

    // Fallback to manual workflow initialization if no WorkflowEngine
    const workflowInstance = workflow.createWorkflow({
      context: initialState
    });

    // If we have a specific operation type, jump to that step
    if (operationType && operationType !== 'media') {
      // Process the operation type selection
      await workflowInstance.processInput(operationType);
    }

    // Render the current step UI using the UIManager
    const currentStep = workflowInstance.getCurrentStep();
    
    if (!currentStep) {
      throw new AppError('Failed to initialize workflow', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_INIT_FAILED',
        userFacing: true
      });
    }

    // Extract UI definition from the current step
    const uiDefinition = currentStep.ui || {};

    // Create platform-specific context for UI rendering
    const renderContext = {
      chatId: messageContext.chatId,
      threadId: messageContext.threadId,
      messageId: messageContext.messageId,
      workflowId: workflowInstance.id,
      stepId: currentStep.id
    };

    // Render the UI component
    const renderResult = await renderStepUI(uiManager, platform, uiDefinition, renderContext);

    // Store the workflow in the user's session
    if (sessionManager) {
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowInstance.id]: workflowInstance.serialize()
        }
      });
    }

    // Return information about the started workflow
    return {
      success: true,
      message: `${operationType} workflow started`,
      workflowId: workflowInstance.id,
      uiRendered: !!renderResult,
      initialStep: currentStep.id
    };
  } catch (error) {
    // Track error
    analyticsService?.trackEvent('command:media:error', {
      userId,
      platform,
      operationType,
      error: error.message,
      code: error.code,
      timestamp: Date.now()
    });

    // Handle error based on severity
    if (error.severity === ERROR_SEVERITY.WARNING) {
      // For warnings, return a user-friendly error
      return {
        success: false,
        message: error.userFacing ? error.message : `Could not start ${operationType} operation`,
        error: error.message,
        code: error.code
      };
    }

    // For critical errors, rethrow for the command router to handle
    throw error;
  }
}

/**
 * Create a platform-specific delivery adapter
 * @private
 * @param {string} platform - Platform identifier
 * @param {Object} uiManager - UI Manager instance
 * @param {Object} messageContext - Message context for delivery
 * @returns {Object} Delivery adapter
 */
function createPlatformDeliveryAdapter(platform, uiManager, messageContext) {
  return {
    deliverMedia: async ({ userId, mediaType, media, context }) => {
      try {
        // Create a result component
        const component = uiManager.createComponent('result', {
          mediaType,
          mediaSrc: media,
          prompt: context.prompt,
          settings: context.settings,
          operationType: context.operationType
        });

        // Render the component on the specified platform
        const renderContext = {
          chatId: messageContext.chatId,
          threadId: messageContext.threadId,
          userId
        };

        const result = await uiManager.render(component, {}, platform, renderContext);

        return {
          id: `delivery-${Date.now()}`,
          success: true,
          mediaUrl: media,
          renderResult: result
        };
      } catch (error) {
        console.error('Error delivering media:', error);
        
        // Return minimal success to avoid breaking the workflow
        return {
          id: `delivery-${Date.now()}`,
          success: false,
          error: error.message
        };
      }
    },
    
    deliverErrorMessage: async ({ userId, error, platformContext }) => {
      try {
        // Create an error component
        const component = uiManager.createComponent('error', {
          message: error.userFacing ? error.message : 'Operation failed',
          code: error.code
        });

        // Render the component on the specified platform
        const renderContext = {
          chatId: messageContext.chatId,
          threadId: messageContext.threadId,
          userId
        };

        const result = await uiManager.render(component, {}, platform, renderContext);

        return {
          id: `error-${Date.now()}`,
          success: true,
          renderResult: result
        };
      } catch (err) {
        console.error('Error delivering error message:', err);
        
        // Just log the failure, don't break the workflow
        return {
          id: `error-${Date.now()}`,
          success: false,
          error: err.message
        };
      }
    }
  };
}

/**
 * Render a step's UI
 * @private
 * @param {Object} uiManager - UI Manager instance
 * @param {string} platform - Platform identifier
 * @param {Object} uiDefinition - UI definition from workflow step
 * @param {Object} context - Rendering context
 * @returns {Promise<Object>} Render result
 */
async function renderStepUI(uiManager, platform, uiDefinition, context) {
  if (!uiManager || !uiDefinition) {
    return null;
  }

  try {
    // Create component based on UI definition
    const component = uiManager.createComponent(uiDefinition.type, uiDefinition);
    
    // Render the component
    return await uiManager.render(component, {}, platform, context);
  } catch (error) {
    console.error('Error rendering UI:', error);
    return null;
  }
}

/**
 * Process webhook events for media operations
 * 
 * @param {Object} context - Webhook context
 * @param {Object} context.payload - Webhook payload
 * @param {string} context.userId - User ID
 * @param {string} context.workflowId - Workflow ID
 * @param {Object} context.sessionManager - Session manager
 * @returns {Promise<Object>} Webhook processing result
 */
async function processMediaWebhook(context) {
  const { payload, userId, workflowId, sessionManager } = context;
  
  if (!payload || !userId || !workflowId || !sessionManager) {
    throw new AppError('Missing required webhook parameters', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'INVALID_WEBHOOK'
    });
  }
  
  try {
    // Get the user's session
    const session = await sessionManager.getSession(userId);
    if (!session) {
      throw new AppError('User session not found', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'SESSION_NOT_FOUND'
      });
    }
    
    // Get the serialized workflow from the session
    const serializedWorkflow = session.get(`workflows.${workflowId}`);
    if (!serializedWorkflow) {
      throw new AppError('Workflow not found in session', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_NOT_FOUND'
      });
    }
    
    // Resume the workflow with the webhook payload
    const updatedWorkflow = await resumeWorkflowWithWebhook(serializedWorkflow, payload);
    
    // Update the workflow in the session
    await sessionManager.updateSession(userId, {
      [`workflows.${workflowId}`]: updatedWorkflow.serialize()
    });
    
    return {
      success: true,
      workflowId,
      status: payload.status,
      updatedWorkflow: updatedWorkflow.getCurrentStepId()
    };
  } catch (error) {
    console.error('Error processing media webhook:', error);
    
    return {
      success: false,
      error: {
        message: error.message,
        code: error.code || 'WEBHOOK_PROCESSING_ERROR'
      }
    };
  }
}

/**
 * Create an image-to-image command handler
 * 
 * @param {Object} dependencies - Command dependencies
 * @returns {Object} Command handler
 */
function createImageToImageCommand(dependencies) {
  return {
    name: 'image-to-image',
    description: 'Transform an image using AI',
    aliases: ['img2img', 'i2i'],
    category: 'media',
    usage: '/image-to-image [prompt] - Upload an image to transform it based on your prompt',
    execute: async (input) => {
      return mediaCommandHandler({
        ...input,
        ...dependencies,
        operationType: 'image-to-image'
      });
    },
    processWebhook: processMediaWebhook
  };
}

/**
 * Create a background removal command handler
 * 
 * @param {Object} dependencies - Command dependencies
 * @returns {Object} Command handler
 */
function createRemoveBackgroundCommand(dependencies) {
  return {
    name: 'remove-background',
    description: 'Remove the background from an image',
    aliases: ['rembg', 'nobg'],
    category: 'media',
    usage: '/remove-background - Upload an image to remove its background',
    execute: async (input) => {
      return mediaCommandHandler({
        ...input,
        ...dependencies,
        operationType: 'background-removal'
      });
    },
    processWebhook: processMediaWebhook
  };
}

/**
 * Create an upscale command handler
 * 
 * @param {Object} dependencies - Command dependencies
 * @returns {Object} Command handler
 */
function createUpscaleCommand(dependencies) {
  return {
    name: 'upscale',
    description: 'Enhance image quality and resolution',
    aliases: ['enhance'],
    category: 'media',
    usage: '/upscale - Upload an image to enhance its quality',
    execute: async (input) => {
      return mediaCommandHandler({
        ...input,
        ...dependencies,
        operationType: 'upscale'
      });
    },
    processWebhook: processMediaWebhook
  };
}

/**
 * Create an image analysis command handler
 * 
 * @param {Object} dependencies - Command dependencies
 * @returns {Object} Command handler
 */
function createAnalyzeImageCommand(dependencies) {
  return {
    name: 'analyze',
    description: 'Analyze an image to get a description or prompt',
    aliases: ['interrogate', 'describe'],
    category: 'media',
    usage: '/analyze - Upload an image to get its description',
    execute: async (input) => {
      return mediaCommandHandler({
        ...input,
        ...dependencies,
        operationType: 'interrogate'
      });
    },
    processWebhook: processMediaWebhook
  };
}

/**
 * Create an animate image command handler
 * 
 * @param {Object} dependencies - Command dependencies
 * @returns {Object} Command handler
 */
function createAnimateCommand(dependencies) {
  return {
    name: 'animate',
    description: 'Animate a still image',
    aliases: ['motion'],
    category: 'media',
    usage: '/animate [prompt] - Upload an image to animate it based on your prompt',
    execute: async (input) => {
      return mediaCommandHandler({
        ...input,
        ...dependencies,
        operationType: 'animate'
      });
    },
    processWebhook: processMediaWebhook
  };
}

/**
 * Create a video generation command handler
 * 
 * @param {Object} dependencies - Command dependencies
 * @returns {Object} Command handler
 */
function createVideoCommand(dependencies) {
  return {
    name: 'video',
    description: 'Generate a video from a prompt',
    aliases: ['vid'],
    category: 'media',
    usage: '/video [prompt] - Generate a video from a text description',
    execute: async (input) => {
      return mediaCommandHandler({
        ...input,
        ...dependencies,
        operationType: 'video'
      });
    },
    processWebhook: processMediaWebhook
  };
}

/**
 * Register media commands with the command registry
 * 
 * @param {Object} registry - Command registry to register with
 * @param {Object} dependencies - Dependencies to inject into commands
 */
function registerMediaCommands(registry, dependencies) {
  if (!registry) {
    throw new AppError('Command registry is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'REGISTRY_REQUIRED'
    });
  }
  
  // Create and register all media commands
  registry.register(createImageToImageCommand(dependencies));
  registry.register(createRemoveBackgroundCommand(dependencies));
  registry.register(createUpscaleCommand(dependencies));
  registry.register(createAnalyzeImageCommand(dependencies));
  registry.register(createAnimateCommand(dependencies));
  registry.register(createVideoCommand(dependencies));
}

module.exports = {
  createImageToImageCommand,
  createRemoveBackgroundCommand,
  createUpscaleCommand,
  createAnalyzeImageCommand,
  createAnimateCommand,
  createVideoCommand,
  registerMediaCommands,
  processMediaWebhook
}; 