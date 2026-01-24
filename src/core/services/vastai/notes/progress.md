# VastAI Implementation Progress

**Last Updated:** 2026-01-22

> **Related Files:**
> - `../VastAIService.js` - Core service with API normalization
> - `../VastAIClient.js` - HTTP client with retry logic
> - `../../remote/SshTransport.js` - SSH/SCP wrapper
> - `scripts/vastai/launch-session.js` - End-to-end testing script

---

## 🎉 FULL TRAINING PIPELINE VALIDATED (2026-01-22)

**The complete end-to-end remote training pipeline is now production-ready.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STATIONTHIS REMOTE TRAINING PIPELINE                     │
│                              ✅ FULLY OPERATIONAL                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Dataset      GPU Rental     Training      Sample Gen     HuggingFace     │
│   ┌─────┐      ┌─────┐       ┌─────┐       ┌─────┐        ┌─────┐         │
│   │ ✅  │ ───► │ ✅  │ ───► │ ✅  │ ───► │ ✅  │ ───►  │ ✅  │         │
│   └─────┘      └─────┘       └─────┘       └─────┘        └─────┘         │
│   Validate     VastAI        ai-toolkit    4 JPG samples  Model + README   │
│   + Pack       RTX 3090/4090 FLUX LoRA     at final step  + Sample Grid    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What We Built
| Component | Status | Description |
|-----------|--------|-------------|
| Dataset Validation | ✅ | 10+ images, caption pairing, orphan detection |
| GPU Provisioning | ✅ | Auto-select best offer, retry on snatch, SSH wait |
| Training Execution | ✅ | ai-toolkit FLUX LoRA, progress parsing, loss tracking |
| Sample Generation | ✅ | 4 samples at final step, JPG format, captions as prompts |
| HuggingFace Upload | ✅ | Repo creation, README with grid, safetensors via LFS |
| Instance Cleanup | ✅ | Auto-terminate after successful training |

### Validated Models on HuggingFace
- **First model**: https://huggingface.co/ms2stationthis/hffinal_miladyii_30
- **With samples**: https://huggingface.co/ms2stationthis/sampletest3_miladyii_30

### Single Command to Train & Publish
```bash
./run-with-env.sh node scripts/vastai/launch-training.js \
  --datasetDir .stationthis/datasets/mydata \
  --trigger mytrigger --modelName mymodel \
  --steps 2000 --hfUpload --region US
```

**Cost**: ~$0.17-0.55/hr on RTX 3090/4090. A 2000-step training run costs approximately $0.50-2.00.

---

## What Works Now
- VastAI client/service can search offers, rent instances, and recover instance IDs even when the API omits `new_contract` (fallback to label lookup).
- CLI helpers (`offers.js`, `select-offer.js`, `rent-instance.js`) let us explore the market, auto-pick the best GPU, and provision a server with Ostris env vars pre-filled.
- SSH key management is wired through env (`VASTAI_SSH_KEY_PATH`) and enforced before provisioning.
- **Fractional GPU filtering** - Automatically excludes offers with `gpu_frac < 1.0` to avoid shared GPU OOM issues.
- **`launch-session.js` now works end-to-end** (as of 2026-01-21): provisions GPU, waits for SSH, uploads dataset, extracts, uploads config, and can drop into interactive shell.
- **Dataset validation** (as of 2026-01-21): `DatasetValidator` class + `validate-dataset.js` CLI validates datasets before packing. Checks: 10+ images required, caption files must have matching images (no orphans), warns if images lack captions.
- **Training runner** (as of 2026-01-21): `TrainingRunner` class + `launch-training.js` CLI can start training and parse output. Supports foreground (wait for completion) and background modes. Parses step progress, loss values, checkpoints saved, errors, and ETA calculations.
- **FULL TRAINING VALIDATED** (2026-01-21): End-to-end training tested on RTX 4090 - 30 steps completed, checkpoints saved (~165MB each), loss tracked throughout. Uses `ostris/aitoolkit` image with `HF_TOKEN` passed via `extraEnv`.
- **Monitoring system validated** (2026-01-21): `--watch` mode shows real-time progress, loss, speed, ETA. Stall detection working. Parser handles ai-toolkit tqdm output patterns.
- **HuggingFace integration VALIDATED** (2026-01-21): `--hfUpload` flag enables full end-to-end HuggingFace publishing. Pre-generates README before training (using OpenAI for descriptions or fallback), creates HF repo, and uploads safetensors from remote instance via `huggingface-cli` (handles LFS automatically). First successful upload: https://huggingface.co/ms2stationthis/hffinal_miladyii_30
- **Sample image pipeline VALIDATED** (2026-01-22): Generates 4 sample images at final training step using dataset captions as prompts. Samples uploaded to HF `samples/` folder with 2x2 grid in README. ai-toolkit outputs JPG format. First model with samples: https://huggingface.co/ms2stationthis/sampletest3_miladyii_30

