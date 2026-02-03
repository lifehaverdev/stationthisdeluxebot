# Latency Optimization Strategy

**Goal:** Reduce cold start from 10 minutes to 2-3 minutes

## Problem Analysis

Current cold start breakdown (from E2E test 2026-02-03):

| Step | Time | % |
|------|------|---|
| SSH ready | 42s | 7% |
| PyTorch upgrade | 69s | 12% |
| ComfyUI + deps | 36s | 6% |
| **Model downloads** | **390s** | **66%** |
| Generation | 20s | 3% |
| Other | 36s | 6% |

**The bottleneck is downloading 33GB from HuggingFace.**

## Solution: R2 Model Cache + Parallel Downloads

### Phase 1: R2 Model Cache (Implemented)

Store models in Cloudflare R2 bucket:
- **Bucket:** `models` (https://models.miladystation2.net)
- **Structure:** Matches ComfyUI layout for direct mapping

```
models/
├── unet/
│   └── flux1-schnell.safetensors  (23GB)
├── vae/
│   └── ae.safetensors             (320MB)
├── clip/
│   ├── t5xxl_fp16.safetensors     (9.2GB)
│   └── clip_l.safetensors         (235MB)
└── loras/
    └── b0throps.safetensors       (328MB)
```

**Benefits:**
- Cloudflare CDN edge caching
- No HuggingFace rate limits
- Consistent download speeds
- No auth required for GPU instances

### Phase 2: Parallel Downloads (TODO)

Current: Sequential downloads (6.5 min)
Target: Parallel downloads with `Promise.all` (2-3 min)

```javascript
// Before: Sequential
await download('unet/...');    // 3.5 min
await download('clip/...');    // 2.4 min
await download('vae/...');     // 5s
...

// After: Parallel
await Promise.all([
  download('unet/...'),   // All run
  download('clip/...'),   // concurrently
  download('vae/...'),    // saturating
  download('loras/...'),  // bandwidth
]);
```

Expected improvement: 6.5 min → 2-3 min (limited by largest file + bandwidth)

### Phase 3: Short Warm Pool (Future)

When volume increases:
- Keep instance alive 10-15 min after request
- Instant response for follow-up requests
- Cost: ~$0.03-0.04 per idle window
- Already have `WarmPoolManager` infrastructure

## Implementation Status

- [x] R2 bucket created: `models`
- [x] Custom domain: `models.miladystation2.net`
- [x] StorageService updated with `models` bucket
- [x] Upload script: `scripts/models/upload-to-r2.js`
- [ ] Models uploaded to R2
- [ ] E2E test updated for R2 + parallel downloads
- [ ] Benchmark new cold start time

## Model URLs (after upload)

```
https://models.miladystation2.net/unet/flux1-schnell.safetensors
https://models.miladystation2.net/vae/ae.safetensors
https://models.miladystation2.net/clip/t5xxl_fp16.safetensors
https://models.miladystation2.net/clip/clip_l.safetensors
https://models.miladystation2.net/loras/b0throps.safetensors
```

## Adding New Models

```bash
# Add to MODELS object in scripts/models/upload-to-r2.js, then:
node scripts/models/upload-to-r2.js --model <name>

# Or edit MODELS and run:
node scripts/models/upload-to-r2.js --all
```

---

## Results: R2 CDN vs HuggingFace (2026-02-03)

**Surprising finding:** R2 was slower than HuggingFace for the tested instance.

| Source | UNet (23GB) | Total Downloads | Speed |
|--------|-------------|-----------------|-------|
| HuggingFace | ~210s | ~390s (sequential) | ~110 MB/s |
| R2 CDN | ~600s | ~601s (parallel) | ~38 MB/s |

**Why:** VastAI instance connectivity varies by datacenter. This particular machine had better peering to HuggingFace than Cloudflare.

**Conclusion:** The 23GB UNet is the fundamental bottleneck. Parallel downloads help, but can't overcome a 10-minute download for a single large file.

---

## Next Steps: Two Investigations

### Investigation 1: User Activity Patterns

**Goal:** Find predictable "hot pockets" to pre-warm instances.

**Data sources to analyze:**
- Discord bot request logs (timestamps, user IDs)
- Database records of generation requests
- Time-of-day / day-of-week patterns

**Questions:**
- Are there predictable daily peaks?
- Do certain users trigger bursts?
- Is there lead-time before requests (e.g., user joins channel → likely request soon)?

**Script needed:** `scripts/analysis/user-activity-patterns.js`

### Investigation 2: VastAI Instance Variance

**Goal:** Understand the variance in setup times and connectivity across instances.

**Data to collect per run:**
- Datacenter/region (from offer data)
- GPU type
- SSH ready time
- Download speeds (HuggingFace vs R2)
- Total cold start time

**Script needed:** `scripts/vastai/benchmark-instance-variance.js`
- Run E2E test N times across different offers
- Record detailed timing breakdown
- Build dataset of instance performance

**Questions:**
- Which datacenters have best connectivity to R2?
- Which datacenters have best connectivity to HuggingFace?
- What's the variance in SSH ready time?
- Are certain GPU types faster to provision?

---

## Alternative Services to Evaluate

If VastAI variance proves too high for user-facing workloads:

- **RunPod** - Similar model, possibly more consistent
- **Lambda Labs** - Higher quality, less variance, more expensive
- **Modal** - Serverless GPU, fast cold starts, pay-per-second
- **Replicate** - Managed inference, no instance management
- **Together.ai** - Inference API with Flux support

Trade-off: Control vs. reliability vs. cost
