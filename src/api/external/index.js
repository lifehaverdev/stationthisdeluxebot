const express = require('express');
const rateLimit = require('express-rate-limit');
const { createLogger } = require('../../utils/logger');
const internalApiClient = require('../../utils/internalApiClient');
const { createToolsApiRouter } = require('./toolsApi');
const { createWalletConnectionApiRouter } = require('./walletConnectionApi');
const createGenerationsApi = require('./generationsApi');
const { createPublicStorageApi } = require('./storageApi');


/**
 * Initializes the External API layer.
 * This layer is responsible for exposing a curated set of internal functionalities
 * to the public, protected by API key authentication.
 *
 * @param {Object} dependencies - Dependencies from the main application,
 *   including internal services and database connections.
 * @returns {express.Router} - The configured Express router for the external API.
 */
function initializeExternalApi(dependencies) {
  const logger = createLogger('ExternalAPI');
  const externalApiRouter = express.Router();

  // --- Middleware ---

  /**
   * Rate Limiting Middleware
   * Applies a basic rate limit to all requests to the external API to prevent abuse.
   */
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'You have sent too many requests in a given amount of time. Please try again later.' } },
  });

  // Apply the rate limiter to all routes in the external API router.
  externalApiRouter.use(limiter);

  /**
   * API Key Authentication Middleware (Placeholder)
   * This middleware will be responsible for authenticating requests using an API key.
   * It will look for an API key in the request headers (e.g., 'X-API-Key'),
   * validate it, and attach the corresponding user/principal to the request object.
   */
  const apiKeyAuth = async (req, res, next) => {
    const apiKey = req.get('X-API-Key');
    if (!apiKey) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'API key is missing.' } });
    }

    try {
      // Defer validation to the internal API
      const response = await internalApiClient.post('/internal/v1/data/auth/validate-key', { apiKey });

      // Attach user and key info to the request object for use in downstream handlers
      req.user = response.data.user;
      req.apiKey = response.data.apiKey;
      
      next();
    } catch (error) {
      logger.error('API key authentication check via internal API failed.', {
        errorMessage: error.message,
        responseData: error.response?.data,
        responseStatus: error.response?.status
      });

      // Map internal errors to generic, safe external-facing errors.
      if (error.response) {
        const status = error.response.status;
        if (status === 401 || status === 404) {
          return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key.' } });
        }
        if (status === 403) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'API key is not active.' } });
        }
      }
      
      // For network errors or unhandled internal errors, return a generic 500.
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An error occurred during authentication.' } });
    }
  };

  // Apply authentication middleware to all external API routes.
  // externalApiRouter.use(apiKeyAuth); // REMOVED: We will apply auth on a per-route basis.

  // --- Routes ---

  /**
   * GET /status
   * A public health-check endpoint to verify that the External API is running.
   */
  externalApiRouter.get('/status', (req, res) => {
    res.status(200).json({
      status: 'ok',
      message: 'External API is operational.'
    });
  });

  // --- Endpoint Mapping ---
  // Here we will map external-facing routes to our internal services.
  
  // Mount the Tools API router (Publicly Accessible)
  const toolsRouter = createToolsApiRouter(dependencies);
  externalApiRouter.use('/tools', toolsRouter);
  logger.info('External Tools API router mounted at /tools. (Public)');

  // Mount the Wallet Connection API router (Publicly Accessible)
  const walletConnectionRouter = createWalletConnectionApiRouter(dependencies);
  externalApiRouter.use('/wallets/connect', walletConnectionRouter);
  logger.info('External Wallet Connection API router mounted at /wallets/connect. (Public)');



  // Mount the Generations API router (Protected by API Key)
  const generationsRouter = createGenerationsApi(dependencies);
  externalApiRouter.use('/generations', apiKeyAuth, generationsRouter);
  logger.info('External Generations API router mounted at /generations. (Protected)');

  // Mount the Public Storage API router (Publicly Accessible)
  const storageRouter = createPublicStorageApi(dependencies);
  externalApiRouter.use('/storage', storageRouter);
  logger.info('External Public Storage API router mounted at /storage. (Public)');

  logger.info('External API router initialized.');
  return externalApiRouter;
}

module.exports = { initializeExternalApi }; 