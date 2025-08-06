// scripts/comfyui_api_utils/listModels.js
// Probe script that calls the Comfy-Deploy private-models endpoint and prints stats.
// Usage:
//   ./run-with-env.sh node scripts/comfyui_api_utils/listModels.js [category]
// If a category arg is supplied (checkpoint, lora, upscale, tagger, embedding, vae)
// the script filters the list locally before printing.

const axios = require('axios');

const API_KEY = process.env.COMFY_DEPLOY_API_KEY;
if (!API_KEY) {
  console.error('COMFY_DEPLOY_API_KEY env var required');
  process.exit(1);
}

const PRIVATE_MODELS_URL = 'https://api.comfydeploy.com/api/volume/private-models';

(async () => {
  const requestedCategory = process.argv[2]; // optional CLI arg

  try {
    console.log(`Fetching models from ${PRIVATE_MODELS_URL} …`);
    const { data } = await axios.get(PRIVATE_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      // Increase default timeout – listing can be large
      timeout: 30_000,
    });

    if (!Array.isArray(data)) {
      console.error('Unexpected response shape – expected an array but got:', typeof data);
      console.dir(data, { depth: 4, colors: true });
      process.exit(1);
    }

    let models = data;
    // Unified helper to detect a category from a model record
    const detectCategory = (m) => {
      const haystack = `${m.type || ''} ${m.category || ''} ${m.save_path || ''} ${m.folder_path || ''} ${m.folderPath || ''} ${m.path || ''}`.toLowerCase();
      if (/\bloras?\b/.test(haystack)) return 'lora';
      if (/checkpoints?/.test(haystack)) return 'checkpoint';
      if (/upscalers?|upscale/.test(haystack)) return 'upscale';
      if (/taggers?/.test(haystack)) return 'tagger';
      if (/embeddings?/.test(haystack)) return 'embedding';
      if (/\bvae(s)?\b/.test(haystack)) return 'vae';
      return 'other';
    };

    if (requestedCategory) {
      const cat = requestedCategory.toLowerCase();
      models = data.filter((m) => detectCategory(m) === cat);
    }

    console.log(`Total models returned: ${data.length}`);
    if (requestedCategory) {
      console.log(`Filtered models (${requestedCategory}): ${models.length}`);
    } else {
      // Group counts by category using the helper
      const counts = data.reduce((acc, m) => {
        const cat = detectCategory(m);
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});
      console.log('Category counts:');
      Object.entries(counts).forEach(([c, n]) => console.log(`  • ${c}: ${n}`));
    }

    if (requestedCategory) {
      console.log(`\nListing all ${requestedCategory} models:`);
      console.dir(models, { depth: 3, colors: true });
    } else {
      console.log(`\nSample all models:`);
      console.dir(models.slice(0, 20), { depth: 3, colors: true });
    }
  } catch (err) {
    console.error('Error fetching models:');
    if (err.response) {
      console.error(`Status ${err.response.status}`);
      console.dir(err.response.data, { depth: 4, colors: true });
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
})(); 