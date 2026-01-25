# VastAI GPU Training Service

Remote GPU training via VastAI marketplace. Handles the full lifecycle: provisioning instances, running LoRA training, uploading to HuggingFace/ComfyDeploy, and cleanup.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Production Server                         │
├─────────────────────────────────────────────────────────────────┤
│  hyperbotcontained (main app)                                   │
│    └─ Accepts training requests, queues jobs in MongoDB         │
│                                                                 │
│  hyperbottraining (training worker)                             │
│    └─ Polls for QUEUED jobs, runs TrainingJobProcessor          │
│    └─ Integrated InstanceSweeper (5 min interval)               │
│                                                                 │
│  hyperbotsweeper (safety net)                                   │
│    └─ Runs instanceSweeper.js every 15 min                      │
│    └─ Catches orphans if worker crashes                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ SSH + VastAI API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      VastAI GPU Instance                         │
├─────────────────────────────────────────────────────────────────┤
│  - ai-toolkit training environment                              │
│  - Dataset synced via rsync                                     │
│  - Model uploaded to HuggingFace                                │
│  - Samples generated and uploaded                               │
└─────────────────────────────────────────────────────────────────┘
```

## Training Flow

1. **Job Queued** - User requests training via bot/web
2. **Job Claimed** - Worker picks up job, charges credits upfront
3. **Instance Provisioned** - VastAI GPU rented with SSH key
4. **Dataset Synced** - Images rsync'd to instance
5. **Training Runs** - ai-toolkit LoRA training (background mode with progress polling)
6. **Model Uploaded** - Safetensors pushed to HuggingFace
7. **Samples Generated** - Test images created with trained LoRA
8. **ComfyDeploy Updated** - LoRA registered for inference
9. **Instance Terminated** - GPU released, costs tracked
10. **Job Completed** - User notified

## Key Files

### Services
| File | Purpose |
|------|---------|
| `src/core/services/vastai/VastAIService.js` | GPU rental orchestration |
| `src/core/services/vastai/VastAIClient.js` | VastAI REST API wrapper |
| `src/core/services/vastai/InstanceSweeper.js` | Orphan instance detection/cleanup |
| `src/core/services/vastai/TrainingRunner.js` | SSH command execution for training |
| `src/core/services/vastai/TrainingMonitor.js` | Progress tracking and stall detection |
| `src/core/services/vastai/TrainingOutputParser.js` | Parse tqdm/training output |
| `src/core/services/vastai/StallDetector.js` | Detect stuck training |
| `src/core/services/training/TrainingJobProcessor.js` | End-to-end job orchestration |
| `src/core/services/training/DatasetValidator.js` | Validate dataset before training |

### Workers
| File | Purpose |
|------|---------|
| `scripts/workers/vastaiTrainingWorker.js` | Main worker process (polls jobs) |
| `scripts/workers/instanceSweeper.js` | Standalone sweeper (safety net) |

### Scripts
| File | Purpose |
|------|---------|
| `scripts/vastai/launch-training.js` | CLI for manual training runs |
| `scripts/vastai/cleanup-instances.js` | Manual orphan cleanup |
| `scripts/vastai/validate-dataset.js` | Check dataset before training |
| `scripts/setup/setup-vastai-ssh-key.sh` | Generate SSH keypair for VastAI |

### Configs
| File | Purpose |
|------|---------|
| `src/config/vastai.js` | Environment config loader |
| `src/core/services/vastai/configs/*.yaml` | Training configs (FLUX LoRA) |

## Environment Variables

### Required
```bash
VASTAI_API_KEY=xxx                    # From https://cloud.vast.ai/account/
VASTAI_SSH_KEY_PATH=/path/to/key      # Private key (public must be on VastAI)
```

### Optional
```bash
VASTAI_API_BASE_URL=https://console.vast.ai/api/v0
VASTAI_PREFERRED_GPUS=4090,A100       # GPU preference order
VASTAI_MAX_BID_PER_HOUR=4.50          # Max $/hr for GPU rental
VASTAI_MIN_VRAM_GB=24                 # Minimum VRAM filter
VASTAI_DEFAULT_DISK_GB=64             # Disk allocation
```

## Setup

### 1. Generate SSH Key
```bash
./scripts/setup/setup-vastai-ssh-key.sh
```

### 2. Add Key to VastAI
- Go to https://cloud.vast.ai/account/
- Scroll to "SSH Keys" section
- Add the public key from `~/.ssh/vastai/vastai_ed25519.pub`

### 3. Configure Environment
Add to `.env`:
```bash
VASTAI_API_KEY=your-api-key
VASTAI_SSH_KEY_PATH=/home/user/.ssh/vastai/vastai_ed25519
```

### 4. Deploy
```bash
# First deploy with training support
DEPLOY_TRAINING_WORKER=1 ./deploy.sh

# Subsequent deploys (training containers keep running)
./deploy.sh

# Rebuild training containers
DEPLOY_TRAINING_WORKER=1 ./deploy.sh
```

## Local Development

```bash
# Run all services locally
./run-dev-training.sh

# Manual training run
./run-with-env.sh node scripts/vastai/launch-training.js \
  --dataset /path/to/images \
  --name "my-lora" \
  --trigger "mylora" \
  --steps 4000
```

## Monitoring & Cleanup

### Check Running Instances
```bash
node scripts/vastai/cleanup-instances.js          # Dry run
node scripts/vastai/cleanup-instances.js --force  # Terminate orphans
node scripts/vastai/cleanup-instances.js --all    # Nuclear: terminate ALL
```

### Check SSH Keys
```bash
node scripts/vastai/check-keys.js
```

## Safety Features

### Prepaid Model
Credits charged upfront before provisioning. Failed jobs get partial refunds.

### Two-Tier Timeouts
- **Soft timeout**: Alert ops, continue training
- **Hard timeout**: Force terminate instance

### Instance Sweeper
Runs every 5 minutes (in worker) + 15 minutes (standalone safety net):
- Detects completed/failed jobs with running instances
- Detects stuck jobs (no progress for 2+ hours)
- Detects orphan instances (no training record)
- Max runtime limit (4 hours)

### Stall Detection
Monitors training progress. Alerts if no step advancement for extended period.

## Training Configuration

Default FLUX LoRA settings (`configs/flux-lora-24gb-aitoolkit.yaml`):
- Steps: 4000
- Learning rate: 0.0001
- LoRA rank: 32
- LoRA alpha: 32
- Dropout: 0.05
- Save every: 250 steps

## Troubleshooting

### Instance won't terminate
```bash
node scripts/vastai/cleanup-instances.js --all
```

### Training stuck
Check logs in MongoDB `loraTrainings` collection. The sweeper will auto-terminate after 2 hours of no progress.

### SSH connection failed
1. Verify key is registered: `node scripts/vastai/check-keys.js`
2. Check `VASTAI_SSH_KEY_PATH` points to correct private key
3. Ensure public key is on VastAI dashboard

### No GPU offers found
- Check VASTAI_MAX_BID_PER_HOUR (increase if needed)
- Try different GPU types in VASTAI_PREFERRED_GPUS
- Check VastAI marketplace availability
