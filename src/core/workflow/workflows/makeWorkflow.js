/**
 * Make Generation Workflow
 * 
 * Defines a workflow for generating images with proper points integration.
 * Handles the entire lifecycle from prompt entry to completion.
 */

const { createWorkflow } = require('../index');
const { AppError } = require('../../shared/errors');

/**
 * Create the image generation workflow definition
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pointsService - Points service for handling costs
 * @param {Object} deps.generationService - Generation service for creating tasks
 * @param {Object} deps.comfyDeployService - ComfyDeploy service for processing
 * @param {Object} deps.sessionManager - Session manager for user data
 * @returns {Object} Workflow sequence
 */
function createMakeWorkflow(deps) {
  const { pointsService, generationService, comfyDeployService, sessionManager } = deps;
  
  return createWorkflow({
    id: 'make-generation',
    name: 'Image Generation',
    description: 'Generate images with AI',
    
    steps: {
      'prompt': {
        id: 'prompt',
        name: 'Enter Prompt',
        description: 'What would you like to generate?',
        
        // Simple validation for prompt
        validate: (input, state) => {
          if (!input || typeof input !== 'string' || input.trim().length < 3) {
            throw new AppError('Please enter a more detailed prompt (at least 3 characters).', 'INVALID_PROMPT');
          }
          
          return true;
        },
        
        // Process prompt input
        process: async (input, state) => {
          // Store prompt in context
          return {
            ...state,
            context: {
              ...state.context,
              prompt: input.trim(),
              lastUpdated: Date.now()
            }
          };
        },
        
        // UI representation
        ui: {
          type: 'input',
          title: 'Generate an Image',
          message: 'What would you like to generate?',
          placeholder: 'Enter your detailed prompt here...',
          components: [
            {
              type: 'text',
              template: 'Your prompt will be used to generate an image. Be descriptive!',
              format: 'plain'
            }
          ],
          actions: [
            {
              id: 'next',
              label: 'Continue',
              nextStep: 'settings',
              primary: true
            },
            {
              id: 'cancel',
              label: 'Cancel',
              nextStep: 'exit',
              action: 'exit'
            }
          ]
        },
        
        // Move to settings step next
        nextStep: 'settings'
      },
      
      'settings': {
        id: 'settings',
        name: 'Configure Settings',
        description: 'Adjust generation settings (optional)',
        
        // No input validation needed for settings step
        validate: () => true,
        
        // Process settings input
        process: async (input, state) => {
          // Get default settings
          const defaultSettings = {
            width: 1024,
            height: 1024,
            steps: 30,
            seed: -1
          };
          
          // Merge with user input if provided
          const settings = input && typeof input === 'object'
            ? { ...defaultSettings, ...input }
            : defaultSettings;
          
          // Calculate generation cost
          const cost = pointsService.getGenerationCost({ 
            type: state.context.generationType || 'DEFAULT',
            settings
          });
          
          // Store settings in context
          return {
            ...state,
            context: {
              ...state.context,
              settings,
              cost,
              lastUpdated: Date.now()
            }
          };
        },
        
        // UI representation
        ui: {
          type: 'form',
          title: 'Generation Settings',
          message: 'Adjust your generation settings (optional)',
          components: [
            {
              type: 'text',
              template: 'Prompt: "{{prompt}}"',
              format: 'markdown'
            },
            {
              type: 'text',
              template: 'These settings control how your image will be generated.',
              format: 'plain'
            }
          ],
          fields: [
            {
              id: 'width',
              name: 'Width',
              type: 'number',
              default: 1024,
              min: 256,
              max: 2048
            },
            {
              id: 'height',
              name: 'Height',
              type: 'number',
              default: 1024,
              min: 256,
              max: 2048
            },
            {
              id: 'seed',
              name: 'Seed (-1 for random)',
              type: 'number',
              default: -1
            }
          ],
          actions: [
            {
              id: 'next',
              label: 'Continue',
              nextStep: 'confirm',
              primary: true
            },
            {
              id: 'back',
              label: 'Back to Prompt',
              nextStep: 'prompt'
            },
            {
              id: 'cancel',
              label: 'Cancel',
              nextStep: 'exit',
              action: 'exit'
            }
          ]
        },
        
        // Move to confirm step next
        nextStep: 'confirm'
      },
      
      'confirm': {
        id: 'confirm',
        name: 'Confirm Generation',
        description: 'Generate this image?',
        
        // Validate that user has sufficient points
        validate: async (input, state) => {
          const userId = state.context.userId;
          const cost = state.context.cost || 100;
          
          // Check if user has sufficient points
          const hasSufficientPoints = await pointsService.hasSufficientPoints(
            userId,
            cost
          );
          
          if (!hasSufficientPoints) {
            throw new AppError(
              `Insufficient points for generation. Required: ${cost}`,
              'INSUFFICIENT_POINTS'
            );
          }
          
          return true;
        },
        
        // Process confirmation and start generation
        process: async (input, state) => {
          const userId = state.context.userId;
          const prompt = state.context.prompt;
          const settings = state.context.settings || {};
          const generationType = state.context.generationType || 'DEFAULT';
          
          try {
            // Create the generation request
            const request = comfyDeployService.buildRequest({
              type: generationType,
              prompt,
              settings,
              user: {
                id: userId,
                username: state.context.username || ''
              },
              metadata: {
                source: 'workflow'
              }
            });
            
            // Check if user confirmed
            if (!input || input === 'no') {
              return {
                ...state,
                context: {
                  ...state.context,
                  cancelled: true,
                  lastUpdated: Date.now()
                }
              };
            }
            
            // Create and start the generation task
            const task = await generationService.createTask(request);
            await generationService.startProcessingTask(task.taskId);
            
            // Allocate points for the task using TaskPointsService
            const taskDetails = {
              type: generationType,
              prompt,
              settings
            };
            
            const pointsTask = {
              userId,
              type: generationType,
              dointsAllocated: state.context.cost || 100
            };
            
            // Publish event for task point tracking
            deps.eventBus?.publish('task:enqueued', { task: pointsTask });
            
            // Store task info in workflow context
            return {
              ...state,
              context: {
                ...state.context,
                taskId: task.taskId,
                taskStartedAt: Date.now(),
                status: 'processing',
                lastUpdated: Date.now()
              }
            };
          } catch (error) {
            console.error('Error starting generation task:', error);
            throw new AppError(
              'Failed to start generation: ' + (error.message || 'Unknown error'),
              'GENERATION_FAILED',
              { cause: error }
            );
          }
        },
        
        // UI representation
        ui: {
          type: 'confirm',
          title: 'Confirm Generation',
          message: 'Ready to generate your image?',
          components: [
            {
              type: 'text',
              template: 'Prompt: "{{prompt}}"',
              format: 'markdown'
            },
            {
              type: 'text',
              template: 'Size: {{settings.width}}×{{settings.height}}',
              format: 'plain'
            },
            {
              type: 'text',
              template: 'Seed: {{settings.seed === -1 ? "Random" : settings.seed}}',
              format: 'plain'
            },
            {
              type: 'text',
              template: 'Cost: {{cost}} points',
              format: 'markdown'
            }
          ],
          actions: [
            {
              id: 'confirm',
              label: 'Generate',
              value: 'yes',
              nextStep: 'status',
              primary: true
            },
            {
              id: 'back',
              label: 'Adjust Settings',
              nextStep: 'settings'
            },
            {
              id: 'cancel',
              label: 'Cancel',
              value: 'no',
              nextStep: 'exit',
              action: 'exit'
            }
          ]
        },
        
        // Move to status step next
        nextStep: 'status'
      },
      
      'status': {
        id: 'status',
        name: 'Generation Status',
        description: 'Your image is being generated',
        
        // No input validation needed for status step
        validate: () => true,
        
        // Process status updates
        process: async (input, state) => {
          const { taskId } = state.context;
          
          if (!taskId) {
            return state;
          }
          
          try {
            // Check task status
            const task = await generationService.getTaskById(taskId);
            
            if (!task) {
              throw new AppError('Generation task not found', 'TASK_NOT_FOUND');
            }
            
            // Update context with latest task status
            return {
              ...state,
              context: {
                ...state.context,
                status: task.status,
                progress: task.progress || 0,
                outputs: task.response?.outputs || [],
                error: task.response?.error || '',
                completed: task.status === 'completed',
                failed: task.status === 'failed',
                lastUpdated: Date.now()
              }
            };
          } catch (error) {
            console.error('Error checking task status:', error);
            throw new AppError(
              'Failed to check generation status: ' + (error.message || 'Unknown error'),
              'STATUS_CHECK_FAILED',
              { cause: error }
            );
          }
        },
        
        // UI representation
        ui: {
          type: 'display',
          title: 'Generation Status',
          message: 'Your image is being generated...',
          components: [
            {
              type: 'text',
              template: 'Prompt: "{{prompt}}"',
              format: 'markdown'
            },
            {
              type: 'text',
              template: 'Status: {{status}}',
              format: 'plain'
            },
            {
              type: 'text',
              template: 'Progress: {{progress}}%',
              format: 'plain',
              condition: 'progress'
            },
            {
              type: 'text',
              template: 'Error: {{error}}',
              format: 'plain',
              condition: 'error'
            },
            {
              type: 'image',
              source: '{{outputs[0]}}',
              condition: 'completed'
            },
            {
              type: 'text',
              template: '✅ Generation completed!',
              format: 'plain',
              condition: 'completed'
            },
            {
              type: 'text',
              template: '❌ Generation failed.',
              format: 'plain',
              condition: 'failed'
            }
          ],
          actions: [
            {
              id: 'refresh',
              label: 'Refresh Status',
              nextStep: 'status',
              condition: '!completed && !failed',
              primary: true
            },
            {
              id: 'new',
              label: 'Generate Another',
              nextStep: 'prompt',
              condition: 'completed || failed',
              primary: true
            },
            {
              id: 'done',
              label: 'Done',
              nextStep: 'exit',
              action: 'exit'
            }
          ]
        },
        
        // Stay on this step by default (for refreshing)
        nextStep: 'status'
      }
    },
    
    // Start with prompt step
    initialStep: 'prompt'
  });
}

module.exports = { createMakeWorkflow }; 