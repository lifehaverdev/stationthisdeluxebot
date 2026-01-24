# VastAI Development Scripts

> **Parent Service:** `src/core/services/vastai/`
> **Documentation:** `src/core/services/vastai/notes/`

These scripts are development and testing tools for the VastAI GPU rental system.
They are NOT production code - they're stepping stones for manual testing and validation.

## Quick Start

```bash
# Validate dataset before upload
node scripts/vastai/validate-dataset.js -d .stationthis/datasets/test/

# Run full training (provision → upload → train → report)
./run-with-env.sh node scripts/vastai/launch-training.js \
  --datasetDir .stationthis/datasets/test/ \
  --region US \
  --gpu 4090 \
  --steps 2000

# Or: provision + upload + drop into shell (for manual testing)
./run-with-env.sh node scripts/vastai/launch-session.js \
  --datasetDir .stationthis/datasets/test/ \
  --region US \
  --gpu 4090

# List available GPU offers
./run-with-env.sh node scripts/vastai/offers.js

# See GPU availability by region
./run-with-env.sh node scripts/vastai/list-regions.js
```

## Scripts

| Script | Purpose |
|--------|---------|
| `launch-training.js` | **Training runner** - provisions GPU, uploads dataset, runs training, reports results |
| `launch-session.js` | Interactive test - provisions GPU, uploads dataset, opens SSH shell |
| `validate-dataset.js` | Validate dataset before packing (image count, caption pairing) |
| `offers.js` | List available GPU offers with pricing |
| `select-offer.js` | Auto-select best offer matching criteria |
| `rent-instance.js` | Provision a single instance |
| `list-regions.js` | Show GPU availability by region |
| `push-dataset.js` | Upload dataset to existing instance |
| `pull-dataset.js` | Download dataset from instance |
| `render-config.js` | Template training config with variables |
| `templates.js` | List available VastAI templates |
| `check-keys.js` | Verify SSH key configuration |

## Related Files

- **Service Code:** `src/core/services/vastai/`
- **SSH Transport:** `src/core/services/remote/SshTransport.js`
- **Training Configs:** `src/core/services/vastai/configs/`
- **Documentation:** `src/core/services/vastai/notes/`

## Environment Variables

Required in `.env`:
```
VASTAI_API_KEY=<your-api-key>
VASTAI_SSH_KEY_PATH=/path/to/ssh/private/key
```

The SSH public key must also be registered in the VastAI dashboard.