## Tooling Inventory

| Tool | Location | Purpose |
|------|----------|---------|
| `VastAIService` | `src/core/services/vastai/VastAIService.js` | Core orchestration: search, provision, terminate |
| `VastAIClient` | `src/core/services/vastai/VastAIClient.js` | HTTP client with retry/backoff |
| `SshTransport` | `src/core/services/remote/SshTransport.js` | SSH command exec + SCP file transfer |
| `TrainingRunner` | `src/core/services/vastai/TrainingRunner.js` | Execute training jobs, parse output, manage checkpoints |
| `TrainingOutputParser` | `src/core/services/vastai/TrainingOutputParser.js` | Parse training logs for step/loss/ETA extraction |
| `TrainingMonitor` | `src/core/services/vastai/TrainingMonitor.js` | Polling/streaming monitoring with stall detection |
| `StallDetector` | `src/core/services/vastai/StallDetector.js` | Asymptotic ETA trend analysis for stall detection |
| `TrainingNotifier` | `src/core/services/notifications/TrainingNotifier.js` | Alert routing: Telegram → Discord → web |
| `DatasetPacker` | `src/core/services/training/DatasetPacker.js` | Pack images + manifest into tarball |
| `DatasetValidator` | `src/core/services/training/DatasetValidator.js` | Validate dataset before packing |
| `ModelCardGenerator` | `src/core/services/training/ModelCardGenerator.js` | Generate HuggingFace README from captions + OpenAI |
| `HuggingFaceHubService` | `src/core/services/huggingface/HuggingFaceHubService.js` | HuggingFace repo creation and file uploads |
| `launch-training.js` | `scripts/vastai/launch-training.js` | Full training: rent → upload → train → report → HF upload |
| `launch-session.js` | `scripts/vastai/launch-session.js` | Interactive test: rent → upload → shell |
| `validate-dataset.js` | `scripts/vastai/validate-dataset.js` | CLI for dataset validation |
| `list-regions.js` | `scripts/vastai/list-regions.js` | See GPU availability by region |
| `offers.js` | `scripts/vastai/offers.js` | List available GPU offers |
| `render-config.js` | `scripts/vastai/render-config.js` | Template training config with variables |

## Critical Learnings from Debugging (2026-01-21)

### VastAI API Response Quirks
The VastAI API is inconsistent about field names and response structures. We discovered these through trial and error:

| What | Expected | Actual | Fix |
|------|----------|--------|-----|
| Instance ID on provision | `response.instance_id` | Sometimes `new_contract`, sometimes `instances.id`, sometimes neither | Check multiple fields, fallback to label lookup |
| getInstance response | Direct instance object | Wrapped in `response.instances` | Unwrap with `response?.instances \|\| response` |
| IP address field | `public_ip` | Actually `public_ipaddr` | Check both, prefer `public_ipaddr` |
| Status field | `status` | Actually `cur_state` or `actual_status` | Check all three: `cur_state \|\| actual_status \|\| status` |
| SSH endpoint | Instance's `publicIp` | Use `sshHost` proxy (e.g., `ssh2.vast.ai`) | VastAI routes SSH through proxy hosts |

