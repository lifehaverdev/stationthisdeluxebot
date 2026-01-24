# Training Monitor System Design

**Date:** 2026-01-21
**Status:** Approved
**Related:** `src/core/services/vastai/TrainingRunner.js`, `src/core/services/vastai/TrainingOutputParser.js`

## Overview

A monitoring system for remote GPU training jobs that provides:
- Hybrid polling/streaming log monitoring
- Asymptotic stall detection (ETA trend analysis)
- Graceful termination with alert + grace period
- Safe model upload from GPU instance

## Architecture

### New Components

```
┌─────────────────────────────────────────────────────────────┐
│                     TrainingMonitor                         │
├─────────────────────────────────────────────────────────────┤
│  Inputs:                                                    │
│  - ssh: SshTransport instance                               │
│  - jobInfo: { logFile, pidFile, outputDir, ... }           │
│  - config: { gracePeriod, stallThreshold, ... }            │
│                                                             │
│  State tracking:                                            │
│  - parsedState: accumulated TrainingOutputParser result     │
│  - etaHistory: [{timestamp, eta, step}, ...]               │
│  - speedHistory: [{timestamp, stepsPerSec}, ...]           │
│  - stallDetectedAt: timestamp or null                       │
│                                                             │
│  Methods:                                                   │
│  - poll() → TrainingStatus (one-shot check)                │
│  - startStreaming(callback) → stop function                │
│  - checkForStall() → StallAnalysis                         │
│  - stopTraining() → boolean                                 │
│  - getCheckpoints() → CheckpointInfo[]                     │
└─────────────────────────────────────────────────────────────┘
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/core/services/vastai/TrainingMonitor.js` | Core monitoring class |
| `src/core/services/vastai/StallDetector.js` | Stall analysis logic |
| `src/core/services/notifications/TrainingNotifier.js` | Notification routing |

### Files to Modify

| File | Change |
|------|--------|
| `TrainingRunner.js` | Integrate monitor creation |
| `launch-training.js` | Add `--watch` flag for streaming mode |

## Monitoring Modes

### Polling Mode (Background)

For long-running jobs when user isn't actively watching.

```javascript
// Called periodically by job manager (every 60 seconds)
const status = await monitor.poll();
// Returns: { isRunning, parsed, stallAnalysis, checkpoints }
```

- Each poll: SSH in, `tail -n 100` log file, parse, analyze
- State persisted between polls for trend analysis
- Lower resource usage, higher latency (30-60 second intervals)

### Streaming Mode (Active Watch)

For real-time feedback when user is watching.

```javascript
const stop = await monitor.startStreaming((update) => {
  console.log(`Step ${update.step}/${update.total} | Loss: ${update.loss}`);
});

// To stop:
stop();
```

- Keeps SSH connection open with `tail -f`
- Sub-second latency on updates
- Needs reconnect logic if connection drops
- Falls back to polling on disconnect

## Stall Detection Algorithm

### The Problem

Simple timeout-based stall detection ("no progress for 10 minutes") doesn't work because:
- Some steps legitimately take longer (checkpointing, validation)
- Training can slow down progressively without fully stopping

### Asymptotic Detection

Detect when ETA stops converging despite steps completing.

**Data tracked:**
```javascript
etaHistory: [
  { timestamp: 1705850000, step: 3000, eta: 7200 },  // 2h remaining
  { timestamp: 1705851800, step: 3200, eta: 7100 },  // 1h58m - healthy
  { timestamp: 1705853600, step: 3400, eta: 7200 },  // 2h again - warning
  { timestamp: 1705855400, step: 3500, eta: 7500 },  // 2h5m - stalling
]
```

**Detection logic:**

1. **Minimum samples**: Need 3-4 ETA readings before analysis
2. **ETA velocity**: Is ETA decreasing proportionally to elapsed time?
   - Healthy: ETA drops ~1 min per 1 min elapsed
   - Stalling: ETA stays flat or increases
3. **Threshold**: If over last 3 readings, ETA decreased by <50% of elapsed wall-clock time → flag
4. **Confirm with speed**: If `stepsPerSecond` dropped >50% from peak → reinforces diagnosis

**Output:**
```javascript
{
  isStalling: true,
  confidence: 'high',  // or 'medium' if only one signal
  reason: 'ETA not converging: stayed at ~2h over last 30 minutes despite 500 steps',
  recommendation: 'terminate',
  currentStep: 3500,
  totalSteps: 4000
}
```

## Notification System

### Priority Chain

1. **Telegram** - if user has `telegramId`
2. **Discord** - if user has `discordId`
3. **Web status** - future: ModMenuModal alert (not implemented now)

### TrainingNotifier

