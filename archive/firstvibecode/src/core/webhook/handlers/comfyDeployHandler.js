/**
 * ComfyDeploy Webhook Handler
 * 
 * Handles webhooks from ComfyDeploy service, updating tasks and workflows.
 * Integrates with the workflow system to update generation status and results.
 */

const { AppError, ERROR_SEVERITY } = require('../../shared/errors');
const { WebhookHandler } = require('../registry');
const { EventEmitter } = require('events');

/**
 * Create a ComfyDeploy webhook handler
 * @param {Object} options - Handler options
 * @param {Object} options.comfyDeployService - ComfyDeployService instance
 * @param {Object} [options.workflowManager] - WorkflowManager instance
 * @param {Object} [options.taskManager] - TaskManager instance
 * @param {Object} [options.eventBus] - EventBus instance
 * @returns {WebhookHandler} - ComfyDeploy webhook handler
 */
function createComfyDeployWebhookHandler(options = {}) {
  if (!options.comfyDeployService) {
    throw new Error('ComfyDeployService is required for ComfyDeploy webhook handler');
  }
  
  // Create event emitter if not provided
  const events = options.eventBus || new EventEmitter();
  
  // Create the webhook handler
  return new WebhookHandler({
    service: 'comfydeploy',
    priority: 5, // High priority to process ComfyDeploy webhooks early
    
    /**
     * Determine if this handler can process a webhook
     * @param {Object} payload - Webhook payload
     * @returns {boolean} - True if this handler can process the webhook
     */
    canHandle: (payload) => {
      // Check if payload matches ComfyDeploy webhook format
      return Boolean(
        payload &&
        typeof payload === 'object' &&
        payload.run_id &&
        payload.status
      );
    },
    
    /**
     * Process a ComfyDeploy webhook
     * @param {Object} payload - Webhook payload
     * @returns {Promise<Object>} - Processing result
     */
    processWebhook: async (payload) => {
      try {
        // Extract key information from payload
        const { run_id, status, output, error, webhook_data = {} } = payload;
        const { taskId, userId, workflowId } = webhook_data;
        
        // Process the webhook with ComfyDeployService
        const result = options.comfyDeployService.processWebhook(payload);
        
        // Track event in analytics if userId is available
        if (userId) {
          events.emit('analytics:track', {
            event: 'webhook:comfydeploy:received',
            properties: {
              userId,
              status,
              taskId,
              runId: run_id,
              workflowId,
              timestamp: Date.now()
            }
          });
        }
        
        // Update task if TaskManager is available
        if (options.taskManager && taskId) {
          try {
            if (status === 'success') {
              await options.taskManager.completeTask(taskId, {
                status: 'completed',
                result: {
                  runId: run_id,
                  output
                }
              });
            } else if (status === 'error') {
              await options.taskManager.failTask(taskId, {
                status: 'failed',
                error: error || 'Unknown error',
                runId: run_id
              });
            } else if (status === 'processing') {
              await options.taskManager.updateTask(taskId, {
                status: 'processing',
                progress: payload.progress || 0,
                runId: run_id
              });
            }
          } catch (taskError) {
            console.error('Error updating task:', taskError);
            events.emit('webhook:task:error', {
              taskId,
              error: taskError.message,
              timestamp: Date.now()
            });
          }
        }
        
        // Update workflow if WorkflowManager is available
        if (options.workflowManager && workflowId) {
          try {
            // Find the workflow instance
            const workflow = await options.workflowManager.getWorkflow(workflowId);
            
            if (workflow) {
              if (status === 'success') {
                // Get the current step ID
                const currentStepId = workflow.getCurrentStepId();
                
                // Only update if the workflow is in a relevant step
                if (currentStepId === 'status' || currentStepId === 'generating') {
                  // Process the 'completed' result in the workflow
                  await options.workflowManager.processWorkflowStep(workflow.id, {
                    status: 'completed',
                    outputs: output?.images || [],
                    runId: run_id
                  });
                }
              } else if (status === 'error') {
                // Process the 'failed' result in the workflow
                await options.workflowManager.processWorkflowStep(workflow.id, {
                  status: 'failed',
                  error: error || 'Generation failed',
                  runId: run_id
                });
              } else if (status === 'processing') {
                // Process the 'processing' update in the workflow
                await options.workflowManager.processWorkflowStep(workflow.id, {
                  status: 'processing',
                  progress: payload.progress || 0,
                  runId: run_id
                });
              }
            } else {
              console.warn(`Workflow ${workflowId} not found for webhook update`);
            }
          } catch (workflowError) {
            console.error('Error updating workflow:', workflowError);
            events.emit('webhook:workflow:error', {
              workflowId,
              error: workflowError.message,
              timestamp: Date.now()
            });
          }
        }
        
        // Emit service-specific event
        events.emit('comfydeploy:webhook:processed', {
          runId: run_id,
          status,
          taskId,
          userId,
          workflowId,
          timestamp: Date.now()
        });
        
        return {
          success: true,
          taskId,
          userId,
          workflowId,
          runId: run_id,
          status,
          result
        };
      } catch (error) {
        // Log error and emit event
        console.error('Error processing ComfyDeploy webhook:', error);
        
        events.emit('comfydeploy:webhook:error', {
          error: error.message,
          payload,
          timestamp: Date.now()
        });
        
        // Rethrow as AppError
        throw error instanceof AppError ? error : new AppError('Failed to process ComfyDeploy webhook', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'COMFYDEPLOY_WEBHOOK_FAILED',
          cause: error
        });
      }
    }
  });
}

module.exports = {
  createComfyDeployWebhookHandler
}; 