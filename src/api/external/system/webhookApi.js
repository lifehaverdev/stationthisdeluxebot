const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { processComfyDeployWebhook } = require('../../../core/services/comfydeploy/webhookProcessor');
const { validateAlchemySignature, addAlchemyContextToRequest } = require('../../../core/services/alchemy/webhookUtils');
const bodyParser = require('body-parser');

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
      routeLogger.debug('[WebhookAPI] Dependencies prepared for webhookProcessor', {
        internalApiClient: {
          exists: Boolean(dependencies.internal?.client),
          hasGet: typeof dependencies.internal?.client?.get === 'function'
        },
        loggerAttached: Boolean(dependencies.logger)
      });
      
      // Prepare dependencies for the webhook processor
      const processorDeps = {
        internalApiClient: dependencies.internalApiClient || dependencies.internal?.client,
        telegramNotifier: dependencies.telegramNotifier,
        logger: dependencies.logger || console,
        webSocketService: dependencies.webSocketService // <-- add this
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
  // Support multichain credit services. Expose :chainId route param (defaults to "1")

  const { creditServices = {}, ethereumServices = {}, creditService: legacyCredit, ethereumService: legacyEth } = dependencies;

  /**
   * Helper to grab the correct service pair for a given chain.
   * Falls back to the legacy singleton for backward-compatibility.
   * @param {string|number} cid
   */
  const getChainServices = (cid = '1') => ({
    creditService: creditServices[cid] || legacyCredit,
    ethereumService: ethereumServices[cid] || legacyEth,
  });

  // Resolve signing key per chainId: ENV vars like ALCHEMY_SIGNING_KEY_1, fallback to ALCHEMY_SIGNING_KEY
  const getSigningKey = (cid='1') => process.env[`ALCHEMY_SIGNING_KEY_${cid}`] || process.env.ALCHEMY_SIGNING_KEY;

  // Always mount route; reject if no key for cid at runtime
  webhookRouter.post('/alchemy/:chainId?',
    (req, res, next) => {
      const logger = dependencies.logger || console;
      logger.debug('[AlchemyWebhook] Incoming request', {
        headers: req.headers,
        method: req.method,
        url: req.originalUrl
      });
      next();
    },
    (req, res, next) => {
      const logger = dependencies.logger || console;
      logger.debug('[AlchemyWebhook] Before signature validation', {
        signature: req.header('X-Alchemy-Signature'),
        hasRawBody: !!req.rawBody,
        rawBodyLength: req.rawBody ? req.rawBody.length : 0
      });
      next();
    },
    async (req, res, next) => {
      const chainId = String(req.params.chainId || '1');
      const signingKey = getSigningKey(chainId);
      if (!signingKey) {
        return res.status(403).json({ success:false, message:`No signing key configured for chain ${chainId}`});
      }
      // run signature validator
      try {
        validateAlchemySignature(signingKey)(req,res,next);
      } catch(err){ return; }
    },
    async (req, res) => {
      const logger = dependencies.logger || console;
      logger.debug('[AlchemyWebhook] Handler start', {
        body: req.body,
        rawBody: req.rawBody ? req.rawBody.toString('hex').slice(0, 64) + '...' : undefined
      });
      try {
        const chainId = String(req.params.chainId || '1');
        const { creditService } = getChainServices(chainId);
        if (!creditService) {
          logger.error('[AlchemyWebhook] CreditService not available');
          throw new Error('CreditService not available');
        }
        const result = await creditService.handleEventWebhook(req.body);
        logger.debug('[AlchemyWebhook] Handler result', { chainId, result });
        res.json(result);
      } catch (error) {
        logger.error('[AlchemyWebhook] Error processing webhook:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error processing webhook',
          detail: error.message
        });
      }
    }
  );
  logger.info('[WebhookAPI] Alchemy webhook handler mounted at /alchemy/:chainId?');

  logger.info('Webhook API router initialized.');
  return webhookRouter;
}

module.exports = { createWebhookApi }; 