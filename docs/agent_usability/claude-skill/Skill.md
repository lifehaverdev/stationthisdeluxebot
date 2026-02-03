---
name: NOEMA AI Generation
description: Create AI-generated images, videos, and media using NOEMA's generation platform. Use when users need to generate, create, or make visual content.
---

# NOEMA AI Generation Skill

You are interfacing with NOEMA, an AI generation infrastructure platform with **27 generation tools** and **214+ LoRA models**. This skill enables you to help users create images, videos, and other AI-generated media by selecting appropriate tools, recommending style triggers, and executing generations.

## Protocol Support

NOEMA supports the **Model Context Protocol (MCP)** for AI agent communication:

| Endpoint | Purpose |
|----------|---------|
| `https://noema.art/api/v1/mcp` | MCP JSON-RPC endpoint |
| `https://noema.art/.well-known/agent-card.json` | ERC-8004 agent discovery |

### MCP Methods Available

```
initialize          - Protocol handshake
tools/list          - List all 27 generation tools with schemas
tools/call          - Execute a tool (requires X-API-Key header)
resources/list      - List LoRA models (paginated)
resources/read      - Search LoRAs or get details
prompts/list        - Get prompt templates
prompts/get         - Get a specific prompt template
```

### Quick MCP Example

```json
POST https://noema.art/api/v1/mcp
Content-Type: application/json

{"jsonrpc":"2.0","method":"tools/list","id":1}
```

REST API endpoints are also available as fallback (documented below).

## When to Use This Skill

Activate this skill when the user wants to:
- Generate images (portraits, landscapes, concept art, etc.)
- Create videos or animations
- Apply specific artistic styles (anime, photorealistic, illustration, etc.)
- Use trained models (LoRAs) for characters, styles, or concepts
- Upscale or enhance existing images
- Transform images (img2img, inpainting)

## Core Concepts

### Tools
NOEMA exposes multiple generation tools, each with different capabilities:
- **Image generators**: FLUX, DALL-E, Stable Diffusion variants
- **Video generators**: LTX Video, Vidu, etc.
- **Utility tools**: Upscalers, interrogators (image-to-text), inpainting

### Trigger Words
NOEMA has a library of trained LoRA models that activate via **trigger words** in prompts. When a user mentions a style or concept, check if there's a matching trigger word to enhance their generation.

Example: User says "Studio Ghibli style" → Include `GHIBLI` in the prompt to activate the Ghibli LoRA.

### Checkpoints
LoRAs are trained on specific base models (checkpoints): `FLUX`, `SDXL`, `SD1.5`, `SD3`. A LoRA only works with its compatible checkpoint. Match tools to LoRAs by checkpoint.

## Workflow

### Step 1: Understand Intent
Parse what the user wants to create:
- Subject matter (person, landscape, object, abstract)
- Style (photorealistic, anime, painterly, 3D render)
- Medium (image, video, animation)
- Any specific references or inspirations

### Step 2: Discover Available Tools

**Via MCP (preferred):**
```json
POST https://noema.art/api/v1/mcp
{"jsonrpc":"2.0","method":"tools/list","id":1}
```

**Via REST API:**
```
GET https://noema.art/api/v1/tools/registry
```

Response includes tools with:
- `toolId`: Identifier for execution
- `displayName`: Human-readable name
- `description`: What the tool does
- `inputSchema`: Required and optional parameters
- `costingModel`: Price information
- `metadata.baseModel`: Checkpoint compatibility (important for LoRA matching)

Select a tool based on:
1. Output type (image vs video)
2. Checkpoint compatibility with desired LoRAs
3. Quality vs speed tradeoffs
4. Cost considerations

### Step 3: Find Relevant Trigger Words

**Via MCP (preferred):**
```json
POST https://noema.art/api/v1/mcp
{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"noema://lora/search?q=anime&checkpoint=SDXL"},"id":1}
```

**Via REST API:**
```
GET https://noema.art/api/v1/loras/list?checkpoint={checkpoint}&q={search}
```

Parameters:
- `checkpoint`: Filter by base model (`FLUX`, `SDXL`, `SD1.5`, `All`)
- `q`: Search query - searches across **name, slug, triggerWords, description, and tags**
- `filterType`: `popular`, `recent`, `type_category`
- `limit`: Number of results (default 20)

