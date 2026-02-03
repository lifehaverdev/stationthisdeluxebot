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

**Discovery (Public - No API Key Required):**
```
initialize          - Protocol handshake
tools/list          - List all generation tools with schemas
resources/list      - List LoRA models (paginated)
resources/read      - Search LoRAs or get details
prompts/list        - Get prompt templates
spells/list         - List available spell workflows
spells/get          - Get spell details (public spells only)
```

**Execution (Requires API Key):**
```
tools/call          - Execute a generation tool
spells/cast         - Execute a spell workflow
spells/status       - Check spell execution status
```

**Collections (Requires API Key):**
```
collections/list    - List user's collections
collections/get     - Get collection details
collections/create  - Create new collection
collections/update  - Update collection config
collections/delete  - Delete collection
collections/cook/start  - Start batch generation
collections/cook/pause  - Pause generation
collections/cook/resume - Resume generation
collections/cook/stop   - Stop generation
collections/review  - Review generated pieces
collections/export  - Export approved pieces
```

**Training (Requires API Key):**
```
trainings/list          - List training jobs
trainings/get           - Get training details
trainings/create        - Start new LoRA training
trainings/calculate-cost - Estimate training cost
trainings/delete        - Delete training
trainings/retry         - Retry failed training
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
- **Execute reusable workflows (Spells)**
- **Batch generate and curate collections**
- **Train custom LoRA models**

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

**tools/call Response:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"success\":true,\"generationId\":\"gen_abc123\",\"status\":\"pending\",\"pollUrl\":\"https://noema.art/api/v1/generation/status/gen_abc123\"}"
  }]
}
```

Parse the JSON in `content[0].text` to get the `generationId`.

**Error Response:**
```json
{
  "content": [{ "type": "text", "text": "{\"error\":\"Insufficient credits\"}" }],
  "isError": true
}
```

**Polling for Results:**
```
GET https://noema.art/api/v1/generation/status/{generationId}
Headers: X-API-Key: {key}
```

**Poll Response:**
```json
{
  "generationId": "gen_abc123",
  "status": "completed",
  "progress": 100,
  "result": {
    "image": "https://storage.noema.art/outputs/abc123.png"
  },
  "duration": 12500,
  "cost": { "amount": 0.04, "pointsDeducted": 120 }
}
```

Status values:
- `pending`: Queued (poll again in 2-5 seconds)
- `processing`: Generating (poll again in 2-5 seconds)
- `completed`: Done - result available in `result` field
- `failed`: Error occurred - check `error` field

**Polling Guidance:**
- Poll every 2-5 seconds
- Most images complete in 10-30 seconds
- Videos may take 60-180 seconds
- Give up after 5 minutes if still pending (likely stuck)

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

**Example costingModel:**
```json
{
  "rateSource": "static",
  "staticCost": { "amount": 0.04, "unit": "run" }
}
```
This means 0.04 credits per generation. For time-based tools:
```json
{
  "rateSource": "dynamic",
  "rate": 0.001,
  "unit": "second"
}
```

Users have a credit balance queryable at:
```
GET https://noema.art/api/v1/points
Headers: X-API-Key: {key}
```

**Response:**
```json
{
  "balance": 5000,
  "currency": "points"
}
```

---

## Image Uploads

For img2img, style transfer, or any tool requiring an input image, users must provide an image URL. NOEMA accepts:

1. **Direct URLs** - Publicly accessible image URLs (https://...)
2. **Data URLs** - Base64 encoded images (`data:image/png;base64,...`)
3. **NOEMA URLs** - URLs from previous generations

For tools expecting `imageUrl` parameter:
```json
{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "sdxl-img2img",
  "arguments": {
    "imageUrl": "https://example.com/source-image.jpg",
    "prompt": "transform to watercolor style",
    "denoisingStrength": 0.6
  }
},"id":1}
```

**Note:** Large base64 images may hit size limits. Prefer hosted URLs when possible.

---

## Dataset Upload (for Training)

To train a custom LoRA, you first need to upload a training dataset:

**Step 1: Create Upload Session**
```
POST https://noema.art/api/v1/upload/dataset
Headers: X-API-Key: {key}
Content-Type: application/json

{ "name": "My Character Dataset", "imageCount": 20 }
```

**Step 2: Upload Images**
Upload images to the returned presigned URLs or use the web interface.

**Step 3: Use Dataset ID**
Once uploaded, use the `datasetId` in your training request:
```json
{"jsonrpc":"2.0","method":"trainings/create","params":{
  "name": "My Character LoRA",
  "modelType": "SDXL",
  "datasetId": "dataset_abc123",
  "triggerWords": ["mycharacter"]
},"id":1}
```

**Dataset Best Practices:**
- 10-50 images recommended
- Consistent subject, varied poses/angles/lighting
- High resolution (512x512 minimum, 1024x1024 preferred)
- Clear, uncluttered backgrounds help
- Include close-ups and full shots for characters

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

---

## Spells (Reusable Workflows)

Spells are pre-built, reusable generation workflows that combine multiple steps. Instead of manually orchestrating tool calls, cast a spell to execute a complete workflow.

### When to Use Spells

- User wants a complex multi-step workflow (e.g., "generate and then upscale")
- User wants consistent results using a proven recipe
- User describes a task that matches a known spell pattern
- Simplifying repetitive workflows

### Discovering Spells

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"spells/list","id":1}
```

**Via REST:**
```
GET https://noema.art/api/v1/spells/public
```

**Response Example:**
```json
{
  "spells": [
    {
      "name": "Portrait Generator",
      "slug": "portrait-generator",
      "description": "Generate professional portraits with customizable styles",
      "visibility": "public",
      "inputs": [
        { "name": "subject", "type": "string", "required": true },
        { "name": "style", "type": "string", "required": false }
      ]
    }
  ]
}
```

### Getting Spell Details

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"spells/get","params":{"slug":"portrait-generator"},"id":1}
```

