/**
 * Media Operation Workflow
 * 
 * Provides a workflow implementation for media operations like
 * image-to-image, background removal, upscaling, etc.
 */

const { v4: uuidv4 } = require('uuid');
const { AppError, ERROR_SEVERITY } = require('../../shared/errors');
const { createWorkflow, WorkflowStep } = require('../');

/**
 * Create a media operation workflow
 * 
 * @param {Object} options - Workflow configuration options
 * @param {Object} options.mediaService - Media service instance
 * @param {Object} options.pointsService - Points service instance
 * @param {Object} options.analyticsService - Analytics service for tracking
 * @param {Object} options.deliveryAdapter - Adapter for delivering results
 * @returns {Object} Workflow definition
 */
function createMediaOperationWorkflow(options = {}) {
  const {
    mediaService,
    pointsService,
    analyticsService,
    deliveryAdapter
  } = options;
  
  // Validate required dependencies
  if (!mediaService) {
    throw new AppError('Media service is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MEDIA_SERVICE_REQUIRED'
    });
  }

  // Define workflow steps
  const steps = {
    // Initial selection step
    'operation_select': {
      id: 'operation_select',
      name: 'Select Operation',
      description: 'Select the media operation to perform',
      validate: (input) => {
        const validOperations = [
          'image-to-image', 
          'background-removal', 
          'upscale', 
          'interrogate', 
          'animate', 
          'video'
        ];
        
        const valid = validOperations.includes(input);
        return {
          valid,
          errors: valid ? [] : ['Please select a valid operation']
        };
      },
      process: (input, workflow) => {
        // Store the selected operation type
        workflow.context.operationType = input;
        
        // Track selection
        if (analyticsService) {
          analyticsService.trackEvent('workflow:media:operation_selected', {
            userId: workflow.context.userId,
            platform: workflow.context.platform,
            operationType: input
          });
        }
        
        // Determine next step based on operation type
        switch (input) {
          case 'image-to-image':
          case 'animate':
            return {
              nextStep: 'prompt_input'
            };
          case 'background-removal':
          case 'upscale':
          case 'interrogate':
            return {
              nextStep: 'image_input'
            };
          case 'video':
            return {
              nextStep: 'prompt_input'
            };
          default:
            return {
              nextStep: 'operation_select',
              error: 'Invalid operation selected'
            };
        }
      },
      ui: {
        type: 'options',
        message: 'Select a media operation:',
        options: [
          { id: 'image-to-image', label: 'Image-to-Image' },
          { id: 'background-removal', label: 'Remove Background' },
          { id: 'upscale', label: 'Upscale Image' },
          { id: 'interrogate', label: 'Analyze Image' },
          { id: 'animate', label: 'Animate Image' },
          { id: 'video', label: 'Generate Video' }
        ]
      }
    },
    
    // Prompt input step (for operations that need a text prompt)
    'prompt_input': {
      id: 'prompt_input',
      name: 'Enter Prompt',
      description: 'Enter the prompt for the operation',
      validate: (input) => {
        const valid = input && input.length > 0 && input.length <= 500;
        return {
          valid,
          errors: !valid ? ['Please enter a valid prompt (1-500 characters)'] : []
        };
      },
      process: (input, workflow) => {
        // Store the prompt
        workflow.context.prompt = input;
        
        // Determine next step based on operation type
        switch (workflow.context.operationType) {
          case 'image-to-image':
          case 'animate':
            return {
              nextStep: 'image_input'
            };
          case 'video':
            return {
              nextStep: 'settings'
            };
          default:
            return {
              nextStep: 'prompt_input',
              error: 'Invalid operation for prompt'
            };
        }
      },
      ui: {
        type: 'text_input',
        message: 'Enter your prompt:',
        placeholder: 'Describe what you want to create...'
      }
    },
    
    // Image input step (for operations that need an image)
    'image_input': {
      id: 'image_input',
      name: 'Upload Image',
      description: 'Upload or provide a URL to the image',
      validate: (input) => {
        // Simple URL validation - production would have more robust validation
        const validUrl = input && (
          input.startsWith('http://') || 
          input.startsWith('https://') || 
          input.startsWith('data:image/')
        );
        
        return {
          valid: validUrl,
          errors: !validUrl ? ['Please provide a valid image URL'] : []
        };
      },
      process: (input, workflow) => {
        // Store the image URL
        workflow.context.imageUrl = input;
        
        return {
          nextStep: 'settings'
        };
      },
      ui: {
        type: 'image_input',
        message: 'Upload an image or provide a URL:',
        accept: 'image/*'
      }
    },
    
    // Settings step (for customizing operation parameters)
    'settings': {
      id: 'settings',
      name: 'Adjust Settings',
      description: 'Configure settings for the operation',
      validate: (input) => {
        // Accept any valid JSON object or empty for defaults
        try {
          if (input && typeof input === 'string') {
            JSON.parse(input);
          }
          return { valid: true, errors: [] };
        } catch (error) {
          return { 
            valid: false, 
            errors: ['Invalid settings format. Please provide valid JSON or leave empty for defaults.'] 
          };
        }
      },
      process: (input, workflow) => {
        // Parse settings or use empty object for defaults
        workflow.context.settings = input ? 
          (typeof input === 'string' ? JSON.parse(input) : input) : 
          {};
        
        return {
          nextStep: 'confirmation'
        };
      },
      ui: {
        type: 'settings_form',
        message: 'Adjust settings (optional):',
        defaultSettings: {} // Would be populated based on operation type
      }
    },
    
    // Confirmation step
    'confirmation': {
      id: 'confirmation',
      name: 'Confirm Operation',
      description: 'Review and confirm the operation',
      validate: (input) => {
        return {
          valid: input === 'confirm',
          errors: input !== 'confirm' ? ['Please confirm to proceed'] : []
        };
      },
      process: async (input, workflow) => {
        const { userId, operationType, prompt, imageUrl, settings } = workflow.context;
        
        try {
          // Check if user has sufficient points if points service is available
          if (pointsService) {
            const operationCost = await mediaService.getOperationCost(operationType);
            
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
            
            // Allocate points for this operation
            workflow.context.taskId = uuidv4();
            await pointsService.allocatePoints({
              userId: userId,
              points: operationCost,
              operationType: operationType,
              operationId: workflow.context.taskId
            });
          }
          
          // Process the operation based on type
          let result;
          const params = {
            userId,
            settings,
            callbackUrl: workflow.context.callbackUrl
          };
          
          // Add operation-specific parameters
          if (prompt) params.prompt = prompt;
          if (imageUrl) params.imageUrl = imageUrl;
          
          switch (operationType) {
            case 'image-to-image':
              result = await mediaService.processImageToImage(params);
              break;
              
            case 'background-removal':
              result = await mediaService.removeBackground(params);
              break;
              
            case 'upscale':
              result = await mediaService.upscaleImage(params);
              break;
              
            case 'interrogate':
              result = await mediaService.interrogateImage(params);
              break;
              
            case 'animate':
              result = await mediaService.animateImage(params);
              break;
              
            case 'video':
              result = await mediaService.generateVideo(params);
              break;
              
            default:
              throw new AppError(`Unknown operation type: ${operationType}`, {
                severity: ERROR_SEVERITY.ERROR,
                code: 'UNKNOWN_OPERATION_TYPE',
                userFacing: true
              });
          }
          
          // Store the result in workflow context
          workflow.context.result = {
            taskId: result.taskId,
            runId: result.run_id,
            status: result.status
          };
          
          // Track operation started
          if (analyticsService) {
            analyticsService.trackEvent('workflow:media:operation_started', {
              userId: workflow.context.userId,
              platform: workflow.context.platform,
              operationType: operationType,
              taskId: result.taskId
            });
          }
          
          return {
            nextStep: 'processing'
          };
        } catch (error) {
          console.error(`Error processing ${operationType} operation:`, error);
          
          // Track error
          if (analyticsService) {
            analyticsService.trackEvent('workflow:media:operation_error', {
              userId: workflow.context.userId,
              platform: workflow.context.platform,
              operationType: operationType,
              error: error.message,
              code: error.code
            });
          }
          
          // Deliver error message if adapter is available
          if (deliveryAdapter) {
            await deliveryAdapter.deliverErrorMessage({
              userId: workflow.context.userId,
              error,
              platformContext: workflow.context.platformContext
            });
          }
          
          throw new AppError(`Failed to process ${operationType} operation`, {
            severity: ERROR_SEVERITY.ERROR,
            code: 'MEDIA_OPERATION_FAILED',
            cause: error,
            userFacing: true
          });
        }
      },
      ui: {
        type: 'confirmation',
        message: 'Ready to process your request?',
        options: [
          { id: 'confirm', label: 'Confirm' },
          { id: 'cancel', label: 'Cancel' }
        ]
      }
    },
    
    // Processing step
    'processing': {
      id: 'processing',
      name: 'Processing Media',
      description: 'Operation is being processed',
      // This is a terminal state that waits for webhook callback
      process: async (input, workflow) => {
        return {
          nextStep: null, // Terminal state
          completed: false // Still waiting for completion via webhook
        };
      },
      ui: {
        type: 'status',
        message: 'Processing your request...',
        status: 'processing'
      }
    },
    
    // Results step
    'results': {
      id: 'results',
      name: 'Operation Results',
      description: 'View the results of the operation',
      // Terminal state that shows results
      process: (input, workflow) => {
        return {
          nextStep: null, // Terminal state
          completed: true
        };
      },
      ui: {
        type: 'result',
        message: 'Operation completed successfully!'
      }
    }
  };
  
  // Create and return the workflow
  return createWorkflow({
    name: 'MediaOperationWorkflow',
    steps,
    initialStep: 'operation_select'
  });
}

