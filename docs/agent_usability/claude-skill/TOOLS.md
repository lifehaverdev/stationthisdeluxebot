# NOEMA Tool Capabilities

This document describes the types of tools available on NOEMA and how to select the right one for a user's needs.

## Tool Categories

### Text-to-Image
Generate images from text descriptions.

| Tool | Provider | Checkpoint | LoRA Support | Best For |
|------|----------|------------|--------------|----------|
| DALL-E 3 | OpenAI | N/A | No | High-quality general images, prompt following |
| FLUX tools | ComfyUI | FLUX | Yes | Stylized images with LoRA customization |
| SDXL tools | ComfyUI | SDXL | Yes | Diverse styles, large LoRA ecosystem |
| SD 1.5 tools | ComfyUI | SD1.5 | Yes | Legacy LoRAs, faster generation |

**Selection criteria:**
- Need LoRAs? → Use FLUX/SDXL/SD1.5 tools
- Need prompt accuracy? → DALL-E 3 excels at following complex prompts
- Need specific style? → Check which checkpoint has the LoRA

### Image-to-Image (img2img)
Transform existing images with style or modifications.

**Use when:**
- User provides a reference image
- Wants to change style while keeping composition
- Needs to iterate on an existing generation

**Parameters:**
- `imageUrl`: Source image
- `prompt`: Desired transformation
- `denoisingStrength`: 0.0 (minimal change) to 1.0 (complete redraw)

### Video Generation
Create short video clips from text or images.

| Tool | Input | Duration | Best For |
|------|-------|----------|----------|
| LTX Video | Text or Image | 2-5 sec | Quick motion, image animation |
| Vidu | Text | Variable | Longer sequences |

**Considerations:**
- Video generation is slower and more expensive
- Results vary more than image generation
- Keep prompts simple - focus on motion

### Image-to-Text (Interrogation/Captioning)
Analyze images and generate descriptions.

| Tool | Output Types |
|------|--------------|
| JoyCaption | Descriptive prose, SD prompts, MidJourney prompts, Booru tags, art critique |

**Use when:**
- User wants to understand an image
- Need to recreate a style from reference
- Building training datasets
- Reverse-engineering prompts

### Upscaling
Increase image resolution.

**Use when:**
- User has a low-res image they like
- Need print-quality output
- Want to add detail to generations

### Inpainting
Edit specific regions of an image.

**Use when:**
- User wants to change part of an image
- Fix artifacts or unwanted elements
- Add objects to existing scenes

**Requires:**
- Source image
- Mask (indicating area to change)
- Prompt for new content

## Tool Selection Flowchart

```
User wants to create something
    │
    ├─► Video? ──────────────► LTX Video / Vidu
    │
    ├─► From existing image?
    │       │
    │       ├─► Change style ───► img2img tool
    │       ├─► Edit region ────► Inpainting tool
    │       ├─► Make bigger ────► Upscaler
    │       └─► Describe it ────► JoyCaption
    │
    └─► New image from text?
            │
            ├─► Need specific LoRA?
            │       │
            │       ├─► Yes ──► Check LoRA checkpoint
            │       │              │
            │       │              ├─► FLUX LoRA ──► FLUX tool
            │       │              ├─► SDXL LoRA ──► SDXL tool
            │       │              └─► SD1.5 LoRA ─► SD1.5 tool
            │       │
            │       └─► No ───► DALL-E 3 (best prompt following)
            │
            └─► Priority is quality/accuracy? ──► DALL-E 3
```

## Tool Parameter Patterns

### Common Image Parameters

| Parameter | Type | Typical Values | Notes |
|-----------|------|----------------|-------|
| `prompt` | string | - | Main generation prompt |
| `negative_prompt` | string | "blurry, low quality" | What to avoid |
| `width` | number | 512, 768, 1024 | Output width |
| `height` | number | 512, 768, 1024 | Output height |
| `seed` | number | -1 (random) | Reproducibility |
| `steps` | number | 20-50 | Quality vs speed |
| `cfg_scale` | number | 5-15 | Prompt adherence strength |

### DALL-E Specific

| Parameter | Options | Default |
|-----------|---------|---------|
| `model` | gpt-image-1, dall-e-3, dall-e-2 | dall-e-3 |
| `quality` | standard, hd, low, medium, high | standard |
| `size` | 1024x1024, 1024x1792, 1792x1024 | 1024x1024 |

### Video Specific

| Parameter | Type | Notes |
|-----------|------|-------|
| `duration` | number | Seconds (typically 2-5) |
| `imageUrl` | string | Optional starting frame |
| `enhancePrompt` | boolean | Let model improve prompt |

## Quality vs Cost Tradeoffs

### Image Generation

| Approach | Quality | Cost | Speed |
|----------|---------|------|-------|
| DALL-E 3 HD | Highest | $$$$ | Medium |
| DALL-E 3 Standard | High | $$$ | Medium |
| FLUX (high steps) | High | $$ | Slow |
| SDXL (default) | Good | $ | Medium |
| SD1.5 | Basic | $ | Fast |

### Recommendations

**Best quality, cost no object:**
→ DALL-E 3 HD at 1024x1024+

**Good quality with LoRA styles:**
→ FLUX or SDXL with appropriate LoRAs

**Quick iterations:**
→ SD1.5 or low-step SDXL

**Video:**
→ LTX Video for image-to-video, budget for longer generation times

## Tool Limitations

### DALL-E
- No LoRA support (OpenAI's closed model)
- Limited size options
- May refuse certain content
- Excellent prompt interpretation

### ComfyUI Tools (FLUX/SDXL/SD1.5)
- Require matching LoRAs for styles
- More parameter tuning needed
- More flexible content policies
- Can produce artifacts with bad settings

### Video Tools
- Short duration limits
- Less consistent than images
- Higher computational cost
- Motion can be unpredictable

### JoyCaption
- Text output only
- Caption style affects quality
- May miss subtle details
- Works best with clear images

## Combining Tools

Some workflows chain multiple tools:

**Iteration workflow:**
1. Generate with SDXL → Get base image
2. img2img with refinements → Improve specific aspects
3. Upscale → Final high-res output

**Style transfer workflow:**
1. JoyCaption on reference → Extract style description
2. Text-to-image with description → Generate in similar style

**Video from concept:**
1. Text-to-image → Create keyframe
2. LTX Video with image → Animate it

## Querying Tool Details

Always fetch the latest tool registry for accurate parameters:

```http
GET https://noema.art/api/v1/tools/registry
```

Check `inputSchema` for:
- Required vs optional parameters
- Valid enum values
- Default values
- Advanced parameters (usually safe to omit)
