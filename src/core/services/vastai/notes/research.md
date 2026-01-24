# VastAI Research Notes

> Historical research from initial spike. Most of this has been implemented.
> See `progress.md` for current status and `outline.md` for architecture.

## Inputs We Already Have
- **API Collection**: `src/core/services/vastai/Vast.ai API.postman_collection.json`
  - Includes offer search, instance lifecycle, key management, and metrics endpoints from the official Postman workspace.
  - Import into Postman (or Insomnia) to iterate on requests without re-copying definitions.
- **SSH Keypair**: Configure via `VASTAI_SSH_KEY_PATH` env var
  - Private key stays on the worker host
  - Public key must be uploaded to VastAI Keys dashboard

## Research Findings

### Endpoint Coverage for MVP
For flux training, we use the ostris/aitoolkit template. Requirements:
- Need at least a 24GB GPU
- Want market price best offer while ensuring reliable machine
- Instance endpoint provides quotes for search

### Auth Mechanics
- Header: `Authorization: Bearer <API_KEY>`
- Rate limiting: generous for normal usage, exponential backoff handles edge cases

### Template Strategy
- Using ostris/aitoolkit template for Flux training
- Template provides PyTorch + CUDA environment
- Each training type may need its own template in future

### Disk Sizing
- Minimum 32GB recommended to fit:
  - Base models
  - Dataset
  - Output checkpoints
  - Working space

### Stop vs Delete
- Delete is preferred since we typically connect to a NEW instance each time
- Avoids paying for idle instances
- Clean slate for each job

### Lifecycle Timing (Observed)
1. Provision request → instance created: ~5-10 seconds
2. Status "running": ~30-60 seconds after creation
3. SSH port open: ~30-60 seconds after "running"
4. SSH auth ready: ~10-20 seconds after port open
5. Total cold start: ~2-3 minutes

## Environment Variables Required
```
VASTAI_API_KEY=<your-api-key>
VASTAI_SSH_KEY_PATH=/path/to/private/key
```

## Optional Configuration
```
# In config/vastai.js
preferredGpuTypes: ['RTX 4090', 'RTX 3090']
minVramGb: 24
maxHourlyUsd: 1.00
defaultDiskGb: 50
```
