// scripts/comfyui_api_utils/listModels.js
// Probe script that uses ModelDiscoveryService to fetch and classify models.
// Usage:
//   ./run-with-env.sh node scripts/comfyui_api_utils/listModels.js [category]
// If a category arg is supplied (checkpoint, lora, upscale, tagger, embedding, vae)
// the script lists only that category.

const ComfyUIService = require('../../src/core/services/comfydeploy/comfyui');
const ModelDiscoveryService = require('../../src/core/services/comfydeploy/modelDiscoveryService');

const API_KEY = process.env.COMFY_DEPLOY_API_KEY;
if (!API_KEY) {
  console.error('COMFY_DEPLOY_API_KEY env var required');
  process.exit(1);
}

(async () => {
  const comfy = new ComfyUIService({ logger: console });
  const discovery = new ModelDiscoveryService({ comfyService: comfy });

  const requestedCategory = process.argv[2]; // optional CLI arg
  const models = await discovery.listModels({ category: requestedCategory });

  if (!requestedCategory) {
    // Group counts
    const counts = models.reduce((acc, m) => {
      const cat = (m.type || '').toLowerCase().includes('lora') ? 'lora'
                : (m.type || '').toLowerCase().includes('checkpoint') ? 'checkpoint'
                : /upscale/i.test(m.type || m.save_path || '') ? 'upscale'
                : /tagger/i.test(m.type || m.save_path || '') ? 'tagger'
                : /embedding/i.test(m.type || m.save_path || '') ? 'embedding'
                : /vae/i.test(m.type || m.save_path || '') ? 'vae'
                : 'other';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {});
    console.log('Category counts:');
    Object.entries(counts).forEach(([c, n]) => console.log(`  • ${c}: ${n}`));
  }

  console.log(`\nsome ${requestedCategory || 'all'} models:`);
  console.dir(models.slice(200, 300), { depth: 3, colors: true });
})(); 