```javascript
class TrainingNotifier {
  constructor({ telegramService, discordService, logger }) { ... }

  async notify(userId, message, { priority = 'normal', jobId } = {}) {
    const user = await this.getUser(userId);

    // Try Telegram first
    if (user.telegramId) {
      const sent = await this.telegramService.send(user.telegramId, message);
      if (sent) return { channel: 'telegram', success: true };
    }

    // Fall back to Discord
    if (user.discordId) {
      const sent = await this.discordService.sendDM(user.discordId, message);
      if (sent) return { channel: 'discord', success: true };
    }

    // No channel available
    this.logger.warn(`No notification channel for user ${userId}`);
    return { channel: 'none', success: false };
  }
}
```

### Message Templates

**Stall detected:**
```
⚠️ Training Stall Detected

Job: {jobName}
Progress: {step}/{totalSteps} ({percent}%)
Issue: ETA not converging ({etaTrend})

Auto-terminating in {gracePeriod} minutes unless progress resumes.
Latest checkpoint: step {checkpointStep}
```

**Training terminated:**
```
🛑 Training Terminated

Job: {jobName}
Reason: Stall detected, grace period expired
Final checkpoint: step {lastCheckpoint}
Model will be uploaded as incomplete.
```

## Graceful Termination Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  TERMINATION SEQUENCE                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. STOP TRAINING PROCESS                                   │
│     └─ ssh: kill -TERM $(cat training.pid)                 │
│     └─ Wait 10s for graceful shutdown                       │
│     └─ If still running: kill -KILL                        │
│                                                             │
│  2. INVENTORY CHECKPOINTS                                   │
│     └─ List *.safetensors in output directory              │
│     └─ Identify latest checkpoint by step number           │
│     └─ Record file sizes                                    │
│                                                             │
│  3. UPLOAD FROM GPU INSTANCE                                │
│     └─ HuggingFace: Use existing HF_TOKEN on instance      │
│     └─ Mark as incomplete if stall-terminated              │
│     └─ Cloudflare fallback: Use presigned URL (see below)  │
│                                                             │
│  4. CLEANUP                                                 │
│     └─ Notify user of completion                           │
│     └─ Terminate VastAI instance                           │
│     └─ Update job status in database                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Model Upload Strategy

### HuggingFace (Primary)

Upload directly from GPU instance using `HF_TOKEN` already present.

- Token already passed via `extraEnv` for gated model downloads
- Same token works for uploads
- Low risk: token can be revoked if compromised

### Cloudflare R2 (Fallback)

Use **presigned URLs** - never expose credentials to rented GPU.

```
┌──────────────┐     1. Request upload URL      ┌──────────────┐
│  Our Server  │ ◄──────────────────────────────│  GPU Instance │
│              │                                │              │
│  (has R2     │     2. Generate presigned URL  │  (has model  │
│   credentials)│ ─────────────────────────────►│   file)      │
│              │     (15 min expiry)            │              │
└──────────────┘                                └──────┬───────┘
                                                       │
                                                       │ 3. PUT directly to
                                                       │    presigned URL
                                                       ▼
                                               ┌──────────────┐
                                               │ Cloudflare R2│
                                               └──────────────┘
```

- Server generates time-limited upload URL for specific path
- GPU uploads directly - no credentials exposed
- URL expires after use, can't be reused

### Incomplete Model Metadata

For HuggingFace README when stall-terminated:

```yaml
---
tags:
  - flux
  - lora
  - incomplete
---

# {Model Name}

⚠️ **This model was terminated early due to training stall.**

- Target steps: 4000
- Completed steps: 3500 (87.5%)
- Reason: ETA not converging

The model may still be usable but was not fully trained.
```

## Configuration

### Default Values

| Setting | Default | Configurable |
|---------|---------|--------------|
| Poll interval | 60 seconds | Yes |
| Grace period | 15 minutes | Yes, per-job |
| Min ETA samples | 3-4 readings | Yes |
| ETA convergence threshold | 50% | Yes |
| Speed drop threshold | 50% from peak | Yes |

### Per-Job Config

```javascript
{
  monitoring: {
    gracePeriod: 15 * 60 * 1000,  // 15 minutes in ms
    pollInterval: 60 * 1000,      // 60 seconds
    stallDetection: {
      enabled: true,
      minSamples: 4,
      etaConvergenceThreshold: 0.5,
      speedDropThreshold: 0.5
    }
  }
}
```

## Framework Considerations

The monitoring system has shared and framework-specific components:

### Shared (all frameworks)
- Polling/streaming infrastructure
- Notification routing
- Termination sequence
- Upload flow

### Framework-specific (currently: ai-toolkit/FLUX)
- Log parsing patterns (already in `TrainingOutputParser.js`)
- Checkpoint naming conventions
- Output directory structure

Future frameworks (Kohya, diffusers) would add patterns to `TrainingOutputParser.js` but use the same monitoring infrastructure.
