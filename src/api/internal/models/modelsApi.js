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
      if (category && category.toLowerCase() === 'lora' && deps.db && deps.db.loraModels) {
        const loras = await deps.db.loraModels.findPublicModels();
        const mapped = loras.map(l => ({
          name: l.name,
          slug: l.slug,
          category: 'lora',
          source: 'database'
        }));
        return res.json({ models: mapped });
      }

      const modelsRaw = await discovery.listModels({ category, includeWorkflowEnums: false });
      let models = modelsRaw;

      // --- NEW: optional civitai tag filtering -----------------------------------
      const includeCivitai = String(req.query.includeCivitaiTags || '').toLowerCase() === 'true';
      if (!includeCivitai) {
        models = models.map(m=>{
          if(!Array.isArray(m.tags)) return m;
          const clean = m.tags.filter(t=>{
            if(typeof t === 'string') return true;
            return (t.source||'').toLowerCase() !== 'civitai';
          });
          return { ...m, tags: clean };
        });
      }

      if (category) {
        const cat = category.toLowerCase();
        const pathMap = {
          checkpoint: 'checkpoints/',
          upscale: 'upscale_models/',
          embedding: 'embeddings/',
          vae: 'vae/',
          controlnet: 'controlnet/',
          clipseg: 'clipseg/'
        };
        if (pathMap[cat]) {
          models = models.filter(m => {
            const p = (m.path || m.save_path || '').toString().toLowerCase();
            return p.includes(pathMap[cat]) && /\.safetensors$/i.test(p);
          });
          // dedupe
          const seen = new Set();
          models = models.filter(m => { const p = m.path || m.save_path; if (seen.has(p)) return false; seen.add(p); return true; });
        }
      }
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
      const [models, loras] = await Promise.all([
        discovery.listModels({ includeWorkflowEnums: false }),
        deps.db && deps.db.loraModels ? deps.db.loraModels.findPublicModels() : []
      ]);
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
      const combined = [...models, ...loras.map(l => ({ category: 'lora' }))];
      const counts = combined.reduce((acc, m) => {
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