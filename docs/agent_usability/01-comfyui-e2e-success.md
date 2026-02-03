# ComfyUI E2E Success - Flux + LoRA Pipeline Proven

**Date:** 2026-02-03
**Status:** SUCCESS
**Test Script:** `scripts/vastai/test-e2e-comfyui.js`

## What We Proved

End-to-end pipeline for running Flux Schnell + custom LoRA on rented GPU:

1. Rent GPU via VastAI API
2. SSH into instance
3. Install ComfyUI + dependencies
4. Download models from HuggingFace
5. Run workflow via ComfyUI API
6. Retrieve generated image
7. Terminate instance

## Results

| Metric | Value |
|--------|-------|
| Total time | 593s (~10 min) |
| GPU | RTX 3090 |
| Cost | ~$0.03 |
| Output | 1024x1024 PNG, 991KB |

### Time Breakdown

| Step | Time | % of Total |
|------|------|------------|
| SSH ready | 42s | 7% |
| PyTorch upgrade | 69s | 12% |
| ComfyUI + requirements | 36s | 6% |
| **Model downloads** | **390s** | **66%** |
| Generation | 20s | 3% |
| Other | 36s | 6% |

### Model Downloads (the bottleneck)

| Model | Size | Time |
|-------|------|------|
| flux1-schnell.safetensors | 23GB | 3.5 min |
| t5xxl_fp16.safetensors | 9.2GB | 2.4 min |
| ae.safetensors | 320MB | 5s |
| clip_l.safetensors | 235MB | 6s |
| b0throps.safetensors | 328MB | 7s |
| **Total** | **~33GB** | **~6.5 min** |

Download speed: ~85 MB/s average from HuggingFace

## Key Learnings

1. **PyTorch version matters** - ComfyUI requires 2.4+ for `torch.uint64`. Base `pytorch:2.1.0` image needs upgrade.

2. **setsid pattern works** - Background process detachment pattern from TrainingRunner works for ComfyUI too.

3. **HF_TOKEN required** - Flux is a gated model, needs authentication header for downloads.

4. **Model loading is instant** - Once downloaded, ComfyUI loads models and generates in ~20 seconds.

5. **RTX 3090 is sufficient** - 24GB VRAM handles Flux + LoRA comfortably at fp8.

## Problem: 10 Minute Latency is Unacceptable

**Target:** 2-3 minutes cold start to result

**Current breakdown:**
- ~2.5 min: Setup overhead (SSH, installs)
- ~6.5 min: Model downloads (THE BOTTLENECK)
- ~0.5 min: Generation

**66% of time is downloading 33GB of models.**

## Next Steps

See `02-latency-optimization-strategy.md` for approaches to hit 2-3 minute target.

## Reproduction

```bash
# Requires: HF_TOKEN, VASTAI_API_KEY, SSH key configured
node scripts/vastai/test-e2e-comfyui.js
```

Output image demonstrates b0throps LoRA style applied to Flux Schnell generation.
