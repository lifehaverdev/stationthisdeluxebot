const express = require('express');
const { createLogger } = require('../../utils/logger');
const jwt = require('jsonwebtoken');

function createWorkspacesApiRouter(deps = {}) {
  const router = express.Router();
  const client = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalWorkspacesApi' }) : (deps.logger || console);

  if (!client) {
    logger.error('[ExternalWorkspacesApi] internalApiClient missing – router disabled');
    return null;
  }

  // Middleware to extract user from JWT cookie (optional for GET, required for POST)
  const extractUserFromJWT = (req, res, next) => {
    // For GET requests, user is optional (public workspaces)
    if (req.method === 'GET') {
      return next();
    }
    
    // For POST requests, try to extract user from JWT cookie
    const token = req.cookies?.jwt;
    if (token) {
      try {
        const jwtSecret = process.env.JWT_SECRET;
        if (jwtSecret) {
          const decoded = jwt.verify(token, jwtSecret);
          req.user = decoded;
          // Map userId from JWT to what internal API expects
          req.userId = decoded.userId || decoded.id;
        }
      } catch (err) {
        // JWT invalid or expired - will be handled by internal API
        logger.debug('[ExternalWorkspacesApi] JWT verification failed:', err.message);
      }
    }
    next();
  };

  router.use(extractUserFromJWT);

  // GET /api/v1/workspaces/:slug (public)
  router.get('/workspaces/:slug', async (req, res) => {
    try {
      const { data } = await client.get(`/internal/v1/data/workspaces/${encodeURIComponent(req.params.slug)}`);
      return res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('get workspace proxy error', err.response?.data || err.message);
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/workspaces (requires auth)
  router.post('/workspaces', async (req, res) => {
    try {
      // Extract userId from JWT if available
      const userId = req.userId || req.user?.userId || req.user?.id;
      
      // Pass userId in request body so internal API can use it
      const requestBody = {
        ...req.body,
        userId: userId || req.body.userId // Prefer JWT userId, fallback to body
      };
      
      const { data } = await client.post('/internal/v1/data/workspaces', requestBody);
      return res.status(201).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('create workspace proxy error', err.response?.data || err.message);
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  return router;
}

module.exports = createWorkspacesApiRouter;