**Search Power**: The `q` parameter does semantic search. You can search by:
- Trigger name: `q=ghibli`
- Style concept: `q=dreamy` or `q=airbrushed`
- Subject type: `q=portrait` or `q=landscape`
- Aesthetic: `q=retro` or `q=cyberpunk`
- Category: `q=meme` or `q=anime`

Example: User says "something soft and ethereal" → search `q=ethereal` or `q=dreamy`

Response includes LoRAs with:
- `name`: Display name
- `triggerWords`: Array of activation phrases to use in prompts
- `description`: **Detailed description of visual effect, best uses, and limitations** - use this to make recommendations
- `checkpoint`: Compatible base model
- `defaultWeight`: Recommended strength (0.0-2.0)
- `tags`: Categories (style, character, concept)
- `previewImages`: Sample outputs

**Important**: Recommend trigger words that match the tool's checkpoint. Don't recommend SDXL LoRAs for a FLUX tool.

### Step 4: Craft the Prompt
Build a prompt that:
1. Describes the subject clearly
2. Includes relevant trigger words for activated LoRAs
3. Specifies style, lighting, composition as needed
4. Uses natural language - the system auto-detects triggers

Example prompt construction:
```
User wants: "A cat in anime style with dreamy lighting"
Available LoRA: joycatv2 (triggers: "joycat", "anime joycat")

Crafted prompt: "anime joycat sitting in soft dreamy lighting,
ethereal atmosphere, detailed fur, studio lighting"
```

### Step 5: Execute Generation

**Via MCP (requires X-API-Key header):**
```json
POST https://noema.art/api/v1/mcp
Headers: X-API-Key: {user_api_key}

{"jsonrpc":"2.0","method":"tools/call","params":{"name":"flux-dev","arguments":{"prompt":"your crafted prompt","width":1024,"height":1024}},"id":1}
```

**Via REST API:**
```
POST https://noema.art/api/v1/generation/cast
Headers:
  X-API-Key: {user_api_key}
  Content-Type: application/json

Body:
{
  "toolId": "flux-dev",
  "parameters": {
    "prompt": "your crafted prompt here",
    "negative_prompt": "blurry, low quality, distorted",
    "width": 1024,
    "height": 1024
  },
  "deliveryMode": "webhook" | "immediate"
}
```

### Step 6: Handle Results
For immediate delivery, the response contains the result directly.

For webhook/async delivery, poll for status:
```
GET https://noema.art/api/v1/generation/status/{generationId}
```

Status values:
- `pending`: Queued
- `processing`: Generating
- `completed`: Done - result available
- `failed`: Error occurred

## Authentication

Users need an API key to execute generations. Guide them to obtain one:
1. Visit the NOEMA web interface
2. Navigate to Account/Settings
3. Generate an API key
4. Use header: `X-API-Key: {key}`

Discovery endpoints (tools, LoRAs) are public and don't require authentication.

## Cost Awareness

Before executing, inform users of estimated cost:
- Check `tool.costingModel` for pricing model
- `rate`: Cost per unit
- `unit`: `second` | `token` | `request`
- Estimate based on expected duration/complexity

Users have a credit balance queryable at:
```
GET https://noema.art/api/v1/points
Headers: X-API-Key: {key}
```

## Trigger Word Best Practices

1. **Use exact trigger words**: `GHIBLI` not `ghibli style` (though cognates may handle this)
2. **Don't over-trigger**: 2-3 LoRAs maximum per generation
3. **Weight control**: Append `:weight` to control strength (e.g., `GHIBLI:0.5` for subtle effect)
4. **Checkpoint matching**: Only use triggers compatible with the selected tool's base model

## Common Patterns

### Style Transfer
User: "Make this photo look like a watercolor painting"
→ Find watercolor LoRA → Use img2img tool → Apply trigger

### Character Consistency
User: "Generate my character Sarah again"
→ Check if user has trained LoRA for "Sarah" → Use their trigger word

### Quality Enhancement
User: "Make this image higher resolution"
→ Use upscaler tool (no LoRAs needed)

### Prompt Analysis
User: "What's in this image?"
→ Use interrogator/captioning tool → Return description

## Error Handling

| Error | Meaning | Action |
|-------|---------|--------|
| 401 Unauthorized | Invalid/missing API key | Guide user to authentication |
| 402 Payment Required | Insufficient credits | Inform user to add credits |
| 404 Not Found | Invalid tool/LoRA | Verify IDs against registry |
| 429 Rate Limited | Too many requests | Wait and retry |
| 502 Bad Gateway | Backend service issue | Retry after delay |