/**
 * Resume a workflow with webhook data
 * 
 * @param {Object} serializedWorkflow - Serialized workflow state
 * @param {Object} webhookPayload - Webhook data from media service
 * @returns {Promise<Object>} Updated workflow state
 */
async function resumeWorkflowWithWebhook(serializedWorkflow, webhookPayload) {
  // Recreate the workflow
  const workflow = createMediaOperationWorkflow({
    // These services aren't needed for resumption but should be passed if available
    mediaService: serializedWorkflow.context._services?.mediaService,
    pointsService: serializedWorkflow.context._services?.pointsService,
    analyticsService: serializedWorkflow.context._services?.analyticsService,
    deliveryAdapter: serializedWorkflow.context._services?.deliveryAdapter
  });
  
  // Deserialize the workflow state
  const workflowState = workflow.deserialize(serializedWorkflow);
  
  // Update the workflow context with webhook result
  workflowState.context.webhookResult = webhookPayload;
  
  // Process webhook based on status
  if (webhookPayload.status === 'success') {
    // Finalize points if available
    const pointsService = workflowState.context._services?.pointsService;
    if (pointsService && workflowState.context.taskId) {
      await pointsService.finalizePoints({
        operationId: workflowState.context.taskId
      });
    }
    
    // Deliver media if adapter is available
    const deliveryAdapter = workflowState.context._services?.deliveryAdapter;
    if (deliveryAdapter) {
      await deliveryAdapter.deliverMedia({
        userId: workflowState.context.userId,
        mediaType: getMediaTypeForOperation(workflowState.context.operationType),
        media: webhookPayload.outputs?.[0] || webhookPayload.result,
        context: {
          prompt: workflowState.context.prompt,
          settings: workflowState.context.settings,
          operationType: workflowState.context.operationType
        },
        platformContext: workflowState.context.platformContext
      });
    }
    
    // Track completion
    const analyticsService = workflowState.context._services?.analyticsService;
    if (analyticsService) {
      analyticsService.trackEvent('workflow:media:operation_completed', {
        userId: workflowState.context.userId,
        platform: workflowState.context.platform,
        operationType: workflowState.context.operationType,
        taskId: workflowState.context.taskId
      });
    }
    
    // Move to results step
    return workflowState.jumpToStep('results');
  } else {
    // Handle failure
    const error = new AppError(webhookPayload.error || 'Operation failed', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'OPERATION_FAILED',
      userFacing: true
    });
    
    // Refund points if available
    const pointsService = workflowState.context._services?.pointsService;
    if (pointsService && workflowState.context.taskId) {
      await pointsService.refundPoints({
        operationId: workflowState.context.taskId
      });
    }
    
    // Deliver error if adapter is available
    const deliveryAdapter = workflowState.context._services?.deliveryAdapter;
    if (deliveryAdapter) {
      await deliveryAdapter.deliverErrorMessage({
        userId: workflowState.context.userId,
        error,
        platformContext: workflowState.context.platformContext
      });
    }
    
    // Track failure
    const analyticsService = workflowState.context._services?.analyticsService;
    if (analyticsService) {
      analyticsService.trackEvent('workflow:media:operation_failed', {
        userId: workflowState.context.userId,
        platform: workflowState.context.platform,
        operationType: workflowState.context.operationType,
        taskId: workflowState.context.taskId,
        error: error.message
      });
    }
    
    // Throw error to be handled by the calling code
    throw error;
  }
}

/**
 * Get media type for operation
 * @private
 * @param {string} operationType - Type of operation
 * @returns {string} Media type
 */
function getMediaTypeForOperation(operationType) {
  switch (operationType) {
    case 'video':
      return 'video';
    case 'animate':
      return 'animation';
    default:
      return 'image';
  }
}

module.exports = {
  createMediaOperationWorkflow,
  resumeWorkflowWithWebhook
}; 