### SSH Connection Timing
VastAI instances have a multi-stage readiness process:
1. **Instance "running"** - Status says running but nothing is ready yet
2. **SSH port open** - TCP port accepts connections, but auth not ready
3. **SSH auth ready** - Keys propagated, can actually authenticate
4. **Full readiness** - Services like Docker are available

We must wait at each stage:
- Poll instance status until `running` + `publicIp` assigned
- TCP connect test until SSH port accepts (can take 30-60 seconds)
- Additional 15-second delay after port opens for auth propagation
- First SSH command should retry with backoff (auth can still fail initially)

### SSH Key Registration
- The SSH public key is sent with the provision request (`ssh_key` field)
- The key must ALSO be registered in the VastAI dashboard beforehand
- If using a different key than your default, ensure `VASTAI_SSH_KEY_PATH` points to the correct private key AND the matching public key is in VastAI dashboard
- Key mismatch results in "Permission denied (publickey)" errors

### Offer Snatching
Popular GPU offers (especially cheap 4090s) get rented between search and provision:
- `searchOffers` returns available offers
- By the time `createInstance` runs, offer may be gone (404 "no_such_ask")
- Solution: try multiple offers in sequence until one succeeds

### SCP vs SSH Port Flag
- SSH uses lowercase `-p` for port
- SCP uses uppercase `-P` for port
- Using wrong flag causes SCP to interpret port number as filename

### Region Matters
- Chinese region machines can have high latency from US
- Use `--region US` (or other region codes) to filter offers
- Region codes come from `geolocation` field in offer data

### HuggingFace Authentication
- Gated models (FLUX.1-dev, etc.) require HuggingFace token
- Set `HF_TOKEN` env var on the remote instance
- Or run `huggingface-cli login` before training
- Must have accepted model license on HuggingFace website first

### Base Images vs Pre-configured Templates
- VastAI base images (`vastai/base-image:cuda-*`) have CUDA but no training frameworks
- ai-toolkit must be installed: `git clone + pip install -r requirements.txt`
- Installation takes ~15 minutes on first run
- **RECOMMENDED**: Use `ostris/aitoolkit` Docker image (10.2GB, pre-built):
  - ai-toolkit is at `/app/ai-toolkit` (NOT `/workspace/ai-toolkit`)
  - Python is aliased to `python` (not `python3`)
  - Image pull takes longer but saves ~15min install time
  - Note: Docker image name is `ostris/aitoolkit` (no hyphen), GitHub repo is `ai-toolkit` (with hyphen)

### Fractional GPU Gotcha (2026-01-21)
- VastAI offers can have `gpu_frac < 1.0` (e.g., 0.125 = 1/8th of a GPU)
- These fractional instances share GPU memory with other tenants
- **CRITICAL**: Fractional GPUs cause CUDA OOM errors during FLUX training
- Solution: Filter with `gpu_frac: { gte: 1.0 }` in offer search query
- Also add client-side filter as fallback

### VastAI extra_env Format (2026-01-21)
- VastAI's `extra_env` field must be an **array of strings** like `["KEY=value", "KEY2=value2"]`
- NOT an object like `{ KEY: "value" }`
- **CRITICAL**: `extra_env` values don't propagate to SSH sessions!
- VastAI sets them in the Docker container, but SSH connects to a different context
- **Solution**: Export env vars directly in the training script (see `TrainingRunner._buildBackgroundCommand()`)

