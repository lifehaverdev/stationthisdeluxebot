# Cost Analysis & Warm Pool Strategy

**Date:** 2026-02-03
**Status:** Benchmark complete - VastAI reliability issues identified

## Current State

**Current provider cost:** $100/month base + marked-up compute
**Proposed VastAI cost:** ~$18-25/month (reactive warm pool)
**Potential savings:** 75-80%

## User Activity Analysis (90 days)

```
Total generations: 5,817 (~65/day)
Peak hours: 18:00-21:00 UTC
Busiest day: Monday (1,299)
Dead zone: 04:00-09:00 UTC
```

### User Distribution
| User | Generations | % of Total |
|------|-------------|------------|
| Top 1 | 3,812 | 66% |
| Top 2 | 1,075 | 18% |
| Others | 930 | 16% |

### Burst Patterns
- 338 bursts detected (3+ requests within 5 min)
- Average burst: 15.4 requests
- Max burst: 588 requests
- Median inter-request interval: 0.6-0.7 minutes

**Key insight:** Power users do rapid-fire requests. Once an instance is warm, it stays busy. Cold start only hurts the *first* request of a session.

## Cost Scenarios

### Fixed Schedule Options
| Strategy | Hours/day | Monthly Cost |
|----------|-----------|--------------|
| 24/7 | 24 | $216 |
| Active hours (10:00-02:00 UTC) | 16 | $144 |
| Peak only (14:00-02:00 UTC) | 12 | $108 |
| Peak core (17:00-23:00 UTC) | 6 | $54 |

### Reactive Warm Pool (Recommended)
```
Usage pattern:
- ~4 sessions/day (bursts)
- ~10 min active per session
- 10 min idle timeout after last request

Cost calculation:
- 4 sessions × 20 min = 80 min/day
- 80 min × 30 days = 40 hours/month
- 40 hrs × $0.30 = $12/month
- + cold start overhead (~$6/month)
- Total: ~$18-25/month
```

## E2E Pipeline Results

### Proven Workflow
1. Rent GPU via VastAI API
2. SSH into instance
3. Install ComfyUI + PyTorch 2.4+
4. Download models from R2 CDN (parallel)
5. Run Flux + LoRA workflow
6. Retrieve generated image
7. Terminate instance

### Timing Breakdown (single run)
| Step | Time |
|------|------|
| SSH ready | ~30-45s |
| PyTorch upgrade | ~90s |
| ComfyUI + deps | ~50s |
| Model downloads (33GB) | 5-10 min (varies) |
| Generation | ~20s |
| **Total** | **8-14 min** |

### R2 vs HuggingFace
- R2 CDN sometimes slower than HuggingFace
- Depends on VastAI datacenter connectivity
- R2 still valuable for: no rate limits, no auth required, consistency

## Infrastructure Created

### R2 Models Bucket
- **Bucket:** `models`
- **Domain:** https://models.miladystation2.net
- **Structure:**
```
models/
├── unet/flux1-schnell.safetensors (23GB)
├── vae/ae.safetensors (320MB)
├── clip/t5xxl_fp16.safetensors (9.2GB)
├── clip/clip_l.safetensors (235MB)
└── loras/b0throps.safetensors (328MB)
```

### Scripts Created
| Script | Purpose |
|--------|---------|
| `scripts/vastai/test-e2e-comfyui.js` | Full E2E test with Flux + LoRA |
| `scripts/models/upload-to-r2.js` | Stream models from HF to R2 |
| `scripts/analysis/user-activity-patterns.js` | Analyze usage patterns |
| `scripts/vastai/benchmark-cold-start.js` | Benchmark VastAI variance |

## Benchmark Results (2026-02-03)

### Summary: VastAI Not Reliable for User-Facing

```
Runs:      5 total
Successful: 1 (20%)
Failed:    4 (80%)
```

**This failure rate is disqualifying for user-facing workloads.**

### Failure Modes

| Run | Outcome | Failure Mode |
|-----|---------|--------------|
| 1 | FAIL | SSH never became ready (5 min timeout) |
| 2 | FAIL | Instance disappeared during downloads |
| 3 | FAIL | Instance disappeared during downloads |
| 4 | SUCCESS | 8.2 min total |
| 5 | FAIL | Instance disappeared during downloads |

Instances vanishing mid-operation suggests hosts terminating rentals or VastAI instability.

### Successful Run Breakdown (Run 4)

| Step | Time |
|------|------|
| Provision | 0.7s |
| SSH Ready | 21.6s |
| Git Clone | 2.4s |
| PyTorch Upgrade | 46.4s |
| ComfyUI Requirements | 20.3s |
| **Model Downloads** | **368.2s (6.1 min)** |
| Generation | 14.4s |
| **TOTAL** | **491.6s (8.2 min)** |

Download breakdown (parallel):
- unet (23GB): 368.2s (63 MB/s)
- t5xxl (9.2GB): 185.0s (50 MB/s)
- lora (328MB): 7.3s
- vae (320MB): 6.9s
- clip_l (235MB): 5.6s

**The 23GB UNet is the fundamental bottleneck.** Even with parallel downloads, cold start cannot get below ~6 min.

### Decision: VastAI Unsuitable

Based on decision criteria:
1. ~~Variance < 30%~~ - Cannot measure (only 1 success)
2. ~~Variance > 50%~~ - N/A
3. **Failure rate > 10%** - **80% failure rate** = VastAI rejected

## Alternative Providers to Evaluate

| Provider | Model | Cold Start | Reliability | Cost |
|----------|-------|------------|-------------|------|
| **RunPod** | Serverless GPU | Unknown | Higher | ~$0.20-0.40/hr |
| **Modal** | Serverless compute | Seconds | High | Pay-per-second |
| **Replicate** | Managed inference | Instant | High | Per-generation |
| **Together.ai** | Inference API | Instant | High | Per-generation |
| **Lambda Labs** | Reserved GPU | ~1 min | High | ~$0.80-1.50/hr |

### Recommended Strategy (Revised)

**Option A: Evaluate RunPod Serverless**
- Similar model to VastAI but reportedly more reliable
- Run same benchmark to compare reliability
- If >80% success rate, viable for reactive warm pool

**Option B: Managed Inference (Replicate/Together)**
- No cold start at all
- Higher per-generation cost but zero management
- Best for user-facing reliability

**Option C: Hybrid**
- Replicate for user-facing (instant, reliable)
- VastAI for training/batch workloads (cost-sensitive, failure-tolerant)

## Next Steps

1. [x] Run VastAI variance benchmark (5 runs)
2. [x] Analyze benchmark results - **80% failure rate**
3. [ ] Evaluate RunPod reliability (same benchmark)
4. [ ] Get Replicate/Together pricing for Flux Schnell
5. [ ] Decide: RunPod vs Managed Inference
6. [ ] Implement chosen provider
