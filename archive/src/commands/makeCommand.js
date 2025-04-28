/**
 * MakeCommand
 * 
 * Platform-agnostic implementation of the /make command
 * that triggers the MakeImageWorkflow for image generation.
 * 
 * This command provides a clean interface for starting the image generation
 * workflow from any platform (Telegram, Web UI, etc.) without coupling
 * to platform-specific implementations.
 */

const { AppError, ERROR_SEVERITY } = require('../core/shared/errors');
const { createMakeImageWorkflow } = require('../core/workflow/workflows/MakeImageWorkflow');
const { v4: uuidv4 } = require('uuid');

/**
 * Handler for the /make command
 * @param {Object} context - Command execution context
 * @returns {Promise<Object>} Command execution result
 */
async function makeCommandHandler(context) {
  const {
    userId,
    platform,
    sessionManager,
    uiManager,
    comfyDeployService,
    pointsService,
    analyticsService,
    workflowEngine,
    parameters = {},
    messageContext = {}
  } = context;

  if (!userId) {
    throw new AppError('User ID is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_USER_ID',
      userFacing: true
    });
  }

  if (!uiManager) {
    throw new AppError('UI Manager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_UI_MANAGER'
    });
  }

  try {
    // Track command usage
    analyticsService?.trackEvent('command:make:initiated', {
      userId,
      platform,
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
          lastCommand: 'make'
        });
      }
    }

    // Prepare the workflow options
    const workflowOptions = {
      comfyDeployService,
      pointsService,
      // Create simple delivery adapter based on platform
      deliveryAdapter: createPlatformDeliveryAdapter(platform, uiManager, messageContext),
      analyticsService
    };

    // Get generationType from parameters if provided
    if (parameters.generationType) {
      workflowOptions.generationType = parameters.generationType;
    }

    // Get initial settings from parameters if provided
    if (parameters.settings) {
      workflowOptions.defaultSettings = {
        ...workflowOptions.defaultSettings,
        ...parameters.settings
      };
    }

    // Create the workflow instance
    const workflow = createMakeImageWorkflow(workflowOptions);

    // Initialize the workflow state with user context
    const initialState = {
      userId,
      platform,
      username: messageContext.username || userSession?.get('username'),
      chatId: messageContext.chatId,
      threadId: messageContext.threadId,
      locale: messageContext.locale || userSession?.get('locale') || 'en',
      balance: userSession?.get('points')?.balance,
      workflowId: uuidv4(),
      startedAt: Date.now()
    };

    // Start the workflow using the WorkflowEngine if available
    if (workflowEngine) {
      const startedWorkflow = await workflowEngine.startWorkflow('MakeImageWorkflow', initialState, workflow);
      
      // Return information about the started workflow
      return {
        success: true,
        message: 'Image generation workflow started',
        workflowId: startedWorkflow.id,
        initialStep: startedWorkflow.currentStep
      };
    }

    // Fallback to manual workflow initialization if no WorkflowEngine
    const workflowInstance = workflow.createWorkflow({
      context: initialState
    });

    // Render the first step UI using the UIManager
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
      message: 'Image generation workflow started',
      workflowId: workflowInstance.id,
      uiRendered: !!renderResult,
      initialStep: currentStep.id
    };
  } catch (error) {
    // Track error
    analyticsService?.trackEvent('command:make:error', {
      userId,
      platform,
      error: error.message,
      code: error.code,
      timestamp: Date.now()
    });

    // Handle error based on severity
    if (error.severity === ERROR_SEVERITY.WARNING) {
      // For warnings, return a user-friendly error
      return {
        success: false,
        message: error.userFacing ? error.message : 'Could not start image generation',
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
          generationType: context.generationType
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
    
    deliverErrorMessage: async ({ userId, error, context, platformContext }) => {
      try {
        // Create an error component
        const component = uiManager.createComponent('error', {
          message: error.message || String(error),
          code: error.code,
          details: error.details
        });
        
        // Render the component on the specified platform
        const renderContext = {
          chatId: messageContext.chatId || platformContext?.chatId,
          threadId: messageContext.threadId || platformContext?.threadId,
          userId
        };
        
        const result = await uiManager.render(component, {}, platform, renderContext);
        
        return {
          id: `error-${Date.now()}`,
          success: true,
          renderResult: result
        };
      } catch (renderError) {
        console.error('Error delivering error message:', renderError);
        
        // Return minimal success to avoid breaking the workflow
        return {
          id: `error-${Date.now()}`,
          success: false,
          error: renderError.message
        };
      }
    },
    
    deliverStatusUpdate: async ({ userId, status, progress, platformContext }) => {
      try {
        // Create a status component
        const component = uiManager.createComponent('status', {
          status,
          progress,
          message: getStatusMessage(status, progress)
        });
        
        // Render the component on the specified platform
        const renderContext = {
          chatId: messageContext.chatId || platformContext?.chatId,
          threadId: messageContext.threadId || platformContext?.threadId,
          userId,
          messageId: platformContext?.messageId
        };
        
        const result = await uiManager.render(component, {}, platform, renderContext);
        
        return {
          id: `status-${Date.now()}`,
          success: true,
          renderResult: result
        };
      } catch (renderError) {
        console.error('Error delivering status update:', renderError);
        
        // Return minimal success to avoid breaking the workflow
        return {
          id: `status-${Date.now()}`,
          success: false,
          error: renderError.message
        };
      }
    }
  };
}

/**
 * Get a status message based on status and progress
 * @private
 * @param {string} status - Current status
 * @param {number} progress - Progress percentage
 * @returns {string} Status message
 */
function getStatusMessage(status, progress) {
  switch (status) {
    case 'queued':
      return 'Your image is queued for generation...';
    case 'processing':
      return `Generating your image... ${Math.round(progress)}% complete`;
    case 'completed':
      return 'Your image has been generated!';
    case 'failed':
      return 'Sorry, there was an error generating your image.';
    default:
      return 'Processing your request...';
  }
}

/**
 * Render a step UI using the UI manager
 * @private
 * @param {Object} uiManager - UI Manager instance
 * @param {string} platform - Platform identifier
 * @param {Object} uiDefinition - UI definition from workflow step
 * @param {Object} context - Rendering context
 * @returns {Promise<Object>} Render result
 */
async function renderStepUI(uiManager, platform, uiDefinition, context) {
  try {
    // Create a component based on UI definition
    const component = uiManager.createComponent(uiDefinition.type, {
      title: uiDefinition.title,
      message: uiDefinition.message,
      ...uiDefinition
    });
    
    // Render the component on the specified platform
    return await uiManager.render(component, {}, platform, context);
  } catch (error) {
    console.error('Error rendering step UI:', error);
    return null;
  }
}

/**
 * Register the make command with the CommandRegistry
 * @param {Object} commandRegistry - Command registry instance
 */
function registerMakeCommand(commandRegistry) {
  if (!commandRegistry) return;
  
  commandRegistry.register({
    name: 'make',
    description: 'Generate an AI image using text-to-image model',
    category: 'generation',
    execute: makeCommandHandler,
    metadata: {
      aliases: ['generate', 'create'],
      requiresAuth: true,
      examples: [
        '/make a beautiful sunset over mountains',
        '/make cyberpunk city with neon lights'
      ],
      parameters: {
        generationType: {
          type: 'string',
          description: 'Type of generation to perform',
          enum: ['DEFAULT', 'FLUX', 'ANIME', 'REALISTIC'],
          default: 'DEFAULT'
        },
        settings: {
          type: 'object',
          description: 'Generation settings',
          properties: {
            width: { type: 'number', minimum: 256, maximum: 2048 },
            height: { type: 'number', minimum: 256, maximum: 2048 },
            steps: { type: 'number', minimum: 10, maximum: 150 },
            seed: { type: 'number', default: -1 }
          }
        }
      }
    }
  });
}

/**
 * Create a make command instance
 * @param {Object} dependencies - Dependencies for the command
 * @returns {Object} Command object
 */
function createMakeCommand(dependencies) {
  const {
    pointsService,
    comfyDeployService,
    deliveryAdapter,
    sessionManager,
    uiManager,
    analyticsService,
    eventBus,
    workflowEngine
  } = dependencies;
  
  // Command implementation
  return {
    name: 'make',
    description: 'Generate an image using AI',
    usage: '/make [prompt]',
    
    /**
     * Execute the command
     * @param {Object} input - Command input
     * @returns {Promise<Object>} Command execution result
     */
    execute: async (input) => {
      const { command, args, context } = input;
      
      try {
        // Track command execution
        analyticsService?.trackEvent('command:make:executed', {
          userId: context.userId,
          platform: context.platform,
          timestamp: Date.now()
        });
        
        eventBus?.emit('command:executed', {
          command,
          userId: context.userId,
          timestamp: Date.now()
        });
        
        // Extract prompt from arguments
        const prompt = args && args.length > 0 ? args.join(' ') : null;
        
        // Prepare handler context
        const handlerContext = {
          userId: context.userId,
          platform: context.platform,
          sessionManager,
          uiManager,
          comfyDeployService,
          pointsService,
          analyticsService,
          workflowEngine,
          deliveryAdapter,
          messageContext: context.platformContext || {},
          parameters: {
            prompt
          }
        };
        
        // Call the command handler
        const result = await makeCommandHandler(handlerContext);
        
        return {
          success: true,
          ...result
        };
      } catch (error) {
        // Log the error
        console.error('Error executing make command:', error);
        
        // Track error event
        analyticsService?.trackEvent('command:make:error', {
          userId: context.userId,
          platform: context.platform,
          error: error.message,
          code: error.code,
          timestamp: Date.now()
        });
        
        // Deliver error message if possible
        try {
          if (uiManager && deliveryAdapter) {
            await deliveryAdapter.deliverErrorMessage({
              userId: context.userId,
              error,
              platformContext: context.platformContext
            });
          }
        } catch (deliveryError) {
          console.error('Failed to deliver error message:', deliveryError);
        }
        
        // Return error result
        return {
          success: false,
          error: {
            message: error.message,
            code: error.code || 'COMMAND_EXECUTION_FAILED'
          }
        };
      }
    },
    
    /**
     * Handle webhook event for this command
     * @param {Object} options - Webhook options
     * @returns {Promise<Object>} Webhook handling result
     */
    handleWebhook: async (options) => {
      const { payload, userId, workflowId } = options;
      
      try {
        // Get the user's session
        const userSession = await sessionManager.getSession(userId);
        
        if (!userSession) {
          throw new AppError(`Session not found for user ${userId}`, {
            severity: ERROR_SEVERITY.WARNING,
            code: 'SESSION_NOT_FOUND'
          });
        }
        
        // Get the workflow state from the session
        const workflows = userSession.data.workflows || {};
        const workflowState = workflows[workflowId];
        
        if (!workflowState) {
          throw new AppError(`Workflow ${workflowId} not found for user ${userId}`, {
            severity: ERROR_SEVERITY.WARNING,
            code: 'WORKFLOW_NOT_FOUND'
          });
        }
        
        // Create the workflow instance
        const workflow = createMakeImageWorkflow({
          comfyDeployService,
          pointsService,
          deliveryAdapter,
          analyticsService
        });
        
        // Restore the workflow state
        const workflowInstance = workflow.createWorkflow(workflowState.context);
        Object.assign(workflowInstance, workflowState);
        
        // Resume the workflow with the webhook payload
        const resumedWorkflow = await resumeWorkflowWithWebhook(workflowInstance, payload);
        
        // Update the workflow in the session
        await sessionManager.updateSession(userId, {
          workflows: {
            [workflowId]: resumedWorkflow.serialize()
          }
        });
        
        // Track webhook processing
        analyticsService?.trackEvent('command:make:webhook', {
          userId,
          workflowId,
          status: payload.status,
          timestamp: Date.now()
        });
        
        return {
          success: true,
          message: 'Webhook processed successfully',
          workflowId,
          currentStep: resumedWorkflow.getCurrentStepId()
        };
      } catch (error) {
        // Log the error
        console.error('Error processing webhook:', error);
        
        // Track error
        analyticsService?.trackEvent('command:make:webhook_error', {
          userId,
          workflowId,
          error: error.message,
          code: error.code,
          timestamp: Date.now()
        });
        
        return {
          success: false,
          error: {
            message: error.message,
            code: error.code || 'WEBHOOK_PROCESSING_FAILED'
          }
        };
      }
    },
    
    /**
     * Check timeouts for pending operations
     * @param {Object} context - Timeout check context
     * @returns {Promise<Object>} Timeout check result
     */
    checkTimeouts: async (context) => {
      const { userId, workflowId, taskId, runId, lastChecked } = context;
      
      try {
        // Check if the task has timed out (15 minutes with no updates)
        const now = Date.now();
        const timeoutThreshold = 15 * 60 * 1000; // 15 minutes
        
        if (now - lastChecked < timeoutThreshold) {
          return {
            success: true,
            timedOut: false,
            message: 'Task is still within timeout threshold'
          };
        }
        
        // Get the current status from ComfyDeploy
        const status = await comfyDeployService.checkStatus(runId, {
          taskId,
          userId
        });
        
        // If the task is still processing, update the last checked time
        if (!status.isComplete && status.status === 'processing') {
          return {
            success: true,
            timedOut: false,
            message: 'Task is still processing',
            status: status.status,
            progress: status.progress
          };
        }
        
        // If the task has completed successfully, nothing to do
        if (status.isComplete && status.status === 'completed') {
          return {
            success: true,
            timedOut: false,
            message: 'Task completed successfully',
            status: status.status
          };
        }
        
        // Task has timed out or failed
        // Refund points if allocatePoints was called
        await pointsService.refundPoints({
          operationId: taskId,
          reason: 'timeout',
          userId
        });
        
        // Get the user's session
        const userSession = await sessionManager.getSession(userId);
        
        if (userSession) {
          // Get the workflow state from the session
          const workflows = userSession.data.workflows || {};
          const workflowState = workflows[workflowId];
          
          if (workflowState) {
            // Create the workflow instance
            const workflow = createMakeImageWorkflow({
              comfyDeployService,
              pointsService,
              deliveryAdapter,
              analyticsService
            });
            
            // Restore the workflow state
            const workflowInstance = workflow.createWorkflow(workflowState.context);
            Object.assign(workflowInstance, workflowState);
            
            // Move to failure step with timeout error
            const errorInput = {
              type: 'error',
              error: 'Generation timed out after waiting too long'
            };
            
            const updatedWorkflow = await workflowInstance.processInput(errorInput);
            
            // Update the workflow in the session
            await sessionManager.updateSession(userId, {
              workflows: {
                [workflowId]: updatedWorkflow.serialize()
              }
            });
            
            // Deliver error message
            await deliveryAdapter.deliverErrorMessage({
              userId,
              error: {
                message: 'Your image generation timed out. Points have been refunded.',
                code: 'GENERATION_TIMEOUT'
              },
              platformContext: workflowState.context.platformContext
            });
          }
        }
        
        // Track timeout
        analyticsService?.trackEvent('command:make:timeout', {
          userId,
          workflowId,
          taskId,
          runId,
          timestamp: Date.now()
        });
        
        return {
          success: true,
          timedOut: true,
          message: 'Task timed out and has been cancelled',
          status: 'timeout'
        };
      } catch (error) {
        // Log the error
        console.error('Error checking timeouts:', error);
        
        return {
          success: false,
          error: {
            message: error.message,
            code: error.code || 'TIMEOUT_CHECK_FAILED'
          }
        };
      }
    }
  };
}

// Export the command handler and factory function
module.exports = {
  makeCommandHandler,
  createMakeCommand
}; 