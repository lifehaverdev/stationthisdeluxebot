const express = require('express');
const rateLimit = require('express-rate-limit');
const { createLogger } = require('../../utils/logger');
// Expect a pre-instantiated internalApiClient instance via dependencies
// This enforces the canonical dependency injection pattern and avoids
// accidental creation of multiple axios clients.
const { createToolsApiRouter } = require('./toolsApi');
const { createWalletConnectionApiRouter } = require('./wallets');
const { createGenerationsApi, createGenerationExecutionApi } = require('./generations');
const { createPublicStorageApi } = require('./storage');
const { createStatusApi, createAdminApi, createWebhookApi } = require('./system');
const { createReferralVaultApi } = require('./referralVaultApi');
const { createAuthApi } = require('./auth');
const { createUserApi } = require('./users');
const createModelsApiRouter = require('./models');
const { authenticateUser, authenticateUserOrApiKey } = require('../../platforms/web/middleware/auth');
const { createPointsApi, createRatesApi } = require('./economy');
const createSpellsApi = require('./spells');
const createCookApiRouter = require('./cookApi');
const createWorkspacesApiRouter = require('./workspacesApi');


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
  if (!dependencies.internalApiClient && !(dependencies.internal && dependencies.internal.client)) {
    throw new Error('[ExternalAPI] internalApiClient dependency is missing. Ensure the canonical dependencies object includes "internalApiClient".');
  }
  // Prefer the top-level canonical property
  const internalApiClient = dependencies.internalApiClient || dependencies.internal.client;
  const logger = createLogger('ExternalAPI');
  
  // Debug logging for dependencies
  console.log('[ExternalAPI] Dependencies check:', {
    internalApiClient: !!internalApiClient,
    longRunningApiClient: !!dependencies.longRunningApiClient,
    priceFeedService: !!dependencies.priceFeedService,
    saltMiningService: !!dependencies.saltMiningService
  });
  
  const externalApiRouter = express.Router();
  // Maintain backward compatibility for modules that still expect dependencies.internal.client
  dependencies.internal = dependencies.internal || {};
  dependencies.internal.client = internalApiClient; // legacy path
  dependencies.internalApiClient = internalApiClient; // canonical path for new modules
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
    // Do not rate-limit webhook callbacks
    skip: (req) => req.path.startsWith('/webhook/'),
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

  // Dual authentication middleware: allows API key or session/CSRF
  const dualAuth = async (req, res, next) => {
    // API Key authentication
    const apiKey = req.get('X-API-Key');
    if (apiKey) {
      try {
        const response = await internalApiClient.post('/internal/v1/data/auth/validate-key', { apiKey });
        req.user = response.data.user;
        req.apiKey = response.data.apiKey;
        return next();
      } catch (error) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key.' } });
      }
    }

    // JWT authentication from cookie
    const token = req.cookies.jwt;
  console.log('[dualAuth] jwt cookie:', token);
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('[dualAuth] decoded JWT:', decoded);
      req.user = decoded;
      return next();
    } catch (error) {
      console.error('[dualAuth] JWT verification error:', error);
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token.' } });
    }
  }

    // If neither API key nor JWT is present, deny access.
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
  };

  // Mount the User API router (Protected by JWT or API key)
  const userRouter = createUserApi(dependencies);
  if (userRouter) {
    externalApiRouter.use('/user', authenticateUserOrApiKey, userRouter);
    logger.info('External User API router mounted at /user. (JWT or API key protected)');
  } else {
    logger.warn('External User API router not mounted due to missing dependencies.');
  }

  // Mount the Referral Vault API router (Protected by JWT or API key)
  // Ensure longRunningApiClient is available for salt mining operations
  const referralVaultDependencies = {
    ...dependencies,
    longRunningApiClient: dependencies.longRunningApiClient
  };
  const referralVaultApi = createReferralVaultApi(referralVaultDependencies);
  if (referralVaultApi) {
    externalApiRouter.use('/referral-vault', authenticateUserOrApiKey, referralVaultApi);
    logger.info('External Referral Vault API router mounted at /referral-vault. (JWT or API key protected)');
  } else {
    logger.warn('External Referral Vault API router not mounted due to missing dependencies.');
  }

  // Models API (public but auth protected via dualAuth)
  const modelsApiRouter = createModelsApiRouter(dependencies);
  if (modelsApiRouter) {
    externalApiRouter.use('/models', dualAuth, modelsApiRouter);
    logger.info('External Models API router mounted at /models (JWT or API key protected)');
  } else {
    logger.warn('External Models API router not mounted due to missing dependencies.');
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
  const webhookRouter = createWebhookApi({
    ...dependencies,
    webSocketService: dependencies.webSocketService || (global.websocketServer || require('../../core/services/websocket/server'))
  });
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

  // --- Public: Supported Assets (no auth required) ---
  externalApiRouter.get('/points/supported-assets', async (req, res) => {
    try {
      const { getChainTokenConfig, getChainNftConfig, DEFAULT_FUNDING_RATE } = require('../../core/services/alchemy/tokenConfig');
      const chainId = String(req.query.chainId || '1');
      logger.info(`[ExternalAPI] /points/supported-assets (public) for chainId=${chainId}`);

      const tokensCfg = getChainTokenConfig(chainId) || {};
      const nftsCfg = getChainNftConfig(chainId) || {};

      const tokens = Object.entries(tokensCfg).map(([address, cfg]) => {
        const { fundingRate, symbol, iconUrl, decimals } = cfg || {};
        return { type: 'TOKEN', address, symbol, fundingRate: fundingRate ?? DEFAULT_FUNDING_RATE, iconUrl, decimals };
      });

      const nfts = Object.entries(nftsCfg)
        .filter(([, cfg]) => cfg && cfg.name)
        .map(([address, { fundingRate, name, iconUrl }]) => ({
          type: 'NFT',
          address,
          name,
          fundingRate,
          iconUrl: iconUrl || '/images/sandbox/components/nft-placeholder.png',
        }));

      // Debug preview
      console.log('[ExternalAPI] supported-assets preview:', {
        chainId,
        tokensLen: tokens.length,
        nftsLen: nfts.length,
        token0: tokens[0],
        nft0: nfts[0]
      });

      return res.json({ tokens, nfts, defaults: { tokenFundingRate: DEFAULT_FUNDING_RATE } });
    } catch (err) {
      logger.error('Failed to build supported-assets payload', err);
      return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  });

  // --- Public: Supported Chains (Foundation deployments) ---
  externalApiRouter.get('/points/supported-chains', (req, res) => {
    const { FOUNDATION_ADDRESSES } = require('../../core/services/alchemy/foundationConfig');
    const chains = Object.entries(FOUNDATION_ADDRESSES).map(([chainId, address]) => {
      const nameMap = { '1': 'Ethereum Mainnet', '11155111': 'Sepolia' };
      return { chainId, name: nameMap[chainId] || `Chain ${chainId}`, foundationAddress: address };
    });
    return res.json({ chains });
  });

  // Mount the Points API router (Protected by JWT or API Key)
  dependencies.internalApiClient = internalApiClient;
  const pointsRouter = createPointsApi({ internalApiClient, logger });
  if (pointsRouter) {
    externalApiRouter.use('/points', authenticateUserOrApiKey, pointsRouter);
    logger.info('External Points API router mounted at /points. (JWT or API key protected)');
  } else {
    logger.warn('External Points API router not mounted due to missing dependencies.');
  }

  // Mount the Rates API router (Public - no authentication required)
  const ratesRouter = createRatesApi({ internalApiClient, priceFeedService: dependencies.priceFeedService, logger });
  if (ratesRouter) {
    externalApiRouter.use('/economy', ratesRouter);
    logger.info('External Rates API router mounted at /economy. (Public access)');
  } else {
    logger.warn('External Rates API router not mounted due to missing dependencies.');
  }

  // Mount Datasets API (auth required)
  const datasetsApi = require('./datasetsApi');
  if (datasetsApi) {
    const dsRouter = datasetsApi(dependencies);
    if (dsRouter) {
      externalApiRouter.use('/datasets', dualAuth, dsRouter);
      logger.info('External Datasets API router mounted at /datasets.');
    }
  }
  // Mount Trainings API (auth required)
  const trainingsApi = require('./trainingsApi');
  if (trainingsApi) {
    const trRouter = trainingsApi(dependencies);
    if (trRouter) {
      externalApiRouter.use('/trainings', dualAuth, trRouter);
      logger.info('External Trainings API router mounted at /trainings.');
    }
  }

  // --- END public route ---

  // Mount the Spells API router (Protected by JWT or API key, with dualAuth for protected endpoints)
  const spellsRouter = createSpellsApi({
    ...dependencies,
    dualAuth,
  });
  if (spellsRouter) {
    externalApiRouter.use('/spells', spellsRouter);
    logger.info('External Spells API router mounted at /spells. (JWT or API key protected, dualAuth)');
  } else {
    logger.warn('External Spells API router not mounted due to missing dependencies.');
  }

  // Mount the Cook API router (JWT/API key protected)
  const cookApiRouter = createCookApiRouter(dependencies);
  if (cookApiRouter) {
    externalApiRouter.use('/', authenticateUserOrApiKey, cookApiRouter); // ensure req.user is populated
    logger.info('External Cook API router mounted (collections & cooks endpoints).');
  } else {
    logger.warn('External Cook API router not mounted due to missing dependencies.');
  }

  // Mount the Generation Execution API router (Protected by dualAuth)
  const generationExecutionRouter = createGenerationExecutionApi(dependencies);
  if (generationExecutionRouter) {
    externalApiRouter.use('/generation', dualAuth, generationExecutionRouter);
    logger.info('External Generation Execution API router mounted at /api/v1/generation/. (Dual Auth)');
  } else {
    logger.warn('External Generation Execution API router not mounted due to missing dependencies.');
  }

  // Mount Workspaces API (public GET, auth POST handled inside router)
  const workspacesRouter = createWorkspacesApiRouter(dependencies);
  if (workspacesRouter) {
    externalApiRouter.use('/', workspacesRouter);
    logger.info('External Workspaces API router mounted (GET public, POST auth via internal proxy).');
  } else {
    logger.warn('External Workspaces API router not mounted due to missing dependencies.');
  }

  logger.info('External API router initialized.');
  return externalApiRouter;
}

module.exports = { initializeExternalApi }; 