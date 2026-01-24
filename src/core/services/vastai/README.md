# VastAI GPU Rental Service

On-demand GPU rental orchestration for AI model training via [Vast.ai](https://vast.ai/).

## Overview

This service provides:
- GPU offer discovery and selection
- Instance provisioning with SSH key injection
- Instance lifecycle management (start, stop, terminate)
- API response normalization (VastAI has inconsistent field names)

## Directory Structure

```
src/core/services/vastai/
├── README.md           # This file
├── VastAIService.js    # Core orchestration service
├── VastAIClient.js     # HTTP client with retry logic
├── VastAIError.js      # Error class
├── index.js            # Exports
├── configs/            # Training config templates
│   └── flux-lora-*.yml
└── notes/              # Documentation
    ├── outline.md      # Architecture & vision
    ├── progress.md     # Current status & learnings
    └── research.md     # Research notes
```

## Related Code

| Location | Purpose |
|----------|---------|
| `src/core/services/remote/SshTransport.js` | SSH/SCP file transfer |
| `src/core/services/training/DatasetPacker.js` | Dataset packaging |
| `scripts/vastai/` | Development/testing scripts |
| `src/config/vastai.js` | Configuration |

## Quick Start

```javascript
const { VastAIService } = require('./src/core/services/vastai');

const service = new VastAIService({ logger: console });

// Search for GPU offers
const offers = await service.searchOffers({
  gpuType: '4090',
  region: 'US',
  maxHourlyUsd: 1.00
});

// Provision an instance
const instance = await service.provisionInstance({
  offerId: offers[0].id,
  jobId: 'my-training-job'
});

// Get status
const status = await service.getInstanceStatus(instance.instanceId);
console.log(`SSH: ${status.sshHost}:${status.sshPort}`);

// Clean up
await service.terminateInstance(instance.instanceId);
```

## Environment Variables

```
VASTAI_API_KEY=<your-api-key>
VASTAI_SSH_KEY_PATH=/path/to/ssh/private/key
```

## Documentation

See `notes/` directory:
- `outline.md` - Architecture, milestones, acceptance criteria
- `progress.md` - Current status, debugging learnings, next steps
- `research.md` - Initial research notes

## API Quirks

VastAI's API has inconsistent field names. This service normalizes them.
See the header comment in `VastAIService.js` for details.
