# Training Worker Design

**Date:** 2026-01-22
**Status:** Approved for implementation

## Overview

TrainingWorker is a standalone Node process that processes GPU training jobs. It bridges the bot's API (which queues jobs) with the VastAI training pipeline (launch-training.js).

**Primary concerns addressed:**
- Prevent runaway GPU costs from failed/stuck training
- Robust cleanup to avoid orphaned instances
- Prepaid model to prevent mid-training spend-out

**Future vision:** This worker is the first pass on what could become a fleet management system for GPU-based tool execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      trainingWorker.js                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Poll TrainingDB for status: 'QUEUED' (one at a time)        │
│  2. Validate user can afford estimated cost                     │
│  3. Charge upfront (deductPointsForTraining)                    │
│  4. Set status: 'PROVISIONING'                                  │
│  5. Call launch-training.js as child process                    │
│  6. Monitor: parse stdout, update progress, detect stalls       │
│  7. On complete: call TrainingFinalizationService               │
│  8. Reconcile cost (refund overage or flag underpayment)        │
│  9. Set status: 'COMPLETED' or 'FAILED'                         │
│  10. Terminate instance (with retry)                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   instanceSweeper.js (cron)                     │
├─────────────────────────────────────────────────────────────────┤
│  Runs every 15 min (separate process)                           │
│  Finds instances that should be dead but aren't                 │
│  Force terminates orphans, alerts ops                           │
└─────────────────────────────────────────────────────────────────┘
```

**Deployment:** Both run as separate Docker containers managed by deploy.sh, following the cookWorker pattern. Worker can be paused/resumed during deploys without killing active training.

**Concurrency:** One job at a time initially. Architecture supports future concurrency.

## Database Schema Extensions

TrainingDB (`trainingJobs` collection) additions:

```javascript
{
  // Existing fields...
  status: 'QUEUED' | 'PROVISIONING' | 'UPLOADING' | 'TRAINING' | 'FINALIZING' | 'COMPLETED' | 'FAILED',

  // Cost estimation & prepaid
  estimatedCostPoints: Number,      // Conservative estimate charged upfront
  actualCostPoints: Number,         // Reconciled after completion
  costReconciled: Boolean,          // Whether refund/charge happened

  // GPU instance tracking (critical for cleanup)
  vastaiInstanceId: String,         // For termination
  vastaiOfferId: String,            // What we rented
  gpuType: String,                  // "RTX 4090" etc
  gpuHourlyRate: Number,            // $/hr

  // Timeout tracking
  softTimeoutAt: Date,              // Expected completion
  hardTimeoutAt: Date,              // Max affordable runtime

  // For sweeper
  instanceTerminatedAt: Date,       // Null until confirmed dead
  terminationAttempts: Number       // Retry counter
}
```

**Critical field:** `vastaiInstanceId` must be set immediately after provisioning - this enables cleanup even if worker crashes.

## Prepaid Model & Cost Estimation

### Flow

1. **Job queued** with: modelType, steps, datasetSize
2. **Worker picks up job**
3. **Estimate cost** from historical data:
   - Lookup: (FLUX, 2000 steps, 20 images) → ~2.5 hrs typical
   - Apply buffer: 2.5 hrs × 1.5 = 3.75 hrs estimated (conservative)
   - GPU rate: ~$0.35/hr typical for 24GB
   - Estimated cost: 3.75 × $0.35 × 1.2 (platform fee) = $1.58
   - Convert to points: $1.58 × 10000 = 15,800 points
4. **Check balance:** user.points >= 15,800?
   - No → FAILED, "Insufficient balance"
   - Yes → Continue
5. **Charge upfront:** `deductPointsForTraining(15,800)`
   - Store `estimatedCostPoints = 15,800`
6. **Lock in GPU rental** → get actual rate
   - Calculate `hardTimeoutAt`: prepaid points ÷ (actualRate × pointsMultiplier)
   - Example: 15,800 ÷ ($0.30/hr × 10000 × 1.2) = 4.4 hours max
7. **Training runs...**
8. **Reconcile:**
   - `actualCostPoints` = realDuration × actualRate × multiplier
   - If actual < estimated: refund difference
   - If actual > estimated: flag for review (don't auto-charge more)

### Cost Estimation Data

Start with hardcoded lookup table, refine as data accumulates:

```javascript
const TRAINING_ESTIMATES = {
  'FLUX': {
    baseHoursPerStep: 0.0012,  // ~2.4 hrs for 2000 steps
    perImageMultiplier: 1.02,   // +2% per image over baseline
    baselineImages: 20
  },
  // Add more model types as needed
};