### Training Config Optimization (2026-01-21)
- Sample generation (baseline + final) adds ~6-7 minutes to a 30-step run
- For quick testing/cost savings, set `disable_sampling: true` in config
- Checkpoints are saved based on `save_every` setting (default 250 steps)
- For short runs (30 steps), no intermediate checkpoints - only final model

## Full Training Pipeline Vision (2026-01-21)

The complete automated training workflow we're building toward:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REMOTE TRAINING PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. PROVISION          2. UPLOAD              3. EXECUTE                    │
│  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐               │
│  │ Rent GPU    │  ───► │ Dataset     │  ───► │ Start       │               │
│  │ Wait SSH    │       │ Config      │       │ Training    │               │
│  └─────────────┘       └─────────────┘       └─────────────┘               │
│                                                      │                      │
│  ┌──────────────────────────────────────────────────┘                      │
│  │                                                                          │
│  ▼                                                                          │
│  4. MONITOR                          5. COMPLETE                            │
│  ┌─────────────────────────┐        ┌─────────────────────────────────┐    │
│  │ Stream logs             │        │ Normal finish: final checkpoint │    │
│  │ Track progress (step N) │  ───►  │ Timeout/stall: last saved ckpt  │    │
│  │ Update ETAs             │        │ Error: capture logs, abort      │    │
│  │ Detect stalls           │        └─────────────────────────────────┘    │
│  └─────────────────────────┘                       │                        │
│                                                    ▼                        │
│  6. UPLOAD ARTIFACTS                 7. CLEANUP                             │
│  ┌─────────────────────────┐        ┌─────────────────────────┐            │
│  │ Primary: HuggingFace    │        │ Terminate instance      │            │
│  │   - Create model page   │  ───►  │ Update job status       │            │
│  │   - Upload safetensors  │        │ Notify user             │            │
│  │ Fallback: Cloudflare R2 │        └─────────────────────────┘            │
│  │   - miladystation2.net  │                                               │
│  │   - For private models  │                                               │
│  └─────────────────────────┘                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Upload Destinations
| Destination | When Used | Notes |
|-------------|-----------|-------|
| HuggingFace | Default for public models | Creates a model page with README, tags, metadata |
| Cloudflare R2 | Private models OR HuggingFace fallback | `miladystation2.net` bucket, user-requested privacy |

### Completion Scenarios
| Scenario | Action |
|----------|--------|
| Normal completion | Download final checkpoint from `/workspace/output/` |
| Timeout/stall | Download last saved checkpoint (training sometimes stalls and never finishes) |
| Error/crash | Capture logs, attempt partial checkpoint recovery, report failure |

### Key Metrics to Track (for monitoring/ETAs)
- Current training step
- Total steps configured
- Steps per second / time per step
- Loss values over time
- Checkpoint save events
- GPU utilization (if available)
- Estimated time remaining

---

## Gaps Before Remote Training Works
- ~~**Dataset readiness**~~: ADDRESSED - `DatasetValidator` validates structure before packing. Auto-captioning not yet implemented (see expansion ideas in DatasetValidator.js).
- ~~**Job config hand-off**~~: ADDRESSED - `launch-training.js` generates config from template, uploads alongside dataset, and invokes training. Fully validated 2026-01-21.
- ~~**Long-running monitoring**~~: ADDRESSED - `--watch` mode with polling, stall detection, progress/loss/ETA tracking. Validated 2026-01-21.
- ~~**Model upload (HuggingFace)**~~: FULLY VALIDATED - `--hfUpload` flag. Uploads safetensors directly from remote via `huggingface-cli`. First model: https://huggingface.co/ms2stationthis/hffinal_miladyii_30
- ~~**Model upload (Cloudflare R2)**~~: FULLY VALIDATED - `--r2Upload` flag for private models. Uses presigned URL + curl. First model: https://uploads.miladystation2.net/training/3cc2a115-f8ec-49ba-bea1-2ff46a9c41b1-r2test_miladyii_30.safetensors
- ~~**Sample images**~~: FULLY VALIDATED - Config generates samples at step N-1, uploads 4 JPG samples with consistent naming. First upload: https://huggingface.co/ms2stationthis/sampletest3_miladyii_30
- ~~**Branded assets**~~: DONE - ASCII art StationThis banner added to HuggingFace README template.

