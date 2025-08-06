const express = require('express');
const ModelDiscoveryService = require('../../../core/services/comfydeploy/modelDiscoveryService');

/**
 * Internal Models API
 * Provides cached lists of Comfy model assets (checkpoints, LoRAs, etc.)
 * @param {Object} deps - injected dependencies from internal API initializer
 * @param {Object} deps.logger - logger instance
 * @param {ComfyUIService} deps.comfyUIService - initialised ComfyUI service
 * @returns {express.Router}
 */
module.exports = function createModelsApiRouter(deps = {}) {
  const { logger = console, comfyUIService } = deps;
  if (!comfyUIService) {
    logger.error('[modelsApi] Missing comfyUIService dependency.');
    return express.Router().get('*', (_, res) => res.status(503).json({ error: 'Service unavailable' }));
  }

  const router = express.Router();
  const discovery = new ModelDiscoveryService({ comfyService: comfyUIService });

  /**
   * GET /
   * Optional query params:
   *   - category: checkpoint | lora | upscale | tagger | embedding | vae
   */
  router.get('/', async (req, res) => {
    const category = req.query.category;
    try {
      const models = await discovery.listModels({ category });
      res.json({ models });
    } catch (err) {
      logger.error('[modelsApi] listModels error:', err);
      res.status(500).json({ error: 'Failed to fetch model list' });
    }
  });

  /**
   * GET /stats – returns count per category for quick summaries
   */
  router.get('/stats', async (_req, res) => {
    try {
      const models = await discovery.listModels();
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
      const counts = models.reduce((acc, m) => {
        const cat = classify(m);
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});
      res.json({ counts, total: models.length });
    } catch (err) {
      logger.error('[modelsApi] stats error:', err);
      res.status(500).json({ error: 'Failed to compute stats' });
    }
  });

  return router;
}; 