Returns full spell definition including all steps and parameters.

### Casting a Spell

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"spells/cast","params":{
  "slug": "portrait-generator",
  "context": {
    "subject": "a warrior princess",
    "style": "fantasy art"
  }
},"id":1}
```

**Parameters:**
- `slug`: Spell identifier (from spells/list)
- `context`: Input values matching the spell's `inputs` definition

**Via REST:**
```
POST https://noema.art/api/v1/spells/cast
{
  "slug": "portrait-generator",
  "context": { "subject": "a warrior princess", "style": "fantasy art" }
}
```

**Response:**
```json
{
  "castId": "cast_abc123",
  "status": "pending",
  "spellSlug": "portrait-generator"
}
```

### Checking Spell Status

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"spells/status","params":{"castId":"cast_abc123"},"id":1}
```

**Via REST:**
```
GET https://noema.art/api/v1/spells/casts/{castId}
```

**Response:**
```json
{
  "castId": "cast_abc123",
  "status": "completed",
  "progress": 100,
  "results": {
    "outputs": [{ "type": "image", "url": "https://..." }]
  }
}
```

Status values: `pending`, `processing`, `completed`, `failed`

**Polling Guidance:** Poll every 2-5 seconds. Most spells complete within 30-120 seconds depending on complexity. Give up after 5 minutes if still pending.

### Spell Workflow Example

```
User: "Create a professional headshot with multiple variations"

Claude's Process:
1. Search spells → Find "headshot-variations" spell
2. Get spell details → Requires: subject description, count
3. Cast spell with parameters
4. Poll status until complete
5. Return all generated variations to user
```

---

## Collections (Batch Generation)

Collections enable batch generation workflows where you generate many pieces, review them, and export the best ones. This is ideal for creating NFT collections, asset packs, or any project requiring quantity with curation.

### Collection Lifecycle

```
CREATE → COOK → REVIEW → EXPORT
   │        │       │        │
   │        │       │        └─ Package approved pieces
   │        │       └─ Accept/reject each piece
   │        └─ Batch generate (can pause/resume)
   └─ Define config, prompts, target count
```

### When to Use Collections

- User needs many variations of similar content
- User is creating an NFT collection or asset pack
- User wants to generate in bulk and curate the best
- User needs to pause/resume a long generation job

### Creating a Collection

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"collections/create","params":{
  "name": "Fantasy Warriors Collection",
  "targetCount": 100,
  "toolId": "sdxl-base",
  "promptTemplate": "fantasy warrior, {variation}, detailed armor, epic lighting",
  "config": {
    "width": 1024,
    "height": 1024,
    "variations": ["male", "female", "elf", "dwarf", "orc"]
  }
},"id":1}
```

### Starting Generation (Cook)

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"collections/cook/start","params":{"id":"col_abc123"},"id":1}
```

The system will generate pieces in the background. You can:
- **Pause**: `collections/cook/pause` - Temporarily stop
- **Resume**: `collections/cook/resume` - Continue where you left off
- **Stop**: `collections/cook/stop` - End generation entirely

### Reviewing Pieces

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"collections/review","params":{
  "collectionId": "col_abc123",
  "pieceId": "piece_xyz",
  "decision": "accepted"
},"id":1}
```

Decisions: `accepted`, `rejected`

### Exporting Collection

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"collections/export","params":{
  "id": "col_abc123",
  "format": "zip",
  "includeMetadata": true
},"id":1}
```

### Collection Workflow Example

```
User: "I need to create a 50-piece NFT collection of cyberpunk cats"

Claude's Process:
1. Create collection with:
   - name: "Cyberpunk Cats"
   - targetCount: 50
   - toolId: "flux-dev" (good for detailed art)
   - promptTemplate with cyberpunk elements
2. Start cook → Generation begins
3. Periodically check status via collections/get
4. Guide user through review process
5. Export approved pieces when user is satisfied
```

---

## Training (Custom LoRA Models)

Train custom LoRA models to capture specific characters, styles, or concepts. Once trained, your LoRA can be activated via trigger words just like built-in LoRAs.

### Training Workflow

