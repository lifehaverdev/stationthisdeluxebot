# VastAI GPU Training Orchestrator — Outline

> **Location:** This documentation lives with the implementation at `src/core/services/vastai/`.
> **Related Code:**
> - Service: `src/core/services/vastai/` (this directory's parent)
> - Scripts: `scripts/vastai/` (development/testing helpers)
> - SSH Transport: `src/core/services/remote/SshTransport.js`
> - Training Configs: `src/core/services/vastai/configs/`

## Problem Statement
Our rebuilt LoRA training system still assumes we own the GPU hardware (Docker/NVIDIA on the worker host). That limits throughput, blocks large jobs, and makes the platform fragile whenever we redeploy because a running container dies with the worker. We need an on-demand GPU backend that we can provision, control, and observe remotely so long trainings can continue even while StationThis restarts. Vast.ai offers low-latency programmatic rental of GPUs but we lack any integration to discover offers, spin up a machine, migrate datasets, execute training scripts, stream logs, fetch the resulting model, and tear everything down safely.

## Vision
A reusable "remote trainer" stack where the TrainingOrchestrator can pick any registered compute provider (VastAI for now) and execute a training tool that is defined as a deterministic sequence of shell commands. The orchestrator rents a GPU, ships datasets + recipes to it over SSH, runs the tool inside either Docker or bare-metal, tails progress logs via a dedicated worker, and publishes artifacts back to R2 once finished. When the job is done (or fails) the worker uploads the latest checkpoint, updates TrainingDB, refunds/charges points, and releases the VastAI instance. The same compute service also works locally: developers can point it to an already running machine (or a fake driver) to test recipes end-to-end before touching production.

## Acceptance Criteria
- VastAI integration surface that can search offers, create/rent an instance, configure SSH, and terminate the instance via API with exponential backoff + retries.
- Datasets are packaged (tar/zip) deterministically, hashed, and copied to the remote host with resumable `rsync`/`scp` plus integrity check before training starts.
- Training tools are declarative (YAML/JSON + optional JS) sequences of commands (e.g. pull Docker image, run `accelerate launch ...`). Input variables include dataset path, user configs, and secrets.
- Long-running training progress is tracked in a worker process that persists state in Mongo so a redeploy can resume polling/log tailing without losing context.
- Training artifacts (latest + final model) are pulled back over SSH and uploaded to Cloudflare R2; job status is updated and the VastAI instance is destroyed.
- Local development flag that swaps the VastAI driver with `LocalSSHDriver` so engineers can run the exact workflow against localhost or an existing server without renting GPUs.

## Key Milestones
| Milestone | Description | Status |
|-----------|-------------|--------|
| M0 – Research & SDK Stub | Document VastAI API surface, add TypeScript types, record env vars | DONE |
| M1 – Compute Driver Core | `VastAIService`, offer discovery, instance lifecycle, SSH bootstrap | DONE |
| M2 – Remote Execution Kit | Dataset pack/transfer, command runner, log streamer, artifact fetcher | IN PROGRESS |
| M3 – Worker & State Machine | Durable `RemoteTrainingWorker` that survives restarts and updates TrainingDB | TODO |
| M4 – Training Tool Registry | Declarative recipes + CLI runner for local tests | TODO |
| M5 – StationThis Integration | Hook TrainingOrchestrator to new provider, add metrics, enable beta users | TODO |

## Dependencies
- VastAI API key + optional sub-account credentials stored in Secrets Manager / `.env`
- SSH keypair dedicated to remote trainers (uploaded to VastAI instance via cloud-init)
- Cloudflare R2 buckets for dataset/model moves
- Existing TrainingDB schema (provider metadata extensions required)
- pointsService for billing/refund logic
- Worker infrastructure (pm2/systemd) to keep `remoteTrainingWorker` alive

## Architecture Overview
1. **VastAIService** (`src/core/services/vastai/`)
   - REST client with strongly typed methods: `searchOffers`, `createRental`, `startInstance`, `terminateInstance`, `getInstanceMetrics`, `syncSshKeys`.
   - Maintains provider-level config (preferred datacenters, GPU class, bid caps) stored under `config/vastai.js`.
   - Exposes a higher-level `provisionJob(jobContext)` helper returning SSH connection info + rental metadata.

2. **RemoteExecutionKit**
   - `DatasetPacker`: streams dataset from Cloudflare to a tarball, calculates SHA256, supports chunked upload via `rsync`.
   - `SshTransport` (`src/core/services/remote/SshTransport.js`): wrapper over ssh/scp with retry + timeout controls, file push/pull.
   - `CommandSequencer`: consumes a training tool definition (YAML or JS) and executes each step with templated env vars, capturing stdout/stderr to both log stream and remote file.
   - `ArtifactCollector`: watches configured paths (e.g., `output/*.safetensors`, `logs/checkpoints`) and syncs them back incrementally.

3. **Training Tool Registry**
   - `src/core/services/training/tools/<toolName>/tool.yaml`
   - Fields: base image/tag, bootstrap scripts, expected outputs, health check command, cleanup commands.
   - Tools are versioned (e.g., `flux-lora@1`) and can be referenced by TrainingDB job documents.

4. **RemoteTrainingWorker** (new long-lived worker similar to `trainingWorker` but dedicated to provider orchestration)
   - Polls `TrainingDB` for jobs whose `execution.provider === 'vastai'` and `state in {PROVISIONING,RUNNING,NEEDS_RECOVERY}`.
   - State machine persisted in Mongo: `QUEUED → PROVISIONING → TRANSFERRING_DATA → EXECUTING → FETCHING_RESULTS → COMPLETED/FAILED`.
   - Writes heartbeat + progress (step name, percent, ETA) to `trainingJob.progressLog` to drive UI updates.
   - On crash/restart, reads provider metadata (instanceId, sshHost, activeStep) to resume from the correct state without rerunning finished steps.

5. **Local CLI (`scripts/vastai/`)**
   - Dev tools that let engineers test the full workflow without production integration.
   - `launch-session.js`: provisions GPU, uploads dataset, drops into interactive SSH.
   - Supports `--driver=local` (uses existing Linux GPU or WSL) and `--driver=vastai` (actually rents hardware).

## Workflow (Happy Path)
1. TrainingOrchestrator selects job → sees `execution.provider = 'vastai'` and posts job metadata to a queue.
2. RemoteTrainingWorker claims job, calculates target spec (GPU min VRAM, budget) and asks `VastAIService.provisionJob` for an instance.
3. VastAIService rents an instance, waits for `status = running`, injects SSH key, returns host/IP/port.
4. Worker runs bootstrap command (install docker/nvidia drivers if needed), ensures disk space, then triggers DatasetPacker to rsync dataset + tool scripts to `/opt/stationthis/jobs/<jobId>`.
5. CommandSequencer executes the tool (pull docker, run training). It tails logs, publishes progress events, and writes a `latest.json` heartbeat file remotely.
6. ArtifactCollector syncs `latest_checkpoint.safetensors` every N minutes plus final `model.safetensors` + metadata.
7. When tool completes, worker uploads final artifacts to R2, updates `trainingDb`, registers LoRA, and calls `VastAIService.terminateJob` to shut down the rental.
8. Job transitions to `COMPLETED`; dataset/model credits applied; worker cleans up local temp files.

## Dataset + Config Handoff (Flux LoRA Pilot)
The immediate blocker is turning a "dataset + captions + ai-toolkit config" bundle into something the rented machine can execute without manual tweaking. We'll standardize both the **local staging** story and the **remote filesystem** layout so the CLI + worker can reason about deterministic paths.

### Local Staging
1. **Dataset prep** – run `scripts/datasets/validate.js <datasetId>` to confirm min images, captions, and naming. The validator emits a manifest JSON + `captions.jsonl` so captions travel with each image.
2. **Pack & hash** – use `DatasetPacker` to produce `dataset_<jobId>.tar.zst`. Tarball contains `images/`, `captions/`, `captions.jsonl`, and `manifest.json`. Store alongside `job.json` inside `.stationthis/jobs/<jobId>/` on the orchestrator while waiting for transfer.
3. **Config templating** – the source-of-truth ai-toolkit config lives at `src/core/services/vastai/configs/flux-lora-ai-toolkit.yml`. It includes placeholders such as `{{JOB_ROOT}}/dataset/images`. Before upload, `scripts/vastai/render-config.js` swaps placeholders with the concrete remote job root.

### Remote Layout
- Every job gets a deterministic root: `/opt/stationthis/jobs/<jobId>` (created by bootstrap script).
- Subfolders:
  - `dataset/` – untarred dataset that mirrors the packer layout (`images/`, `captions/`, `captions.jsonl`).
  - `config/` – rendered ai-toolkit YAML + `job.json` snapshot.
  - `scripts/` – generated `launch_flux.sh` (runs config), helper to resume, and a symlink to datasets when reusing.
  - `logs/` – stdout/stderr from the `ai-toolkit` run plus `rsync.log` for debugging transfers.
  - `output/` – checkpoints + previews that ArtifactCollector syncs back.

## Failure & Recovery Strategy
- **Provisioning failure** → mark job `FAILED_PROVISIONING`, notify orchestrator, refund points.
- **Transfer/Command failure** → capture remote logs and attach to job; worker attempts automatic retry of failed step (max 3). If the worker process dies mid-training, on restart it checks provider metadata and reconnects via SSH to continue log streaming until training finishes or times out.
- **Cost guardrails** → hourly rent + estimated training duration stored on job; worker enforces `maxHours` and terminates instance if exceeded.

## Local Development & Testing
- Fake driver implementing the same interface but executing commands on localhost (`DRIVER=loopback`).
- Fixtures under `tests/fixtures/training-tools/` for dataset packaging and templating.
- Unit tests for dataset hashing, command templating, VastAI API client (using mocked HTTP).
- Integration test harness using Docker-in-Docker to mimic remote host, letting CI validate the command sequencer without real GPUs.

## Monitoring & Observability
- Structured logs `training.remote.<state>` with jobId, provider, instanceId.
- Metrics: time spent per state, GPU hourly cost, dataset transfer rate, artifact size.
- Alerting hooks: if job stuck in PROVISIONING > 10 min, or no heartbeat for 5 min while RUNNING.

## Open Questions
1. Do we pre-purchase VastAI rentals (to avoid provisioning latency) or rent per job?
2. Should datasets stay in R2 and stream from remote host via HTTP instead of SCP?
3. How do we expose live training logs to users (WebSocket fan-out vs polling)?
4. What compliance requirements apply to storing VastAI invoices/cost breakdowns?