## Immediate Next Steps

### Phase 1: Runner Foundation ✅ COMPLETE
1. ~~**Dataset QA pipeline**~~ DONE (2026-01-21)
   - `DatasetValidator` validates: min 10 images, caption/image name pairing required
   - `validate-dataset.js` CLI with `--json` output for scripting
   - Future expansion ideas documented in DatasetValidator.js header comment

2. ~~**Remote job runner**~~ DONE (2026-01-21)
   - ✅ Created `TrainingRunner.js` service class
   - ✅ Created `TrainingOutputParser.js` for log parsing
   - ✅ Created `launch-training.js` CLI with foreground/background modes
   - ✅ Parses: step progress, loss, learning rate, checkpoints, errors, ETA
   - ✅ **FULLY VALIDATED** on real VastAI RTX 4090 (2026-01-21):
     - Provisioning, SSH wait, dataset upload all work
     - Uses `ostris/aitoolkit` image (ai-toolkit at `/app/ai-toolkit`)
     - HF_TOKEN passed via `extraEnv` for gated models
     - 30 steps completed, 2 checkpoints saved (~165MB each)
     - Loss values tracked (0.37-0.70 range), duration ~3.2 min
   - **Note**: Larger images (10.2GB) need longer SSH wait timeout

### Phase 2: Monitoring & Control ✅ COMPLETE
3. **Progress monitoring** ✅ DONE (2026-01-21)
   - ✅ Created `StallDetector.js` - asymptotic ETA trend analysis
   - ✅ Created `TrainingMonitor.js` - polling/streaming with state tracking
   - ✅ Created `TrainingNotifier.js` - Telegram/Discord alert routing
   - ✅ Added `--watch` mode to `launch-training.js` for real-time monitoring
   - **Design**: `docs/plans/2026-01-21-training-monitor-design.md`
   - ✅ First test run completed successfully (instance 30305770) - monitoring working
   - **Fixes applied during testing**:
     - `SshTransport.exec()` now defaults to `stdio: 'pipe'` to capture output
     - `isTrainingRunning()` parses last line of SSH output (handles VastAI welcome banners)
     - `TrainingOutputParser` added ai-toolkit tqdm patterns (`| N/M [` format, `s/it` speed)
   - ✅ **FULL MONITORING VALIDATED** (2026-01-21) - see Test #2 below

### 2026-01-21: Monitoring Test #2 - Full Pipeline Validation
- **Test instance**: 30308383 (RTX 4090 @ $0.55/hr)
- **Result**: ✅ SUCCESS - Full 30-step training completed

**Bugs Fixed During Testing:**
1. **Fractional GPU filtering** - Added `gpu_frac >= 1.0` filter to `VastAIService.buildOfferQuery()` and `filterAndSortOffers()`. Fractional GPUs (e.g., gpu_frac=0.125) cause CUDA OOM.
2. **SSH timeout** - Increased default from 100s to 5min (60 attempts × 5s). Configurable via `--sshTimeout` flag in minutes. The 10.2GB ostris/aitoolkit image needs longer to pull.
3. **VastAI extra_env format** - VastAI's `extra_env` must be array of `KEY=value` strings, not an object. Fixed in `buildInstancePayload()`.
4. **HF_TOKEN not propagating** - VastAI `extra_env` doesn't propagate to SSH sessions. Fixed by exporting env vars directly in the training script via `TrainingRunner._buildBackgroundCommand()`.
5. **Sample generation** - Enabled `disable_sampling: true` in config to save ~6-7 minutes per run.

