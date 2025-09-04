const express = require('express');
const { createLogger } = require('../../utils/logger');

function createWorkspacesApiRouter(deps = {}) {
  const router = express.Router();
  const client = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalWorkspacesApi' }) : (deps.logger || console);

  if (!client) {
    logger.error('[ExternalWorkspacesApi] internalApiClient missing – router disabled');
    return null;
  }

  // GET /api/v1/workspaces/:slug
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

  // POST /api/v1/workspaces
  router.post('/workspaces', async (req, res) => {
    try {
      const { data } = await client.post('/internal/v1/data/workspaces', req.body);
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
