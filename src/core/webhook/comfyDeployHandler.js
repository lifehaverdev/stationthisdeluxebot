/**
 * ComfyDeploy Webhook Handler
 * 
 * Processes incoming webhook requests from ComfyDeploy and updates task status.
 * Integrates with the internal API to maintain consistent state.
 */

const { AppError } = require('../shared/errors/AppError');
const { Logger } = require('../../utils/logger');
const { ServiceRegistry } = require('../../services/registry');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'comfyWebhook'
});

// Get registry instance
const serviceRegistry = ServiceRegistry.getInstance();

/**
 * Process ComfyDeploy webhook
 * @param {Object} webhookData - Webhook data from ComfyDeploy
 * @returns {Promise<Object>} - Processed result
 */
async function processWebhook(webhookData) {
  try {
    logger.info('Processing ComfyDeploy webhook', {
      run_id: webhookData.run_id || 'unknown'
    });

    // Validate webhook data
    if (!webhookData || !webhookData.run_id) {
      throw new AppError('Invalid webhook data: missing run_id', {
        code: 'INVALID_WEBHOOK_DATA'
      });
    }

    // Extract webhook_data for user and task information
    const { webhook_data = {} } = webhookData;
    const { taskId, userId } = webhook_data;

    // Check if ComfyDeploy service is registered
    if (!serviceRegistry.has('comfydeploy')) {
      throw new AppError('ComfyDeploy service not registered', {
        code: 'SERVICE_NOT_FOUND'
      });
    }

    // Get the ComfyDeploy service adapter
    const comfyAdapter = serviceRegistry.get('comfydeploy');

    // Process the webhook using the adapter
    const result = comfyAdapter.processWebhook(webhookData);

    // Log the result
    if (result.isSuccessful()) {
      logger.info('ComfyDeploy webhook processed successfully', {
        run_id: webhookData.run_id,
        taskId: taskId || 'unknown',
        userId: userId || 'unknown',
        status: 'completed',
        outputs: result.outputs.length
      });

      // Here you would typically notify the user or update the task in a database
      // For this implementation, we're relying on the event emitter in the service adapter

      return {
        success: true,
        taskId: taskId || webhookData.run_id,
        status: 'completed',
        outputs: result.outputs,
        metadata: result.metadata
      };
    } else {
      logger.error('ComfyDeploy generation failed', {
        run_id: webhookData.run_id,
        taskId: taskId || 'unknown',
        userId: userId || 'unknown',
        error: result.error
      });

      return {
        success: false,
        taskId: taskId || webhookData.run_id,
        status: 'failed',
        error: result.error
      };
    }
  } catch (error) {
    logger.error('Error processing ComfyDeploy webhook', {
      run_id: webhookData?.run_id || 'unknown',
      error
    });

    throw error instanceof AppError ? error : new AppError('Failed to process webhook', {
      code: 'WEBHOOK_PROCESSING_FAILED',
      cause: error
    });
  }
}

/**
 * Handle webhook HTTP request
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @returns {Promise<void>}
 */
async function handleWebhookRequest(req, res) {
  try {
    // Process the webhook
    const result = await processWebhook(req.body);

    // Send response
    res.status(200).json({
      success: true,
      message: `Webhook processed successfully: ${result.status}`,
      taskId: result.taskId
    });
  } catch (error) {
    // Log error
    logger.error('Error handling webhook request', {
      error
    });

    // Send error response
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

// Export functions
module.exports = {
  processWebhook,
  handleWebhookRequest
}; 