**Monitoring System Validation:**
- `--watch` mode correctly shows: progress, loss, speed, ETA
- Stall detection working (note: triggers when ETA near 0 at end of training - expected)
- Parser extracts step progress from ai-toolkit tqdm output: `testmon_fluxdev1_30: 60%|██████| 18/30`

**Output Generated:**
- Final LoRA: `testmon_fluxdev1_30.safetensors` (171 MB)
- Optimizer state: `optimizer.pt` (175 MB)
- Config: `config.yaml`

**NEXT**: Upload script - the final step in the training pipeline

4. **Graceful termination + Upload** ← NEXT
   - Implement timeout-based cutoff with alert + grace period
   - Stop training process, then download checkpoint
   - Upload to HuggingFace (from GPU) or Cloudflare (presigned URL)
   - Mark incomplete models appropriately

### Phase 3: Artifact Management ✅ COMPLETE
5. **Model upload - HuggingFace** ✅ FULLY VALIDATED (2026-01-21)
   - Created `HuggingFaceHubService.js` for repo creation and file uploads
   - Created `ModelCardGenerator.js` for README generation (uses OpenAI for descriptions)
   - Created `huggingface-readme-template.md` - professional model card template
   - Integrated into `launch-training.js` with `--hfUpload` flag:
     - **Pre-training**: Creates HF repo, generates README from dataset captions
     - **Post-training**: Uploads safetensors directly from remote via `huggingface-cli`
   - Uses dynamic sample prompts from dataset captions (not random baselines)
   - Requires: `HF_TOKEN` (with org write), `OPENAI_API` (optional - falls back to generic)

### 2026-01-21: HuggingFace Upload Test - Full Pipeline Validation
- **Test instance**: 30316711 (RTX 3090 @ $0.19/hr, US region)
- **Result**: ✅ SUCCESS - Model uploaded to HuggingFace
- **Model URL**: https://huggingface.co/ms2stationthis/hffinal_miladyii_30

**Bugs Fixed During Testing:**
1. **HF commit API format** - HuggingFace deprecated old upload endpoint. New format uses NDJSON:
   ```json
   {"key": "header", "value": {"summary": "commit message"}}
   {"key": "file", "value": {"path": "file.md", "content": "base64...", "encoding": "base64"}}
   ```
2. **Caption extraction** - Manifest didn't include caption content. Added fallback to read `.txt` files directly from dataset directory.
3. **HF_TOKEN in foreground mode** - `startTraining()` wasn't passing `extraEnv`. Fixed to export env vars before training command.
4. **Large file upload (413 error)** - Commit API has size limits (~10MB). For safetensors (164MB), now uses `huggingface-cli upload` directly on remote instance which handles LFS automatically.
5. **HF org permissions** - Fine-grained token needs explicit org write access enabled.

**Pipeline Flow Validated:**
1. Pre-training: Create HF repo → Upload README (commit API)
2. Training: 30 steps on RTX 3090, 7m 42s, loss 0.3415
3. Post-training: Upload safetensors from remote via `huggingface-cli` (handles LFS)
4. Cleanup: Terminate instance

### Phase 3.5: Sample Image Pipeline ✅ FULLY VALIDATED (2026-01-21)
6. **Sample image generation for HuggingFace** ✅
   - Config uses `sample_every: {{SAMPLE_EVERY}}` where SAMPLE_EVERY = steps - 1
   - `skip_first_sample: true` skips baseline, only final samples generated
   - Sample prompts injected via `{{SAMPLE_PROMPTS}}` from dataset captions
   - ModelCardGenerator creates 2x2 grid markdown in README (`samples/sample_000.jpg` etc.)
   - **Key discoveries** (2026-01-21):
     - ai-toolkit generates JPG samples (not PNG)
     - Samples are in flat `samples/` folder (not `samples/step_N/`)
     - File naming: `timestamp__stepnum_index.jpg`
     - With steps=30 and sample_every=29: samples at step 29 and 30 (8 total, 4 per step)
   - **Fixed** (2026-01-21):
     - Broadened sample search to entire output directory
     - Added JPG support alongside PNG
     - Preserved original file extension when renaming
   - **Adds ~2 minutes** to training for 4x 1024x1024 samples at 20 steps each
   - **Branded assets**: ASCII art banner added to README template ✅
   - **First successful upload**: https://huggingface.co/ms2stationthis/sampletest3_miladyii_30

