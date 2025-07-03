const express = require('express');
const rateLimit = require('express-rate-limit');
const { createLogger } = require('../../utils/logger');
const internalApiClient = require('../../utils/internalApiClient');
const { createToolsApiRouter } = require('./toolsApi');
const { createWalletConnectionApiRouter } = require('./walletConnectionApi');
const createGenerationsApi = require('./generationsApi');
const { createPublicStorageApi } = require('./storageApi');
const { createWebhookApi } = require('./webhookApi');
const { createStatusApi } = require('./statusApi');
const { createAdminApi } = require('./adminApi');
const { createAuthApi } = require('./authApi');
const { createUserApi } = require('./userApi');
const { authenticateUser, authenticateUserOrApiKey } = require('../../platforms/web/middleware/auth');
const createPointsApi = require('./pointsApi');


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

  // Mount the User API router (Protected by JWT or API key)
  const userRouter = createUserApi(dependencies);
  if (userRouter) {
    externalApiRouter.use('/user', authenticateUserOrApiKey, userRouter);
    logger.info('External User API router mounted at /user. (JWT or API key protected)');
  } else {
    logger.warn('External User API router not mounted due to missing dependencies.');
  }

  // --- Routes ---

  /**
   * GET /
   * API documentation endpoint
   */
  externalApiRouter.get('/', (req, res) => {
    res.status(200).json({
      name: 'StationThis External API',
      version: process.env.APP_VERSION || '1.0.0',
      endpoints: {
        status: {
          base: '/status',
          description: 'Application status information',
          endpoints: [
            { path: '/', method: 'GET', description: 'Get detailed application status' },
            { path: '/health', method: 'GET', description: 'Simple health check' }
          ]
        },
        // tools: {
        //   base: '/tools',
        //   description: 'Tool registry and execution',
        //   endpoints: [
        //     { path: '/', method: 'GET', description: 'List all available tools' },
        //     { path: '/:toolId', method: 'GET', description: 'Get tool details' },
        //     { path: '/registry', method: 'GET', description: 'Get full tool registry (internal)' }
        //   ]
        // },
        admin: {
          base: '/admin',
          description: 'Admin dashboard API endpoints',
          endpoints: [
            { path: '/stats/dau', method: 'GET', description: 'Get daily active users stats' },
            { path: '/stats/recent-gens', method: 'GET', description: 'Get recent generations stats' },
            { path: '/stats/recent-history', method: 'GET', description: 'Get recent history stats' },
            { path: '/stats/gens-duration', method: 'GET', description: 'Get generation duration stats' },
            { path: '/stats/user-sessions', method: 'GET', description: 'Get user session stats' }
          ]
        }
      }
    });
  });

  /**
   * GET /status
   * A public health-check endpoint to verify that the External API is running.
   */
  const statusRouter = createStatusApi(dependencies);
  if (statusRouter) {
    externalApiRouter.use('/status', statusRouter);
    logger.info('External Status API router mounted at /status. (Public)');
  } else {
    logger.warn('External Status API router not mounted due to missing dependencies.');
  }

  // --- Endpoint Mapping ---
  // Here we will map external-facing routes to our internal services.
  
  // Mount the Tools API router (Publicly Accessible)
  const toolsRouter = createToolsApiRouter(dependencies);
  if (toolsRouter) {
    externalApiRouter.use('/tools', toolsRouter);
    logger.info('External Tools API router mounted at /tools. (Public)');
  } else {
    logger.warn('External Tools API router not mounted due to missing dependencies.');
  }

  // Mount the Auth API router (Publicly Accessible)
  const authRouter = createAuthApi(dependencies);
  if (authRouter) {
    externalApiRouter.use('/auth', authRouter);
    logger.info('External Auth API router mounted at /auth. (Public)');
  } else {
    logger.warn('External Auth API router not mounted due to missing dependencies.');
  }

  // Mount the Wallet Connection API router (Publicly Accessible)
  const walletConnectionRouter = createWalletConnectionApiRouter(dependencies);
  if (walletConnectionRouter) {
    externalApiRouter.use('/wallets/connect', walletConnectionRouter);
    logger.info('External Wallet Connection API router mounted at /wallets/connect. (Public)');
  } else {
    logger.warn('External Wallet Connection API router not mounted due to missing dependencies.');
  }

  // Mount the Generations API router (Protected by API Key)
  const generationsRouter = createGenerationsApi(dependencies);
  if (generationsRouter) {
    externalApiRouter.use('/generations', apiKeyAuth, generationsRouter);
    logger.info('External Generations API router mounted at /generations. (Protected)');
  } else {
    logger.warn('External Generations API router not mounted due to missing dependencies.');
  }

  // Mount the Public Storage API router (Publicly Accessible)
  const storageRouter = createPublicStorageApi(dependencies);
  if (storageRouter) {
    externalApiRouter.use('/storage', storageRouter);
    logger.info('External Public Storage API router mounted at /storage. (Public)');
  } else {
    logger.warn('External Public Storage API router not mounted due to missing dependencies.');
  }

  // Mount the Webhook API router (Publicly Accessible but with internal validation)
  const webhookRouter = createWebhookApi(dependencies);
  if (webhookRouter) {
    externalApiRouter.use('/webhook', webhookRouter);
    logger.info('External Webhook API router mounted at /webhook. (Public with validation)');
  } else {
    logger.warn('External Webhook API router not mounted due to missing dependencies.');
  }

  // Mount the Admin API router (Protected by API Key)
  const adminRouter = createAdminApi(dependencies);
  if (adminRouter) {
    externalApiRouter.use('/admin', apiKeyAuth, adminRouter);
    logger.info('External Admin API router mounted at /admin. (Protected)');
  } else {
    logger.warn('External Admin API router not mounted due to missing dependencies.');
  }

  // Mount the Points API router (Protected by JWT or API Key)
  const pointsRouter = createPointsApi(dependencies);
  if (pointsRouter) {
    externalApiRouter.use('/points', authenticateUserOrApiKey, pointsRouter);
    logger.info('External Points API router mounted at /points. (JWT or API key protected)');
  } else {
    logger.warn('External Points API router not mounted due to missing dependencies.');
  }

  logger.info('External API router initialized.');
  return externalApiRouter;
}

module.exports = { initializeExternalApi }; 