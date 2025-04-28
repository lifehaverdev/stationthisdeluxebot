/**
 * MakeImageWorkflow
 * 
 * A platform-agnostic workflow for generating images using ComfyDeployService.
 * This workflow demonstrates a clean separation of concerns between:
 * - User interaction (prompt collection, settings)
 * - Business logic (generation request, status tracking)
 * - Result handling (image delivery)
 * - Points management
 * 
 * Used as a reference implementation for other generation workflows.
 */

const { WorkflowSequence, WorkflowBuilder } = require('../sequence');
const { AppError, ERROR_SEVERITY } = require('../../shared/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new MakeImageWorkflow
 * @param {Object} options - Workflow configuration options
 * @returns {WorkflowSequence} - The configured workflow sequence
 */
function createMakeImageWorkflow(options = {}) {
  const {
    // Required services
    comfyDeployService,
    
    // Optional services (can be stubbed initially)
    pointsService = createPointsServiceStub(),
    deliveryAdapter = createDeliveryAdapterStub(),
    validationService,
    analyticsService,
    
    // Configuration
    generationType = 'FLUX',
    defaultSettings = {
      width: 1024,
      height: 1024,
      steps: 30,
      seed: -1,
      batch: 1
    },
    pollingInterval = 3000
  } = options;
  
  // Validate required dependencies
  if (!comfyDeployService) {
    throw new AppError('ComfyDeployService is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_DEPENDENCY'
    });
  }
  
  return new WorkflowSequence({
    name: 'MakeImageWorkflow',
    initialStep: 'collectPrompt',
    metadata: {
      version: '1.0.0',
      generationType,
      defaultSettings
    },
    
    steps: {
      /**
       * Step 1: Collect user prompt for image generation
       */
      'collectPrompt': {
        id: 'collectPrompt',
        name: 'Collect Prompt',
        description: 'Collect the prompt for image generation',
        
        // Validate prompt input
        validate: (input) => {
          // Basic validation
          if (!input || typeof input !== 'string' || input.trim().length < 3) {
            throw new AppError('Please enter a more detailed prompt (at least 3 characters).', {
              severity: ERROR_SEVERITY.WARNING,
              code: 'INVALID_PROMPT',
              userFacing: true
            });
          }
          
          // Additional validation if validation service is available
          if (validationService) {
            const validationResult = validationService.validatePrompt(input);
            if (!validationResult.valid) {
              throw new AppError(validationResult.message || 'Invalid prompt', {
                severity: ERROR_SEVERITY.WARNING,
                code: 'VALIDATION_FAILED',
                details: validationResult.details,
                userFacing: true
              });
            }
          }
          
          return true;
        },
        
        // Process prompt input
        process: async (input, state) => {
          // Track analytics if available
          analyticsService?.trackEvent('workflow:prompt_collected', {
            workflowId: state.id,
            prompt: input,
            timestamp: Date.now()
          });
          
          // Return updated state with prompt
          return {
            ...state,
            data: {
              ...state.data,
              prompt: input.trim()
            }
          };
        },
        
        // UI rendering info (platform-agnostic)
        ui: {
          type: 'text_input',
          title: 'Image Generation',
          message: 'What would you like to generate?',
          placeholder: 'Enter a detailed description of your image...',
          required: true
        },
        
        // Next step
        nextStep: 'configureSettings'
      },
      
      /**
       * Step 2: Configure generation settings
       */
      'configureSettings': {
        id: 'configureSettings',
        name: 'Configure Settings',
        description: 'Adjust generation settings',
        
        // No special validation needed for settings
        validate: () => true,
        
        // Process settings input
        process: async (input, state) => {
          // Get default or previously configured settings
          const currentSettings = state.data.settings || defaultSettings;
          
          // Merge input settings with defaults (or use existing if input is null/empty)
          const settings = (input && typeof input === 'object')
            ? { ...currentSettings, ...input }
            : currentSettings;
          
          // Calculate cost if points service is available
          let cost = 100; // Default cost
          
          if (pointsService) {
            try {
              cost = pointsService.calculateCost({
                type: generationType,
                settings
              });
            } catch (error) {
              console.warn('Error calculating point cost:', error);
            }
          }
          
          // Track analytics if available
          analyticsService?.trackEvent('workflow:settings_configured', {
            workflowId: state.id,
            settings,
            timestamp: Date.now()
          });
          
          // Return updated state with settings and cost
          return {
            ...state,
            data: {
              ...state.data,
              settings,
              cost
            }
          };
        },
        
        // UI rendering info (platform-agnostic)
        ui: {
          type: 'form',
          title: 'Generation Settings',
          message: 'Adjust your image settings or continue with defaults',
          fields: [
            {
              id: 'width',
              label: 'Width',
              type: 'number',
              default: defaultSettings.width,
              min: 256,
              max: 2048
            },
            {
              id: 'height',
              label: 'Height',
              type: 'number',
              default: defaultSettings.height,
              min: 256,
              max: 2048
            },
            {
              id: 'seed',
              label: 'Seed (-1 for random)',
              type: 'number',
              default: defaultSettings.seed
            },
            {
              id: 'steps',
              label: 'Steps',
              type: 'number',
              default: defaultSettings.steps,
              min: 10,
              max: 150
            }
          ],
          optional: true
        },
        
        // Next step
        nextStep: 'confirmGeneration'
      },
      
      /**
       * Step 3: Confirm generation and check points
       */
      'confirmGeneration': {
        id: 'confirmGeneration',
        name: 'Confirm Generation',
        description: 'Confirm image generation and check points',
        
        // Validate points balance
        validate: async (input, state) => {
          // Skip validation if user is cancelling
          if (input === false) return true;
          
          const userId = state.context.userId;
          const cost = state.data.cost || 100;
          
          // Check points balance if service is available
          if (pointsService) {
            try {
              const hasSufficientPoints = await pointsService.hasSufficientPoints(
                userId,
                cost
              );
              
              if (!hasSufficientPoints) {
                throw new AppError(`Insufficient points for generation. Cost: ${cost} points`, {
                  severity: ERROR_SEVERITY.WARNING,
                  code: 'INSUFFICIENT_POINTS',
                  userFacing: true,
                  details: { cost, userId }
                });
              }
            } catch (error) {
              if (error.code !== 'INSUFFICIENT_POINTS') {
                console.error('Error checking points balance:', error);
              }
              throw error;
            }
          }
          
          return true;
        },
        
        // Process confirmation and generate image
        process: async (input, state) => {
          // If user cancelled, exit workflow
          if (input === false) {
            return {
              ...state,
              data: {
                ...state.data,
                cancelled: true
              }
            };
          }
          
          const userId = state.context.userId;
          const prompt = state.data.prompt;
          const settings = state.data.settings || defaultSettings;
          
          try {
            // Prepare user context for ComfyDeployService
            const userContext = {
              userId,
              username: state.context.username || '',
              balance: state.context.balance || 0
            };
            
            // Create generation request
            const generationResult = await comfyDeployService.generate(
              {
                userId,
                type: generationType,
                prompt,
                settings
              },
              userContext,
              {
                taskId: uuidv4(),
                webhookData: {
                  workflowId: state.id,
                  source: 'MakeImageWorkflow'
                }
              }
            );
            
            // Track analytics if available
            analyticsService?.trackEvent('workflow:generation_started', {
              workflowId: state.id,
              userId,
              taskId: generationResult.taskId,
              runId: generationResult.runId,
              prompt,
              settings,
              timestamp: Date.now()
            });
            
            // Tentatively allocate points if service is available
            if (pointsService) {
              try {
                await pointsService.allocatePoints(
                  userId,
                  state.data.cost || 100,
                  {
                    source: 'image_generation',
                    taskId: generationResult.taskId,
                    prompt,
                    type: generationType
                  }
                );
              } catch (error) {
                console.warn('Error allocating points:', error);
                // Continue with generation even if points allocation fails
              }
            }
            
            // Return updated state with generation info
            return {
              ...state,
              data: {
                ...state.data,
                taskId: generationResult.taskId,
                runId: generationResult.runId,
                startedAt: Date.now(),
                status: 'processing'
              }
            };
          } catch (error) {
            // Track failed generation
            analyticsService?.trackEvent('workflow:generation_failed', {
              workflowId: state.id,
              userId,
              error: error.message || 'Unknown error',
              timestamp: Date.now()
            });
            
            throw new AppError('Failed to start image generation', {
              severity: ERROR_SEVERITY.ERROR,
              code: 'GENERATION_FAILED',
              userFacing: true,
              cause: error
            });
          }
        },
        
        // UI rendering info (platform-agnostic)
        ui: {
          type: 'confirm',
          title: 'Generate Image',
          message: 'Ready to generate your image?',
          prompt: '{{prompt}}',
          details: [
            { label: 'Size', value: '{{settings.width}}×{{settings.height}}' },
            { label: 'Cost', value: '{{cost}} points' }
          ],
          confirmLabel: 'Generate',
          cancelLabel: 'Cancel'
        },
        
        // Next step
        nextStep: 'waitForResult'
      },
      
      /**
       * Step 4: Wait for generation result
       */
      'waitForResult': {
        id: 'waitForResult',
        name: 'Wait for Result',
        description: 'Wait for image generation to complete',
        
        // No validation needed for waiting
        validate: () => true,
        
        // Process status updates or polling
        process: async (input, state) => {
          const runId = state.data.runId;
          
          // If no runId, there's nothing to wait for
          if (!runId) {
            throw new AppError('No active generation task', {
              severity: ERROR_SEVERITY.ERROR,
              code: 'NO_ACTIVE_TASK',
              userFacing: true
            });
          }
          
          try {
            // If input is a webhook payload, process it
            if (input && input.type === 'webhook') {
              return handleWebhookUpdate(input.payload, state);
            } 
            
            // Otherwise, poll for status
            return await pollGenerationStatus(runId, state);
          } catch (error) {
            console.error('Error checking generation status:', error);
            
            // Don't fail the workflow on status check errors,
            // just update the state with the error
            return {
              ...state,
              data: {
                ...state.data,
                statusError: error.message || 'Error checking status',
                lastChecked: Date.now()
              }
            };
          }
        },
        
        // UI rendering info (platform-agnostic)
        ui: {
          type: 'progress',
          title: 'Generating Image',
          message: 'Your image is being generated...',
          prompt: '{{prompt}}',
          progress: '{{progress}}',
          status: '{{status}}',
          refreshable: true,
          refreshInterval: pollingInterval
        },
        
        // Stay on this step for polling, next steps are triggered by status changes
        nextStep: 'waitForResult'
      },
      
      /**
       * Step 5: Deliver the generated image
       */
      'deliverResult': {
        id: 'deliverResult',
        name: 'Deliver Result',
        description: 'Deliver the generated image to the user',
        
        // No validation needed for delivery
        validate: () => true,
        
        // Process delivery
        process: async (input, state) => {
          const userId = state.context.userId;
          const outputs = state.data.outputs || [];
          
          // Check if we have outputs to deliver
          if (!outputs.length) {
            throw new AppError('No images to deliver', {
              severity: ERROR_SEVERITY.ERROR,
              code: 'NO_IMAGES',
              userFacing: true
            });
          }
          
          try {
            // Deliver the media if adapter is available
            if (deliveryAdapter) {
              // Call delivery adapter with media info and platform-specific context
              const deliveryResult = await deliveryAdapter.deliverMedia({
                userId,
                mediaType: 'image',
                media: outputs[0], // Use first output
                context: {
                  prompt: state.data.prompt,
                  settings: state.data.settings,
                  platform: state.context.platform || 'default'
                }
              });
              
              // Record delivery result in state
              return {
                ...state,
                data: {
                  ...state.data,
                  delivered: true,
                  deliveryId: deliveryResult.id,
                  deliveredAt: Date.now()
                }
              };
            }
            
            // If no delivery adapter, just mark as delivered
            return {
              ...state,
              data: {
                ...state.data,
                delivered: true,
                deliveredAt: Date.now()
              }
            };
          } catch (error) {
            console.error('Error delivering image:', error);
            
            // Track delivery failure
            analyticsService?.trackEvent('workflow:delivery_failed', {
              workflowId: state.id,
              userId,
              error: error.message || 'Unknown error',
              timestamp: Date.now()
            });
            
            throw new AppError('Failed to deliver image', {
              severity: ERROR_SEVERITY.ERROR,
              code: 'DELIVERY_FAILED',
              userFacing: true,
              cause: error
            });
          }
        },
        
        // UI rendering info (platform-agnostic)
        ui: {
          type: 'result',
          title: 'Your Generated Image',
          message: 'Your image has been created!',
          mediaType: 'image',
          mediaSrc: '{{outputs[0]}}',
          prompt: '{{prompt}}',
          actions: [
            {
              id: 'newImage',
              label: 'Generate Another',
              nextStep: 'collectPrompt'
            },
            {
              id: 'done',
              label: 'Finish',
              nextStep: 'exit'
            }
          ]
        },
        
        // Next step if user wants to generate another image
        nextStep: 'collectPrompt'
      },
      
      /**
       * Step 6: Handle failure case
       */
      'handleFailure': {
        id: 'handleFailure',
        name: 'Handle Failure',
        description: 'Handle generation failure and refund points',
        
        // No validation needed
        validate: () => true,
        
        // Process failure and refund points
        process: async (input, state) => {
          const userId = state.context.userId;
          const cost = state.data.cost || 0;
          const error = state.data.error || 'Unknown error';
          
          // Refund points if allocated and service is available
          if (pointsService && cost > 0) {
            try {
              await pointsService.refundPoints(
                userId,
                cost,
                {
                  source: 'generation_failed',
                  reason: error,
                  taskId: state.data.taskId
                }
              );
            } catch (refundError) {
              console.error('Error refunding points:', refundError);
              // Continue even if refund fails
            }
          }
          
          // Track failure event
          analyticsService?.trackEvent('workflow:generation_failed_handled', {
            workflowId: state.id,
            userId,
            error,
            timestamp: Date.now()
          });
          
          // Return updated state
          return {
            ...state,
            data: {
              ...state.data,
              refunded: true,
              refundedAt: Date.now()
            }
          };
        },
        
        // UI rendering info (platform-agnostic)
        ui: {
          type: 'error',
          title: 'Generation Failed',
          message: 'Sorry, we couldn\'t generate your image',
          error: '{{error}}',
          prompt: '{{prompt}}',
          actions: [
            {
              id: 'retry',
              label: 'Try Again',
              nextStep: 'collectPrompt'
            },
            {
              id: 'done',
              label: 'Finish',
              nextStep: 'exit'
            }
          ]
        },
        
        // Next step if user wants to try again
        nextStep: 'collectPrompt'
      }
    }
  });
  
  /**
   * Helper: Process webhook update
   * @private
   * @param {Object} payload - Webhook payload
   * @param {Object} state - Current workflow state
   * @returns {Object} Updated workflow state
   */
  async function handleWebhookUpdate(payload, state) {
    // Ensure payload matches this workflow's generation task
    if (payload.run_id !== state.data.runId) {
      return state; // Ignore webhooks for other tasks
    }
    
    // Process webhook result through ComfyDeploy service
    const result = comfyDeployService.processWebhook(payload);
    
    // Update state based on generation result
    const isSuccessful = result.isSuccessful && result.isSuccessful();
    
    // Track event
    analyticsService?.trackEvent(
      isSuccessful ? 'workflow:generation_completed' : 'workflow:generation_failed',
      {
        workflowId: state.id,
        userId: state.context.userId,
        taskId: state.data.taskId,
        runId: state.data.runId,
        isSuccessful,
        timestamp: Date.now()
      }
    );
    
    // Handle success case
    if (isSuccessful) {
      const updatedState = {
        ...state,
        data: {
          ...state.data,
          status: 'completed',
          outputs: result.outputs || [],
          completedAt: Date.now(),
          nextStep: 'deliverResult' // Override next step
        }
      };
      
      // Move to delivery step
      return moveToNextStep(updatedState, 'deliverResult');
    }
    
    // Handle failure case
    const updatedState = {
      ...state,
      data: {
        ...state.data,
        status: 'failed',
        error: result.error || 'Generation failed',
        failedAt: Date.now(),
        nextStep: 'handleFailure' // Override next step
      }
    };
    
    // Move to failure handling step
    return moveToNextStep(updatedState, 'handleFailure');
  }
  
  /**
   * Helper: Poll for generation status
   * @private
   * @param {string} runId - ComfyDeploy run ID
   * @param {Object} state - Current workflow state
   * @returns {Object} Updated workflow state
   */
  async function pollGenerationStatus(runId, state) {
    // Skip checking if we just checked recently
    const lastChecked = state.data.lastChecked || 0;
    const now = Date.now();
    
    if (now - lastChecked < pollingInterval / 2) {
      return state;
    }
    
    // Check status via ComfyDeploy service
    const status = await comfyDeployService.checkStatus(runId, {
      taskId: state.data.taskId,
      userId: state.context.userId
    });
    
    // Update state with latest status
    const updatedState = {
      ...state,
      data: {
        ...state.data,
        status: status.status,
        progress: status.progress || 0,
        lastChecked: now
      }
    };
    
    // Handle completion
    if (status.isComplete) {
      if (status.status === 'completed' && status.result?.outputs?.length > 0) {
        // Success case
        const completedState = {
          ...updatedState,
          data: {
            ...updatedState.data,
            outputs: status.result.outputs,
            completedAt: now,
            nextStep: 'deliverResult' // Override next step
          }
        };
        
        // Move to delivery step
        return moveToNextStep(completedState, 'deliverResult');
      } else {
        // Failure case
        const failedState = {
          ...updatedState,
          data: {
            ...updatedState.data,
            error: status.error || 'Generation failed',
            failedAt: now,
            nextStep: 'handleFailure' // Override next step
          }
        };
        
        // Move to failure handling step
        return moveToNextStep(failedState, 'handleFailure');
      }
    }
    
    // Still processing, return updated state
    return updatedState;
  }
  
  /**
   * Helper: Move workflow to next step
   * @private
   * @param {Object} state - Current state
   * @param {string} stepId - Target step ID
   * @returns {Object} Updated state with next step
   */
  function moveToNextStep(state, stepId) {
    return {
      ...state,
      currentStep: stepId
    };
  }
}