const GPU_CLASS_RATES = {
  '24GB': 0.35,  // RTX 3090/4090 typical
  '48GB': 0.80,  // A6000 typical
};

const BUFFER_MULTIPLIER = 1.5;  // 50% conservative buffer
```

## Timeout & Stall Handling

### Two-Tier Timeout

```
                    softTimeoutAt                    hardTimeoutAt
                         ↓                                ↓
|--------Training--------|-----Grace Period---------------|
         expected              still affordable
        completion               max runtime
```

- **Soft timeout:** Expected completion based on historical estimate. Alerts fired but training continues.
- **Hard timeout:** Maximum affordable runtime based on prepaid amount. Training terminated.

### Stall Detection

Uses existing `StallDetector` (asymptotic ETA analysis). On stall:

1. Alert ops AND user: "Training appears stalled, monitoring..."
2. Grace period: 15 minutes
3. If still stalled after grace: terminate, save last checkpoint
4. Mark job FAILED with `reason: 'stall_timeout'`, `partial: true`

### Monitoring Loop

```javascript
while (training running) {
  // 1. Parse stdout for progress
  updateProgress(jobId, currentStep, totalSteps, loss);

  // 2. Check stall detector
  if (stallDetector.isStalled()) {
    alertOps("Training stalled", { jobId, lastStep, eta });
    alertUser("Your training appears stalled, monitoring...");
    await wait(15 * 60 * 1000); // Grace period
    if (stillStalled()) {
      return { status: 'FAILED', reason: 'stall_timeout', partial: true };
    }
  }

  // 3. Check soft timeout
  if (now > softTimeoutAt && !softTimeoutAlerted) {
    alertOps("Training exceeded estimate", { jobId, elapsed, expected });
    alertUser("Training taking longer than expected, still running...");
    softTimeoutAlerted = true;
  }

  // 4. Check hard timeout
  if (now > hardTimeoutAt) {
    alertOps("Hard timeout reached", { jobId });
    alertUser("Training reached maximum funded duration, stopping...");
    return { status: 'FAILED', reason: 'hard_timeout', partial: true };
  }

  await wait(pollInterval);
}
```

## SSH Resilience

VastAI SSH is flaky. Worker must distinguish "SSH lost" from "training failed."

### Retry Strategy

```javascript
async function resilientExec(command, options = {}) {
  const maxRetries = options.retries || 5;
  const backoff = [5, 15, 30, 60, 120]; // seconds

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sshTransport.exec(command, { timeout: 30000 });
    } catch (err) {
      if (isConnectionError(err)) {
        log(`SSH connection lost (attempt ${attempt + 1}), retrying...`);
        await wait(backoff[attempt] * 1000);
        continue;
      }
      throw err;
    }
  }
  throw new SSHUnreachableError();
}
```

### Verify Before Giving Up

```javascript
async function handleSSHFailure(jobId, instanceId) {
  const instance = await vastaiService.getInstance(instanceId);

  if (instance.status === 'running') {
    // Instance alive, SSH just flaky - keep trying
    alertOps("SSH unreachable but instance running", { jobId, instanceId });
    return 'RETRY';
  } else {
    // Instance died
    return 'INSTANCE_DEAD';
  }
}
```

**Key rule:** Never assume training failed just because SSH dropped. Verify instance status via VastAI API.

## Cleanup & Sweeper

### Inline Cleanup (Worker)

After each job completes or fails:

```javascript
async function terminateWithRetry(instanceId, jobId) {
  const maxAttempts = 5;
  const backoff = [5, 15, 30, 60, 120];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await vastaiService.terminateInstance(instanceId);
      await trainingDb.setStatus(jobId, status, {
        instanceTerminatedAt: new Date(),
        terminationAttempts: attempt
      });
      return true;
    } catch (err) {
      log(`Termination attempt ${attempt} failed: ${err.message}`);
      await trainingDb.updateOne(jobId, { terminationAttempts: attempt });

      if (attempt === maxAttempts) {
        alertOps("CRITICAL: Instance termination failed", { instanceId, jobId });
        return false;
      }
      await wait(backoff[attempt - 1] * 1000);
    }
  }
}
```

### Sweeper (Separate Process)

Runs every 15 minutes via cron/pm2:

```javascript
async function sweep() {
  // 1. Find orphan instances (job done, instance alive)
  const orphanCandidates = await trainingDb.findMany({
    vastaiInstanceId: { $exists: true, $ne: null },
    instanceTerminatedAt: null,
    status: { $in: ['COMPLETED', 'FAILED'] }
  });

  for (const job of orphanCandidates) {
    const instance = await vastaiService.getInstance(job.vastaiInstanceId);
    if (instance && instance.status === 'running') {
      alertOps("ORPHAN DETECTED", { jobId: job._id, instanceId: job.vastaiInstanceId });
      await terminateWithRetry(job.vastaiInstanceId, job._id);
    }
  }

  // 2. Find stuck jobs (no update in 2hrs)
  const stuckJobs = await trainingDb.findMany({
    status: { $in: ['PROVISIONING', 'UPLOADING', 'TRAINING'] },
    updatedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) }
  });

  for (const job of stuckJobs) {
    alertOps("STUCK JOB", { jobId: job._id, status: job.status });
    if (job.vastaiInstanceId) {
      await terminateWithRetry(job.vastaiInstanceId, job._id);
    }
    await trainingDb.setStatus(job._id, 'FAILED', {
      failureReason: 'stuck_sweeper_cleanup'
    });
  }
}
```

## Alerting

Uses existing `TrainingNotifier`. Ops alerts go to dedicated Telegram channel.

### Alert Matrix

| Event | User | Ops | Severity |
|-------|------|-----|----------|
| Training started | Y | | info |
| Progress update (25%, 50%, 75%) | Y | | info |
| Soft timeout exceeded | Y | Y | warning |
| Stall detected | Y | Y | warning |
| Stall recovered | Y | Y | info |
| Hard timeout reached | Y | Y | error |
| Training completed | Y | | success |
| Training failed | Y | Y | error |
| SSH unreachable (instance alive) | | Y | warning |
| Termination failed | | Y | critical |
| Orphan instance detected | | Y | critical |
| Insufficient balance | Y | | error |

## Complete Worker Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRAINING WORKER FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  QUEUED ──► ESTIMATE COST ──► CHECK BALANCE ──► CHARGE UPFRONT             │
│                                     │                  │                    │
│                              (insufficient)      (success)                  │
│                                     ▼                  ▼                    │
│                                  FAILED          PROVISIONING               │
│                                                       │                     │
│                              ┌────────────────────────┤                     │
│                              │                        ▼                     │
│                              │    (provision fail) FAILED                   │
│                              │                        │                     │
│                              │    (success)───► UPLOADING                   │
│                              │                        │                     │
│                              │                        ▼                     │
│                              │                   TRAINING ◄─── monitor loop │
│                              │                        │        - progress   │
│                              │                        │        - stall      │
│                              │                        │        - timeouts   │
│                              │                        │        - SSH retry  │
│                              │                        ▼                     │
│                              │                  FINALIZING                  │
│                              │                   - DB record                │
│                              │                   - cache refresh            │
│                              │                   - ComfyUI Deploy           │
│                              │                   - reconcile cost           │
│                              │                        │                     │
│                              │              ┌────────┴────────┐             │
│                              │              ▼                 ▼             │
│                              │          COMPLETED          FAILED           │
│                              │              │                 │             │
│                              └──────────────┴────────┬────────┘             │
│                                                      ▼                      │
│                                            TERMINATE INSTANCE               │
│                                            (retry up to 5x)                 │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  SWEEPER (every 15 min):                                                    │
│  - Find orphan instances (job done, instance alive)                         │
│  - Find stuck jobs (no update in 2hrs)                                      │
│  - Force terminate + alert ops                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Protections Summary

1. **Prepaid model** - Charge upfront, prevents mid-training spend-out
2. **Two-tier timeout** - Soft (alert) + hard (terminate) based on affordability
3. **Stall detection** - 15 min grace period before killing stalled training
4. **SSH resilience** - Retry with backoff, verify instance via API before giving up
5. **Inline cleanup** - 5 retries with backoff on termination
6. **Sweeper safety net** - Separate process catches orphans every 15 min
7. **Dual alerting** - User notifications + ops channel for visibility

## Files to Create

1. `scripts/workers/trainingWorker.js` - Main worker process
2. `scripts/workers/instanceSweeper.js` - Orphan cleanup cron
3. `src/core/services/training/TrainingCostEstimator.js` - Cost estimation logic
4. `src/core/services/training/TrainingJobProcessor.js` - Core job execution logic

## Implementation Notes

- Follow cookWorker.js pattern for worker structure
- Use `initializeDatabase()` for DB connection
- Use change streams or polling for job detection
- Worker needs access to: TrainingDB, PointsService, VastAIService, TrainingFinalizationService
- Sweeper can be simpler - just needs TrainingDB and VastAIService