## Environment

**Base URL:** `https://noema.art`

| Endpoint | Purpose |
|----------|---------|
| `/api/v1/mcp` | MCP protocol (preferred for agents) |
| `/api/v1/tools/registry` | REST: List all tools |
| `/api/v1/loras/list` | REST: List/search LoRAs |
| `/api/v1/generation/cast` | REST: Execute generation |
| `/api/v1/generation/status/{id}` | REST: Poll for results |
| `/.well-known/agent-card.json` | ERC-8004 agent discovery |

## Reference Documents

For detailed information, consult these supplementary files:

- **TOOLS.md** - Complete tool capabilities, selection flowchart, parameter reference
- **TRIGGER-WORDS.md** - Deep dive into trigger word system, weights, checkpoint matching
- **API-REFERENCE.md** - Full endpoint documentation with request/response examples

## MCP Protocol Reference

The MCP endpoint follows the Model Context Protocol specification (version 2025-11-25).

### Server Capabilities

```json
{
  "tools": { "listChanged": false },
  "resources": { "subscribe": false, "listChanged": false },
  "prompts": { "listChanged": false }
}
```

### Resources (LoRAs)

LoRAs are exposed as MCP resources with URI scheme `noema://lora/{slug}`.

Search LoRAs:
```
noema://lora/search?q={query}&checkpoint={FLUX|SDXL|SD1.5}
```

### Prompt Templates

Available prompts: `portrait`, `landscape`, `style-transfer`

```json
{"jsonrpc":"2.0","method":"prompts/get","params":{"name":"portrait","arguments":{"subject":"a warrior","style":"oil painting"}},"id":1}
```

## Example Session

### Simple Generation

```
User: "I want to create an anime-style portrait of a girl with cat ears"

Claude's Process:
1. Parse intent: anime portrait, character with cat ears
2. Query tools → Find SDXL image generator (good LoRA support)
3. Query LoRAs → Search "anime" with checkpoint=SDXL
   Found: anime_style_xl (triggers: ["anime_xl"])
4. Query LoRAs → Search "cat"
   Found: catgirl_v2 (triggers: ["catgirl"], checkpoint: SDXL)
5. Craft prompt incorporating triggers:
   "catgirl portrait, anime_xl style, detailed eyes, soft lighting,
   upper body shot, looking at viewer"
6. Check user has API key
7. Execute generation with SDXL tool
8. Poll for result
9. Return image URL to user
```

### With Style Reference

```
User: "Make this look like a Studio Ghibli scene" [attaches image]

Claude's Process:
1. Parse intent: style transfer to Ghibli aesthetic
2. User provided image → img2img workflow
3. Query LoRAs → Search "ghibli"
   Found: ghibli_style (triggers: ["GHIBLI"], checkpoint: SDXL)
4. Select img2img tool matching SDXL checkpoint
5. Craft prompt: "GHIBLI style, soft colors, hand-painted aesthetic,
   whimsical atmosphere"
6. Set denoisingStrength: 0.6 (preserve composition, change style)
7. Execute with source image
8. Return transformed image
```

### Discovery Only

```
User: "What styles can I use for fantasy art?"

Claude's Process:
1. Parse intent: discovery, not generation
2. Query LoRAs → Search "fantasy" across all checkpoints
3. Return list of options with:
   - LoRA names and descriptions
   - Trigger words to use
   - Which tools they work with
   - Preview images if available
4. Let user choose, then proceed to generation if requested
```

## Quick Reference

| Task | Tool Type | LoRA Support | Key Parameters |
|------|-----------|--------------|----------------|
| Text → Image | DALL-E, FLUX, SDXL | DALL-E: No, Others: Yes | prompt, size, quality |
| Image → Image | img2img | Yes | imageUrl, prompt, denoisingStrength |
| Text → Video | LTX Video | No | prompt, duration |
| Image → Video | LTX Video | No | imageUrl, prompt, duration |
| Image → Text | JoyCaption | No | imageUrl, captionType |
| Upscale | Upscaler | No | imageUrl, scale |

---

*This skill enables rich AI generation workflows. Always check tool and LoRA availability via the API before making recommendations.*