/**
 * Create a stub for PointsService when not provided
 * @private
 * @returns {Object} Stub implementation
 */
function createPointsServiceStub() {
  return {
    calculateCost: () => 100,
    hasSufficientPoints: async () => true,
    allocatePoints: async () => ({ success: true }),
    refundPoints: async () => ({ success: true })
  };
}

/**
 * Create a stub for DeliveryAdapter when not provided
 * @private
 * @returns {Object} Stub implementation
 */
function createDeliveryAdapterStub() {
  return {
    deliverMedia: async (params) => ({
      id: `delivery-${Date.now()}`,
      success: true,
      mediaUrl: params.media
    })
  };
}

/**
 * Resume a workflow using a webhook payload
 * Used to handle asynchronous completions via webhook
 * 
 * @param {Object} workflow - Workflow instance to resume
 * @param {Object} webhookPayload - Webhook payload from ComfyDeploy
 * @returns {Promise<Object>} Updated workflow
 */
async function resumeWorkflowWithWebhook(workflow, webhookPayload) {
  // Verify we have a valid workflow and webhook payload
  if (!workflow || !webhookPayload) {
    throw new AppError('Invalid parameters', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'INVALID_PARAMS'
    });
  }
  
  // Find the waitForResult step
  const currentStep = workflow.getCurrentStepId();
  
  // If we're waiting for a result, process the webhook
  if (currentStep === 'waitForResult') {
    // Format webhook input
    const webhookInput = {
      type: 'webhook',
      payload: webhookPayload
    };
    
    // Process webhook input
    return workflow.processInput(webhookInput);
  }
  
  // Otherwise just return the workflow unchanged
  return workflow;
}

module.exports = {
  createMakeImageWorkflow,
  resumeWorkflowWithWebhook
}; 