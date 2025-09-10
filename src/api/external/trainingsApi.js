const express = require('express');

/**
 * External Trainings API Router
 * Proxies requests to the internal trainings API layer.
 * Requires an `internalApiClient` injected in dependencies.
 */
module.exports = function createTrainingsApiRouter(deps = {}) {
  const router = express.Router();
  const client = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalTrainingsApi' }) : (deps.logger || console);

  if (!client) {
    logger.error('[ExternalTrainingsApi] internalApiClient missing – router disabled');
    return null;
  }

  // GET / -> list trainings for current user
  router.get('/', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { data } = await client.get(`/internal/v1/data/trainings/owner/${encodeURIComponent(ownerId)}`);
      res.json({ trainings: data });
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('list trainings proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /:id -> get training detail
  router.get('/:id', async (req, res) => {
    try {
      const { data } = await client.get(`/internal/v1/data/trainings/${encodeURIComponent(req.params.id)}`);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('get training proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST / -> create training
  router.post('/', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.post('/internal/v1/data/trainings', payload);
      res.status(201).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('create training proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  return router;
};
