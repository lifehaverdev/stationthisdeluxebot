const express = require('express');

/**
 * External Models API Router
 * LoRA routes use LoraService directly; checkpoint/model routes still proxy via internalApiClient.
 * Requires `internalApiClient` and `loraService` in dependencies.
 */
module.exports = function createModelsApiRouter(deps = {}) {
  const { internalApiClient, loraService, modelDiscoveryService, logger = console } = deps;
  if (!internalApiClient) {
    logger.error('[external-modelsApi] Missing internalApiClient dependency.');
    return express.Router().get('*', (_, res) => res.status(503).json({ error: 'Service unavailable' }));
  }

  const router = express.Router();

  // Helper to merge userId into params when available
  const withUserId = (req)=>{
    const params={...req.query};
    if(!params.userId && req.user?.userId) params.userId = req.user.userId;
    return params;
  };

  const resolvedUserId = (req) => req.body?.userId || req.user?.userId || null;

  // GET /models => fetch from internal API
  router.get('/', async (req, res) => {
    try {
      const response = await internalApiClient.get('/internal/v1/data/models', {
        params: withUserId(req),
      });
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] Proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to fetch model list' });
    }
  });

  // GET /models/stats – compute stats in-process via ModelDiscoveryService + LoraService
  router.get('/stats', async (_req, res) => {
    try {
      const classify = (m) => {
        const s = `${m.type || ''} ${m.category || ''} ${m.save_path || ''} ${m.path || ''}`.toLowerCase();
        if (/\bloras?\b/.test(s)) return 'lora';
        if (/checkpoints?/.test(s)) return 'checkpoint';
        if (/upscalers?|upscale/.test(s)) return 'upscale';
        if (/taggers?/.test(s)) return 'tagger';
        if (/embeddings?/.test(s)) return 'embedding';
        if (/\bvae(s)?\b/.test(s)) return 'vae';
        return 'other';
      };
      const [models, loras] = await Promise.all([
        modelDiscoveryService ? modelDiscoveryService.listModels({ includeWorkflowEnums: false }) : [],
        loraService ? loraService.listLoras({ limit: 1, page: 1 }) : { pagination: { totalLoras: 0 } },
      ]);
      const loraCount = loras.pagination?.totalLoras || 0;
      const combined = [...models, ...Array(loraCount).fill({ category: 'lora' })];
      const counts = combined.reduce((acc, m) => {
        const cat = classify(m);
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});
      res.json({ counts, total: models.length });
    } catch (err) {
      logger.error('[external-modelsApi] Stats error:', err.message);
      res.status(500).json({ error: 'Failed to fetch model stats' });
    }
  });

  // ---------- LoRA routes (Phase 6b — use LoraService directly) ----------

  // GET /models/lora -> list LoRAs
  router.get('/lora', async (req, res) => {
    try {
      if (!loraService) {
        logger.error('[external-modelsApi] loraService missing for GET /lora');
        return res.status(503).json({ error: 'Service unavailable' });
      }
      const params = withUserId(req);
      const result = await loraService.listLoras({
        userId: params.userId,
        checkpoint: params.checkpoint,
        q: params.q,
        category: params.category,
        tag: params.tag,
        filterType: params.filterType,
        sort: params.sort,
        page: params.page,
        limit: params.limit,
        includeCivitaiTags: params.includeCivitaiTags === 'true',
      });
      res.json(result);
    } catch (err) {
      logger.error('[external-modelsApi] LoRA list error:', err.message);
      const status = err.statusCode || 500;
      res.status(status).json({ error: 'Failed to fetch LoRA list' });
    }
  });

  // GET /models/lora/categories -> distinct categories
  router.get('/lora/categories', async (_req, res) => {
    try {
      if (!loraService) return res.status(503).json({ error: 'Service unavailable' });
      const categories = await loraService.getCategories();
      res.json({ categories });
    } catch (err) {
      logger.error('[external-modelsApi] LoRA categories error:', err.message);
      res.status(500).json({ error: 'Failed to fetch LoRA categories' });
    }
  });

  // GET /models/lora/:id -> detail
  router.get('/lora/:id', async (req, res) => {
    try {
      if (!loraService) return res.status(503).json({ error: 'Service unavailable' });
      const { userId, isAdmin } = req.query;
      const lora = await loraService.getById(req.params.id, { userId, isAdmin: isAdmin === 'true' });
      if (!lora) return res.status(404).json({ error: 'LoRA not found.' });
      res.json({ lora });
    } catch (err) {
      logger.error('[external-modelsApi] LoRA detail error:', err.message);
      const status = err.statusCode || 500;
      res.status(status).json({ error: 'Failed to fetch LoRA detail' });
    }
  });

  // POST /models/lora/import
  router.post('/lora/import', async (req, res) => {
    try {
      if (!loraService) return res.status(503).json({ error: 'Service unavailable' });
      const userId = resolvedUserId(req);
      const url = req.body?.url;
      if (!url || !userId) {
        return res.status(400).json({ error: 'url and userId required' });
      }
      const result = await loraService.importFromUrl(url, userId);
      res.status(202).json({ message: 'LoRA submitted successfully for admin review!', lora: result });
    } catch (err) {
      logger.error('[external-modelsApi] LoRA import error:', err.message);
      const status = err.statusCode || 500;
      res.status(status).json({ error: 'LoRA import failed', details: err.message });
    }
  });

  // POST /models/lora/:id/tag
  router.post('/lora/:id/tag', async (req, res) => {
    try {
      if (!loraService) return res.status(503).json({ error: 'Service unavailable' });
      const userId = resolvedUserId(req);
      const { tag } = req.body;
      if (!tag || !userId) return res.status(400).json({ error: 'tag and userId required' });
      const result = await loraService.addTag(req.params.id, tag, userId);
      res.json(result);
    } catch(err){
      const status = err.statusCode || 500;
      res.status(status).json({ error: 'tag failed', details: err.message });
    }
  });

  // POST /models/lora/:id/rate
  router.post('/lora/:id/rate', async (req, res) => {
    try {
      if (!loraService) return res.status(503).json({ error: 'Service unavailable' });
      const userId = resolvedUserId(req);
      const { stars } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const result = await loraService.addRating(req.params.id, stars, userId);
      res.json(result);
    } catch(err){
      const status = err.statusCode || 500;
      res.status(status).json({ error: 'rate failed', details: err.message });
    }
  });

  // POST /models/checkpoint/import
  router.post('/checkpoint/import', async (req, res) => {
    try {
      const body = { ...req.body };
      if (!body.userId && req.user?.userId) body.userId = req.user.userId;
      const csrfToken = req.headers['x-csrf-token'];
      const response = await internalApiClient.post('/internal/v1/data/models/checkpoint/import', body, { headers:{'x-csrf-token':csrfToken} });
      res.json(response.data);
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).json({ error:'Checkpoint import failed', details: err.response?.data||err.message });
    }
  });

  return router;
};
