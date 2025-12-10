# VastAI Compute Service

This document explains how to bootstrap the new VastAI client/service layer.

## Files
- `src/config/vastai.js` – validates env vars and exposes `getVastAIConfig()`.
- `src/core/services/compute/ComputeProvider.js` – base interface for remote compute providers.
- `src/core/services/vastai/VastAIClient.js` – thin axios wrapper for VastAI REST endpoints.
- `src/core/services/vastai/VastAIService.js` – `ComputeProvider` implementation that orchestrates offers + rentals.
- `src/core/services/vastai/Vast.ai API.postman_collection.json` – official reference collection for manual testing.

## Usage
```js
const { VastAIService } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');

const vast = new VastAIService({
  logger: console,
  config: getVastAIConfig({ maxBidUsdPerHour: 3.5 })
});

(async () => {
  const offers = await vast.searchOffers({ minVramGb: 24 });
  console.log('Top offer:', offers[0]);

  const rental = await vast.provisionInstance({
    jobId: 'demo-job',
    offerId: offers[0].id,
    image: 'vastai/base-image:@vastai-automatic-tag',
    extraEnv: { PROVISIONING_SCRIPT: 'https://example.com/script.sh' },
    onstartCmd: 'entrypoint.sh'
  });

  console.log('Rental ready:', rental.instanceId, rental.publicIp);
  await vast.terminateInstance(rental.instanceId);
})();
```

For quick experiments without writing code, run `./run-with-env.sh node scripts/vastai/rent-instance.js --offer <id> --image <image> --env KEY=VALUE --onstart 'entrypoint.sh'` to mirror the official CLI flow.

## Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `VASTAI_API_KEY` | API key from https://vast.ai settings | **required** |
| `VASTAI_API_BASE_URL` | Override API base URL | `https://console.vast.ai/api/v0` |
| `VASTAI_SSH_KEY_PATH` | Path to private key used for rentals | **required** |
| `VASTAI_PREFERRED_GPUS` | Comma-separated gpu names (e.g., `4090,A100`) | `4090,A100` |
| `VASTAI_TEMPLATE_IDS` | Comma-separated template IDs allowed for jobs | none |
| `VASTAI_MAX_BID_PER_HOUR` | Ceiling USD/hr when bidding | `4.50` |
| `VASTAI_MIN_VRAM_GB` | Minimum VRAM filter for offer search | `24` |
| `VASTAI_DEFAULT_DISK_GB` | Disk allocation for new rentals | `64` |
| `VASTAI_DEFAULT_IMAGE` | Base image string when no template_id provided | `vastai/base-image:@vastai-automatic-tag` |

Set these in `.env.local.vastai` for dev or the deployment secret manager in prod.
