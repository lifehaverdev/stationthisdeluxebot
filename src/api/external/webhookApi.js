const express = require('express');
const { createLogger } = require('../../utils/logger');
const { processComfyDeployWebhook } = require('../../core/services/comfydeploy/webhookProcessor');
const { validateAlchemySignature, addAlchemyContextToRequest } = require('../../core/services/alchemy/webhookUtils');

/**
 * Creates the webhook API router for handling external webhook events.
 * 
 * @param {Object} dependencies - Dependencies from the main application
 * @returns {express.Router} - The configured Express router for webhook endpoints
 */
function createWebhookApi(dependencies) {
  const logger = createLogger('WebhookAPI');
  const webhookRouter = express.Router();

  // --- ComfyDeploy Webhook Handler ---
  webhookRouter.post('/comfydeploy', async (req, res) => {
    try {
      // The new processor function handles its own logging of the hit and payload
      const routeLogger = dependencies.logger || console;

      // Log summary of dependencies
      routeLogger.info('[WebhookAPI] Dependencies prepared for webhookProcessor', {
        internalApiClient: {
          exists: Boolean(dependencies.internal?.client),
          hasGet: typeof dependencies.internal?.client?.get === 'function'
        },
        loggerAttached: Boolean(dependencies.logger)
      });
      
      // Prepare dependencies for the webhook processor
      const processorDeps = {
        internalApiClient: dependencies.internal?.client,
        telegramNotifier: dependencies.telegramNotifier,
        logger: dependencies.logger || console
      };
      
      const result = await processComfyDeployWebhook(req.body, processorDeps);

      if (result.success) {
        res.status(result.statusCode || 200).json(result.data || { message: "Webhook processed" });
      } else {
        res.status(result.statusCode || 500).json({ message: "error", error: result.error || "Webhook processing failed." });
      }

    } catch (error) {
      const routeLogger = dependencies.logger || console;
      routeLogger.error('[WebhookAPI] Unhandled exception:', error);
      res.status(500).json({ message: "error", error: "Internal server error in webhook route handler." });
    }
  });

  // --- Alchemy Webhook Handler ---
  const alchemySigningKey = process.env.ALCHEMY_SIGNING_KEY;
  if (!alchemySigningKey) {
    logger.warn('[WebhookAPI] ALCHEMY_SIGNING_KEY not set. The /alchemy endpoint will be disabled.');
  } else {
    webhookRouter.post('/alchemy',
      express.json({ verify: addAlchemyContextToRequest }), // Add raw body to request
      validateAlchemySignature(alchemySigningKey), // Validate signature
      async (req, res) => {
        const logger = dependencies.logger || console;
        logger.info('[WebhookAPI] Received Alchemy webhook event');

        try {
          const creditService = dependencies.creditService;
          if (!creditService) {
            throw new Error('CreditService not available');
          }

          // Process all events through the unified handler
          const result = await creditService.handleEventWebhook(req.body);
          res.json(result);

        } catch (error) {
          logger.error('[WebhookAPI] Error processing Alchemy webhook:', error);
          res.status(500).json({
            success: false,
            message: 'Internal server error processing webhook',
            detail: error.message
          });
        }
      }
    );
    logger.info('[WebhookAPI] Alchemy webhook handler mounted at /alchemy.');
  }

  logger.info('Webhook API router initialized.');
  return webhookRouter;
}

module.exports = { createWebhookApi }; 