7. **Model upload - Cloudflare R2** ✅ FULLY VALIDATED (2026-01-22)
   - Added `--r2Upload` flag (mutually exclusive with `--hfUpload`)
   - Uses presigned URL so remote instance uploads directly via `curl`
   - Model lands at `https://uploads.miladystation2.net/training/{uuid}-{modelName}.safetensors`
   - For private models or when HuggingFace not desired
   - **First successful upload**: https://uploads.miladystation2.net/training/3cc2a115-f8ec-49ba-bea1-2ff46a9c41b1-r2test_miladyii_30.safetensors

### Phase 4: Bot Integration ✅ COMPLETE (2026-01-22)

**Goal**: After HuggingFace/Cloudflare upload, register model in bot so users can actually use it.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      POST-TRAINING FINALIZATION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Training       Upload to         Register in      Upload to      Make    │
│   Complete       HF/Cloudflare     LoRA DB          ComfyUI        Usable  │
│   ┌─────┐       ┌─────┐           ┌─────┐          Deploy         ┌─────┐ │
│   │ ✅  │ ───► │ ✅  │ ────────► │ ✅  │ ───────► ┌─────┐ ───► │ 🔄  │ │
│   └─────┘       └─────┘           └─────┘          │ ✅  │       └─────┘ │
│                                                     └─────┘               │
│                     │                  │               │              │    │
│                     │                  │               │              │    │
│                     ▼                  ▼               ▼              ▼    │
│               HuggingFace        createLoRAModel   volume/model   Model   │
│               or R2 bucket       with trainedFrom  API (HF/link)  works   │
│                                  + publishedTo                    in bot  │
│                                  + createdBy                              │
│                                                                           │
│   Additionally:                                                           │
│   ┌──────────────────────┐      ┌──────────────────────┐                 │
│   │ ✅ Cost Tracking     │      │ ✅ Credit User as    │                 │
│   │ (GPU rate × time)    │      │    Model Creator     │                 │
│   └──────────────────────┘      └──────────────────────┘                 │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**TrainingFinalizationService** - `src/core/services/training/TrainingFinalizationService.js`

Orchestrates all post-training tasks:
1. Create LoRA model record via `createTrainedLoRAModel()`
2. Refresh LoRA trigger map cache via `refreshPublicLoraCache()`
3. Upload to ComfyUI Deploy via `volume/model` API (HuggingFace or direct link)
4. Calculate and record training cost (GPU rate × time + platform fee)

**Usage:**
```javascript
const finalizationService = new TrainingFinalizationService({
  logger,
  refreshLoraCache: refreshPublicLoraCache,
  pointsService,
});

const trainingResult = TrainingFinalizationService.parseTrainingResult(stdout);
const result = await finalizationService.finalize(trainingResult, masterAccountId);
// { success, loraModel, charged, cacheRefreshed, comfyDeploy, errors }
```

**Existing Infrastructure Found:**

| Service | File | Status |
|---------|------|--------|
| LoRA Model DB | `src/core/services/db/loRAModelDb.js` | ✅ `createTrainedLoRAModel()` added |
| LoRA Resolution | `src/core/services/loraResolutionService.js` | ✅ Compatible with trained model schema |
| LoRA Trigger Map | `src/api/internal/loras/loraTriggerMapApi.js` | ✅ `refreshPublicLoraCache()` exported |
| ComfyUI Deploy | `POST /api/volume/model` | ✅ Supports `huggingface` and `link` sources |
| Points Service | `src/core/services/points.js` | ✅ `hasEnoughPoints()` + `deductPointsForTraining()` |