```
PREPARE DATASET → CREATE TRAINING → MONITOR → USE LORA
       │                │              │          │
       │                │              │          └─ Include trigger in prompts
       │                │              └─ Check progress, wait for completion
       │                └─ Configure model type, steps, trigger words
       └─ Upload images (10-50 recommended)
```

### When to Use Training

- User wants consistent character across generations
- User has a unique style they want to replicate
- User wants to fine-tune for specific concepts
- User mentions "train", "teach", "learn my style"

### Supported Model Types

| Model Type | Best For | Training Time |
|------------|----------|---------------|
| `FLUX` | Highest quality, photorealistic | Longer |
| `SDXL` | Balanced quality, large ecosystem | Medium |
| `SD1.5` | Fast training, many existing LoRAs | Shorter |
| `KONTEXT` | Character consistency | Medium |

### Calculating Training Cost

Before committing, estimate the cost:

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"trainings/calculate-cost","params":{
  "modelType": "FLUX",
  "steps": 1000
},"id":1}
```

### Creating a Training Job

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"trainings/create","params":{
  "name": "My Character Sarah",
  "modelType": "SDXL",
  "datasetId": "dataset_abc123",
  "triggerWords": ["sarah_character", "sarahv1"],
  "steps": 1000,
  "loraRank": 16,
  "loraAlpha": 32
},"id":1}
```

**Key Parameters:**
- `datasetId`: Previously uploaded training images
- `triggerWords`: Words that will activate this LoRA
- `steps`: Training iterations (1000 default, more = longer but potentially better)
- `loraRank`: Model capacity (16 default, higher = more detail but larger file)

### Monitoring Training

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"trainings/get","params":{"id":"train_abc123"},"id":1}
```

Status values:
- `pending`: Queued for processing
- `processing`: Training in progress (check `progress` field)
- `completed`: Done - LoRA ready to use
- `failed`: Error occurred (can retry)

### Using Your Trained LoRA

Once completed, the LoRA is automatically available. Use your trigger words in any compatible generation:

```json
{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "sdxl-base",
  "arguments": {
    "prompt": "sarah_character standing in a garden, detailed portrait, soft lighting"
  }
},"id":1}
```

### Training Workflow Example

```
User: "I want to train a model on my character design"

Claude's Process:
1. Confirm user has dataset uploaded (or guide them to upload)
2. Calculate cost → Inform user
3. Create training with appropriate settings:
   - Model type matching their target use case
   - Memorable trigger words
   - Appropriate steps for quality/cost balance
4. Monitor progress → Keep user updated
5. Once complete, demonstrate using the new LoRA
6. Explain how to use trigger words in future generations
```

### Training Best Practices

1. **Dataset Quality**: 10-50 high-quality, varied images work best
2. **Trigger Words**: Use unique, memorable words unlikely to conflict
3. **Steps**: 1000 for quick results, 2000+ for complex concepts
4. **Model Choice**: Match to your primary generation tool
5. **Test First**: Generate samples to verify quality before heavy use

---

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
| `/api/v1/spells/marketplace` | REST: List available spells |
| `/api/v1/spells/cast` | REST: Execute spell |
| `/api/v1/spells/casts/{id}` | REST: Spell status |
| `/api/v1/collections` | REST: Collection management |
| `/api/v1/trainings` | REST: Training management |
| `/.well-known/agent-card.json` | ERC-8004 agent discovery |
| `/.well-known/openapi.json` | OpenAPI spec for Codex/ChatGPT |

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

### Generation Tasks

| Task | Tool Type | LoRA Support | Key Parameters |
|------|-----------|--------------|----------------|
| Text → Image | DALL-E, FLUX, SDXL | DALL-E: No, Others: Yes | prompt, size, quality |
| Image → Image | img2img | Yes | imageUrl, prompt, denoisingStrength |
| Text → Video | LTX Video | No | prompt, duration |
| Image → Video | LTX Video | No | imageUrl, prompt, duration |
| Image → Text | JoyCaption | No | imageUrl, captionType |
| Upscale | Upscaler | No | imageUrl, scale |

### Advanced Features

| Feature | MCP Method | When to Use |
|---------|------------|-------------|
| Spell Workflows | `spells/cast` | Multi-step automated workflows |
| Batch Generation | `collections/cook/start` | Generate many pieces at once |
| Curation | `collections/review` | Accept/reject batch results |
| Custom LoRA Training | `trainings/create` | Teach new characters/styles |
| Cost Estimation | `trainings/calculate-cost` | Before committing to training |

### MCP Method Quick Reference

| Category | List | Execute | Status |
|----------|------|---------|--------|
| Tools | `tools/list` | `tools/call` | via generationId |
| Spells | `spells/list` | `spells/cast` | `spells/status` |
| Collections | `collections/list` | `collections/cook/start` | `collections/get` |
| Trainings | `trainings/list` | `trainings/create` | `trainings/get` |

---

*This skill enables rich AI generation workflows including single generations, spell workflows, batch collections, and custom model training. Always check tool and LoRA availability via the API before making recommendations.*