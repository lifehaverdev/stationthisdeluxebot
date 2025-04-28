/**
 * Webhook Routes
 * 
 * API routes for handling webhooks from external services.
 */

const express = require('express');
const { handleWebhookRequest: handleComfyWebhook } = require('../../core/webhook/comfyDeployHandler');
const { Logger } = require('../../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'webhookRoutes'
});

// Create router
const router = express.Router();

/**
 * ComfyDeploy webhook endpoint
 * POST /api/webhooks/comfydeploy
 */
router.post('/comfydeploy', (req, res) => {
  logger.info('Received ComfyDeploy webhook', {
    run_id: req.body?.run_id || 'unknown'
  });
  
  // Handle the webhook
  handleComfyWebhook(req, res);
});

/**
 * Generic webhook endpoint for debugging
 * POST /api/webhooks/debug
 */
router.post('/debug', (req, res) => {
  logger.info('Received debug webhook', {
    body: req.body
  });
  
  // Log the webhook but don't process it
  res.status(200).json({
    success: true,
    message: 'Debug webhook received',
    receivedAt: new Date().toISOString(),
    payload: req.body
  });
});

/**
 * Health check endpoint for webhooks
 * GET /api/webhooks/health
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Webhook service is operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 