**Tasks for Phase 4:**

8. **Test Cloudflare R2 fallback upload** ✅ VALIDATED (2026-01-22)
   - `--r2Upload` flag works end-to-end
   - Model uploaded via presigned URL + curl from remote instance
   - Public URL: `https://uploads.miladystation2.net/training/{uuid}-{name}.safetensors`

9. **Create trained model registration service** ✅ DONE (2026-01-22)
   - Added `createTrainedLoRAModel(trainingResult, masterAccountId)` to `loRAModelDb.js`
   - Populates `trainedFrom: { trainingId, datasetId, tool, steps, baseModel, duration, finalLoss, trainedAt }`
   - Populates `publishedTo: { huggingfaceRepo, huggingfaceUrl, cloudflareUrl, modelFileUrl, uploadedAt }`
   - Sets `createdBy` and `ownedBy` to training requester
   - Auto-approves moderation (`status: 'approved'`, `reviewedBy: 'AUTO_APPROVED_TRAINING'`)
   - Sets `visibility: 'public'` so model appears in trigger map immediately
   - Returns model with slug for use in prompts: `<lora:slug:weight>`
   - **Schema verified compatible with `loraResolutionService.js`** - all required fields present

10. **Wire ComfyUI Deploy upload** ✅ DONE (2026-01-22)
    - Added `uploadToComfyDeploy()` method to `TrainingFinalizationService`
    - Uses `POST https://api.comfydeploy.com/api/volume/model` API
    - Supports `source: 'huggingface'` for HF repos
    - Supports `source: 'link'` for R2 direct URLs
    - Updates model record with `comfyDeployId` and `comfyDeployPath`

11. **Refresh LoRA cache after registration** ✅ DONE (2026-01-22)
    - `TrainingFinalizationService` accepts `refreshLoraCache` function
    - Calls `refreshPublicLoraCache()` after model creation
    - New model immediately available for prompt resolution

12. **Training cost tracking + billing** ✅ FULLY DONE (2026-01-22)
    - `launch-training.js` now outputs cost data:
      - `gpuHourlyRate` - from selected offer
      - `durationSeconds` - training time
      - `trainingCost` - calculated USD cost
    - `TrainingFinalizationService` calculates final cost:
      - GPU cost + platform fee (configurable, default 20%)
      - Converts to points (configurable multiplier, default 10000 points/$1)
    - **Actual point deduction** ✅ IMPLEMENTED:
      - Added `deductPointsForTraining()` to `PointsService`
      - Uses credit ledger (wallet-based) exclusively
      - Deducts across multiple deposits if needed (FIFO by funding rate)
      - Returns: `{ success, source, pointsDeducted, previousBalance, newBalance }`

13. **Creator crediting** ✅ DONE (via createTrainedLoRAModel)
    - `createdBy` field set to training requester's masterAccountId
    - `ownedBy` field set to same (can diverge later for transfers)
    - Model appears in their "My Models" list in mods menu
    - Usage stats attributed to them via `usageCount` field

14. **End-to-end validation** ← NEXT
    - Train model → Upload HF → Register in DB → Refresh cache → Upload to ComfyUI → Use in prompt
    - Verify: `/imagine a portrait, <lora:new-model-slug:0.8>`

### Phase 5: Worker Integration (Future)
14. **RemoteTrainingWorker**
    - Combine all phases into queue-processing loop
    - rent → upload → train → monitor → upload → register → charge → terminate

## Open Questions
- Do we pause jobs if dataset validation fails, or auto-fix (e.g., run captioner) inside the worker?
- How do we surface remote logs to the Mods Menu—polling endpoint vs WebSocket fan-out?
- For Ostris provisioning delays, do we wait for some readiness file before copying data, or rely on a retry loop?
