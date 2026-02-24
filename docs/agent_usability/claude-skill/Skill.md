---
name: NOEMA AI Generation
description: Create AI-generated images, videos, and media using NOEMA's generation platform. Use when users need to generate, create, or make visual content.
---

# NOEMA AI Generation Skill

You are interfacing with NOEMA, an AI generation infrastructure platform with **27 generation tools** and **214+ LoRA models**. This skill enables you to help users create images, videos, and other AI-generated media by selecting appropriate tools, recommending style triggers, and executing generations.

NOEMA is open source. Source code: [github.com/lifehaverdev/stationthisdeluxebot](https://github.com/lifehaverdev/stationthisdeluxebot)

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
spells/create       - Author a new spell from tool steps
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

---

## Recommended Workflows

**Read this section first.** Choosing the right workflow dramatically improves results. Use these decision patterns to pick the best approach.

### Decision Tree: What Workflow Should I Use?

```
User wants to create something
    │
    ├─► How many pieces?
    │       │
    │       ├─► 1-5 pieces ──────────► Single Generation Flow
    │       │
    │       ├─► 5-20 pieces ─────────► Use input_batch for variations
    │       │
    │       └─► 20+ pieces ──────────► Collections Flow (batch + curate)
    │
    ├─► Does user mention a specific style?
    │       │
    │       ├─► Yes ─────────────────► LoRA-First Flow (search before generating)
    │       │
    │       └─► No, generic request ─► Quick Generation (DALL-E or FLUX)
    │
    ├─► Does user want character/subject consistency?
    │       │
    │       ├─► Across 2-3 images ───► Same seed + similar prompts
    │       │
    │       └─► Ongoing consistency ─► Training Flow (create custom LoRA)
    │
    ├─► Is this a complex multi-step task?
    │       │
    │       └─► Yes ─────────────────► Check Spells (pre-built workflows)
    │
    └─► Does user want to explore options?
            │
            └─► Yes ─────────────────► Discovery Flow (browse before committing)
```

### Flow 1: Single Generation (Quick)

**When:** User wants 1-5 images, no specific style mentioned, speed matters.

**Pattern:**
1. Pick tool based on output type (image → DALL-E/FLUX, video → LTX)
2. Craft prompt from user description
3. Execute generation
4. Return result

**Best tools:** `dall-e-3` (best prompt following), `make` (default image generator)

**Example:**
```
User: "Generate a picture of a sunset over mountains"
→ Use dall-e-3, no LoRA needed, single generation
```

### Flow 1b: Batch Variations (5-20 pieces)

**When:** User wants multiple variations of the same concept, but not a full collection workflow.

**Pattern:**
1. Use `input_batch` parameter to generate multiple variations in one call
2. Variations can differ by prompt tweaks, seeds, or other parameters
3. Return all results for user to pick favorites

**Example:**
```
User: "Give me 10 different takes on a cyberpunk cityscape"

→ Use tools/call with input_batch containing 10 prompt variations
→ Returns 10 images in single response
→ User picks favorites
```

**When to use Collections instead:** If user needs curation workflow (accept/reject UI), export packaging, or 20+ pieces, use Collections flow.

### Flow 2: LoRA-First (Styled Generation)

**When:** User mentions ANY style, aesthetic, or artistic reference.

**Pattern:**
1. **ALWAYS search LoRAs first** - even if you think you know what to use
2. Match LoRA checkpoint to tool (FLUX LoRA → FLUX tool)
3. Include trigger words in prompt
4. Execute generation

**Why LoRA-first matters:** NOEMA has 214+ style models. A generation with the right LoRA trigger produces dramatically better results than prompt engineering alone.

**Style signals to watch for:**
- Artist names: "like Ghibli", "Moebius style"
- Aesthetics: "cyberpunk", "cottagecore", "vaporwave"
- Media types: "anime", "oil painting", "pixel art"
- Moods: "dreamy", "dark", "ethereal"
- Eras: "80s", "vintage", "retro"

**Example - Single LoRA:**
```
User: "Create a portrait with a dreamy, ethereal look"

1. Search: resources/read with q=dreamy or q=ethereal
2. Found: ethereal_portrait (triggers: ["ethereal_portrait"], checkpoint: SDXL)
3. Select tool: sdxl-base (matches checkpoint)
4. Craft prompt: "ethereal_portrait portrait, soft lighting, mystical atmosphere"
5. Execute with SDXL tool
```

**Example - Combining LoRAs:**
```
User: "Ghibli style but with a dreamy ethereal vibe"

1. Search: resources/read with q=ghibli → Found: ghibli_style (SDXL)
2. Search: resources/read with q=ethereal → Found: ethereal_portrait (SDXL)
3. Both are SDXL ✓ - can combine
4. Craft prompt with reduced weights:
   "ghibli_style:0.5 ethereal_portrait:0.4 portrait of a girl in a meadow, soft lighting"
5. Execute with sdxl-base tool
```

**Anti-pattern:** Don't skip LoRA search because "the prompt is detailed enough." The LoRA adds trained aesthetic understanding that prompts alone cannot achieve.

**Fallback - No LoRA found:**
```
User: "Make it look like a fantasy painting"

1. Search: resources/read with q=fantasy → Empty results
2. Try related terms: q=painterly, q=epic, q=magical
3. Still empty? → Fall back to prompt-only generation:
   - Use DALL-E 3 (best prompt interpretation)
   - Include style details in prompt: "epic fantasy painting style,
     dramatic lighting, detailed brushwork, magical atmosphere"
4. Inform user: "I didn't find a specific fantasy LoRA, but I've
   crafted a detailed prompt. For future sessions, we could train
   a custom LoRA if you want this style consistently."
```

### Flow 3: Collections (Batch Production)

**When:** User needs 6+ pieces, wants to curate quality, or mentions "collection", "set", "batch", "NFT", "assets".

**Pattern:**
1. Create collection with target count and prompt template
2. Start cook (batch generation)
3. Let it run (can pause/resume)
4. Review generated pieces (accept/reject)
5. Export approved pieces

**Why Collections over repeated tools/call:**
- **Curation built-in:** Review and select the best
- **Cost efficient:** Batch processing, no repeated setup
- **Resumable:** Pause overnight, continue tomorrow
- **Export-ready:** Package approved pieces with metadata

**Example:**
```
User: "I need 50 fantasy character portraits for my game"

1. Create collection:
   - name: "Fantasy Characters"
   - targetCount: 50
   - toolId: "sdxl-base"
   - promptTemplate: "fantasy character portrait, {variation}, detailed armor"
   - variations: ["warrior", "mage", "rogue", "healer", "ranger"]

2. Start cook → Generates in background
3. Review pieces as they complete
4. Export approved set with metadata
```

**Guidance for users:** "For 50 pieces, I recommend using Collections. You'll generate a batch, review them, and export only the ones you like. This gives much better results than generating 50 individually."

### Flow 4: Training (Custom LoRA)

**When:** User wants consistent character/style across MANY generations, or says "my character", "my style", "remember this", "use this again".

**Pattern:**
1. Guide user to prepare dataset (10-50 images)
2. Calculate training cost (set expectations)
3. Create training job with memorable trigger words
4. Monitor progress
5. Once complete, use trigger in future generations

**Training signals:**
- "I want my OC to be consistent"
- "Can you learn my art style?"
- "I'll be generating this character a lot"
- "Make it look like my previous work"

**Example:**
```
User: "I have a character named Aria that I want to use in many images"

1. Ask: "Do you have 10-50 reference images of Aria?"
2. If yes → Guide through dataset upload
3. Calculate cost → "Training will cost approximately X credits"
4. Create training:
   - name: "Aria Character"
   - triggerWords: ["aria_char", "aria_oc"]
   - modelType: "SDXL"
5. Wait for completion (~30-60 min)
6. Future generations: "aria_char standing in a garden..."
```

**When NOT to train:**
- User only needs 2-3 images (use same seed instead)
- Style already exists as public LoRA (search first!)
- User is experimenting, not committed to a direction

### Flow 5: Discovery (Exploration)

**When:** User is exploring possibilities, asking "what can you do", or unsure what they want.

**Pattern:**
1. Understand general direction (image type, vibe, use case)
2. Search LoRAs for relevant styles
3. Present options with descriptions and previews
4. Let user choose before generating
5. Generate based on selection

**Discovery signals:**
- "What styles do you have?"
- "Show me options for..."
- "I'm not sure exactly what I want"
- "What would look good for...?"

**Example:**
```
User: "I want to make some fantasy art but I'm not sure what style"

1. Search LoRAs: q=fantasy
2. Present options:
   - "epic_fantasy_xl: Dramatic, detailed, game-art style"
   - "watercolor_fantasy: Soft, painterly, storybook feel"
   - "dark_fantasy_v2: Gritty, moody, mature themes"
3. User picks → Then proceed with LoRA-First flow
```

### Flow 6: Spells (Complex Workflows)

**When:** Task requires multiple coordinated steps, OR you notice yourself repeating the same tool chain.

**Two spell patterns:**

#### Pattern A: Use Existing Spell
1. Check spells/list for matching workflow
2. If spell exists → Cast it (simpler than manual orchestration)

#### Pattern B: Create New Spell (Authoring)
**Trigger:** You find yourself chaining the same tools in sequence repeatedly.

1. Recognize the pattern: "I keep doing generate → upscale → caption"
2. Suggest to user: "I notice we keep doing this same workflow. Want me to create a spell so it's one-click next time?"
3. If yes → Author a new spell capturing the workflow
4. Future runs → Cast the spell instead of manual steps

**Spell signals:**
- Multi-step tasks: "generate then upscale then..."
- Repeatable workflows: "do that thing you did before"
- Complex pipelines: "I need to process these in a specific way"
- **Pattern recognition:** Agent notices repeated tool chains in conversation

**Example - Using existing spell:**
```
User: "Generate a portrait and then upscale it to 4K"

1. Check spells → Found: "portrait-upscale" spell
2. Cast spell with parameters
3. Spell handles: generate → upscale → return
```

**Example - Creating a spell:**
```
[After doing generate → style-transfer → upscale three times...]

Agent: "I notice we keep doing the same workflow: generate, apply
style transfer, then upscale. Would you like me to create a spell
called 'styled-upscale' so you can do this in one step next time?"

User: "Yes please"
```

**Via MCP - spells/create:**
```json
{"jsonrpc":"2.0","method":"spells/create","params":{
  "name": "Styled Upscale",
  "description": "Generate image, apply style transfer, then upscale to 4K",
  "steps": [
    {
      "stepId": 1,
      "toolIdentifier": "make",
      "parameters": { "width": 1024, "height": 1024 }
    },
    {
      "stepId": 2,
      "toolIdentifier": "sdxl-img2img",
      "parameters": { "denoisingStrength": 0.4 }
    },
    {
      "stepId": 3,
      "toolIdentifier": "real-esrgan-4x",
      "parameters": { "scale": 4 }
    }
  ],
  "connections": [
    { "from": { "stepId": 1, "output": "image" }, "to": { "stepId": 2, "input": "imageUrl" } },
    { "from": { "stepId": 2, "output": "image" }, "to": { "stepId": 3, "input": "imageUrl" } }
  ],
  "exposedInputs": ["prompt", "style"],
  "visibility": "private"
},"id":1}
```

**spells/create parameters:**
| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable spell name |
| `description` | No | What the spell does |
| `steps` | Yes | Array of tool steps (see below) |
| `connections` | Yes | How outputs flow to inputs |
| `exposedInputs` | No | Parameters user provides when casting |
| `visibility` | No | `private` (default), `listed`, or `public` |
| `tags` | No | Categorization tags |

**Step structure:**
```json
{
  "stepId": 1,                    // Unique ID within spell
  "toolIdentifier": "make",   // Tool from tools/list
  "parameters": { ... }           // Default parameters for this step
}
```

**Connection structure:**
```json
{
  "from": { "stepId": 1, "output": "image" },
  "to": { "stepId": 2, "input": "imageUrl" }
}
```

**After creation:** The spell is saved to the user's spellbook. Future casts:
```json
{"jsonrpc":"2.0","method":"spells/cast","params":{"slug":"styled-upscale-abc123","context":{"prompt":"a warrior"}},"id":1}
```

**Why spell authoring matters:** Agents that create spells provide compounding value. Each created spell makes future sessions faster and more consistent.

---

## Workflow Selection Summary

| User Signal | Recommended Flow | Key Action |
|-------------|------------------|------------|
| Quick single image | Single Generation | Pick fast tool, execute |
| Mentions any style | LoRA-First | **Always search LoRAs** |
| Needs 5-20 pieces | Input Batch | Use `input_batch` for variations |
| Needs 20+ pieces | Collections | Create, cook, curate, export |
| Wants consistency | Training | Guide dataset → train LoRA |
| Exploring options | Discovery | Search → present → let them choose |
| Complex multi-step | Spells | Check for existing spell first |
| Repeated tool chains | Spell Authoring | **Create a spell to capture the pattern** |

**Golden Rules:**
1. When in doubt, search LoRAs first. The right trigger word transforms mediocre results into excellent ones.
2. Notice patterns. If you're chaining the same tools repeatedly, create a spell.

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
- `toolId`: Primary identifier for execution (may be a hash like `comfy-abc123...`)
- `displayName`: Human-readable name (e.g., "FLUX Dev")
- `commandName`: Alias usable for execution (e.g., "/make", "/fluxdev")
- `description`: What the tool does
- `inputSchema`: Required and optional parameters
- `costingModel`: Price information
- `metadata.baseModel`: Checkpoint compatibility (important for LoRA matching)

**Tool Aliases:** When calling `tools/call`, you can use any of these to identify a tool:
- The exact `toolId` (hash-based IDs like `comfy-abc123...`)
- The `commandName` with or without leading `/` (e.g., "make" or "/make")
- The `displayName` (case-insensitive, e.g., "FLUX Dev")

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

{"jsonrpc":"2.0","method":"tools/call","params":{"name":"make","arguments":{"prompt":"your crafted prompt","width":1024,"height":1024}},"id":1}
```

**Note:** The `name` parameter accepts tool aliases. Use "make" for the default image generator, or get the exact tool name from `tools/list`. You can use commandNames (like "make", "fluxdev"), displayNames, or the full toolId.

**Via REST API:**
```
POST https://noema.art/api/v1/generation/execute
Headers:
  X-API-Key: {user_api_key}
  Content-Type: application/json

Body:
{
  "toolId": "make",
  "inputs": {
    "prompt": "your crafted prompt here",
    "negative_prompt": "blurry, low quality, distorted",
    "width": 1024,
    "height": 1024
  }
}
```

**Note:** `/api/v1/generation/cast` is also available as an alias for backward compatibility. The `toolId` accepts aliases like "make" (the default image generator), commandNames, displayNames, or the exact toolId from `tools/list`.

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

## Agent Onboarding

New to NOEMA? Here's how to get started as an autonomous agent.

---

### Primary Path: Magic Amount Wallet Linking

**This is the recommended path for AI agents.** Link your wallet and generate an API key by sending a unique "magic amount" deposit. The system detects your specific deposit amount and automatically completes account setup.

**Step 1: Initiate Wallet Linking**

```
POST https://noema.art/api/v1/wallets/initiate
Content-Type: application/json
X-API-Key: {existing_key_or_session}

{
  "tokenAddress": "0x0000000000000000000000000000000000000000"
}
```

Response:
```json
{
  "requestId": "abc123...",
  "magicAmount": "0.000047829156382",
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "expiresAt": "2026-02-03T12:15:00Z",
  "depositToAddress": "0xFoundationContractAddress..."
}
```

**Key fields:**
- `requestId`: Use this to poll for status
- `magicAmount`: The exact amount (in ETH) you must send
- `depositToAddress`: The Foundation contract address to send to
- `expiresAt`: Request expires after 15 minutes

**Step 2: Send the Magic Amount Deposit**

Send exactly the `magicAmount` to `depositToAddress`. The system monitors for deposits matching pending magic amounts.

```javascript
// Using ethers.js
const tx = await wallet.sendTransaction({
  to: depositToAddress,
  value: ethers.parseEther(magicAmount)
});
await tx.wait();
```

**Important:** The amount must be exact. The system uses the unique amount (generated as a cryptographically random 6-byte number) to match your deposit to your linking request.

**Step 3: Poll for Completion**

```
GET https://noema.art/api/v1/wallets/status/{requestId}
```

Poll every 2-5 seconds. Possible responses:

**Status: PENDING (HTTP 202)**
```json
{
  "status": "PENDING"
}
```
→ Deposit not yet detected. Continue polling.

**Status: COMPLETED (HTTP 200)**
```json
{
  "status": "COMPLETED",
  "apiKey": "sat_abc123def456...",
  "message": "Wallet connected successfully. This is your API key. Store it securely, it will not be shown again."
}
```
→ Success! Save the API key immediately.

**Status: ALREADY_CLAIMED (HTTP 410)**
```json
{
  "status": "ALREADY_CLAIMED",
  "message": "This API key has already been claimed."
}
```
→ Key was already retrieved. Cannot retrieve again.

**Status: EXPIRED**
```json
{
  "status": "EXPIRED"
}
```
→ Request expired (15 minutes). Start over with a new initiate request.

**⚠️ Save the API key immediately - it's only shown once!**

The raw API key is cached for 5 minutes after wallet linking completes. After retrieval or cache expiry, the key cannot be recovered.

**Step 4: Start Making Requests**

```
POST https://noema.art/api/v1/mcp
Content-Type: application/json
X-API-Key: sat_abc123def456...

{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "dall-e-3",
  "arguments": {"prompt": "a sunset over mountains"}
},"id":1}
```

**Complete Magic Amount Flow:**
```
1. POST /wallets/initiate    → Get unique magic amount + deposit address
2. Send exact magic amount   → Deposit to Foundation contract
3. System detects deposit    → Matches amount, links wallet, generates key
4. GET /wallets/status/:id   → Poll until COMPLETED, retrieve API key
5. Use X-API-Key header      → Make generation requests
```

**How It Works Under the Hood:**

1. **Initiation**: Creates a linking request with a unique 6-byte random amount (in wei)
2. **Detection**: Alchemy webhooks monitor the Foundation contract for deposits
3. **Matching**: `MagicAmountLinkingService` checks if deposit amount matches any pending request
4. **Linking**: On match, wallet is added to user with `verified: true` and `tag: magic-link-deposit`
5. **Key Generation**: API key generated (SHA-256 hashed for storage), raw key cached for claiming
6. **Delivery**: User polls status endpoint to claim the one-time API key

---

### Alternative: x402 Micropayments (No Account Needed)

Best for: Autonomous agents with crypto wallets, no account needed.

**Network:** Base mainnet (CAIP-2: `eip155:8453`) · **Asset:** USDC · **Facilitator:** Coinbase CDP

> **Critical:** NOEMA verifies payments through the **Coinbase CDP facilitator** (`api.cdp.coinbase.com`), not `x402.org/facilitator`. x402 v2 uses an **off-chain EIP-3009 signed authorization** — not a transaction hash. The CDP facilitator executes the on-chain USDC transfer after your request succeeds. Use a CDP-compatible x402 client (e.g. `@coinbase/x402`).

**How x402 Works:**
1. Make a request to `/api/v1/x402/generate` without payment
2. Receive `402 Payment Required` with `X-PAYMENT-REQUIRED` header containing payment requirements
3. Use a CDP-compatible x402 client to sign an EIP-3009 payment authorization
4. Retry the request with `X-PAYMENT` header containing the signed authorization
5. NOEMA verifies with CDP, executes generation, CDP settles USDC on-chain

**Step 1: Check available tools and pricing**
```
GET https://noema.art/api/v1/x402/tools
```
Or get a quote for a specific tool:
```
GET https://noema.art/api/v1/x402/quote?toolId=kontext
```

**Step 2: First request returns 402 with payment requirements**
```
POST https://noema.art/api/v1/x402/generate
Content-Type: application/json

{
  "toolId": "kontext",
  "inputs": {"input_image": "https://...", "input_prompt": "make it cyberpunk"}
}
```

Response (402):
```json
{
  "error": "PAYMENT_REQUIRED",
  "paymentRequired": {
    "x402Version": 2,
    "accepts": [{
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "44000",
      "payTo": "0xFoundationAddress…",
      "maxTimeoutSeconds": 300
    }]
  }
}
```

The `amount` is in USDC atomic units (6 decimals): `44000` = `$0.044`.

**Step 3: Sign and retry using `@coinbase/x402`**
```javascript
import { wrapFetch } from '@coinbase/x402/fetch';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// wrapFetch automatically handles 402 → sign EIP-3009 auth → retry
const x402Fetch = wrapFetch(fetch, walletClient);

const response = await x402Fetch('https://noema.art/api/v1/x402/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    toolId: 'kontext',
    inputs: { input_image: 'https://…', input_prompt: 'make it cyberpunk' }
  })
});

const result = await response.json();
// result.generationId → poll /api/v1/x402/status/:generationId
// result.x402.transaction → on-chain settlement tx (CDP executes this)
```

**Step 4: Poll for completion**
```
GET https://noema.art/api/v1/x402/status/{generationId}
```

**x402 Benefits:**
- No account creation needed
- No API key management
- Pay exactly what you use
- Fully autonomous agent-compatible

### Which Should I Use?

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Human user with agent assistant | API Key | Easier setup, credit balance |
| Fully autonomous agent | x402 | No account needed, agent pays directly |
| Testing/development | API Key | Predictable costs, easier debugging |
| High-volume production | API Key | Bulk credit discounts |
| One-off requests | x402 | No commitment, instant access |

### For Autonomous Agents

If you're an autonomous agent with your own wallet:

1. **Ensure you have USDC on Base mainnet** (`eip155:8453`)
2. **Use a CDP-compatible x402 client** — `@coinbase/x402` is recommended. NOEMA uses the Coinbase CDP facilitator; clients targeting `x402.org/facilitator` will fail verification.
3. **Call `/api/v1/x402/generate`** — first call returns 402 with `X-PAYMENT-REQUIRED` header
4. **Let your x402 client handle the rest** — it signs an EIP-3009 authorization and retries automatically
5. **Poll `/api/v1/x402/status/:generationId`** for completion

### Authentication Summary

| Endpoint Type | Auth Required | Method |
|---------------|---------------|--------|
| Discovery (tools/list, spells/list, etc.) | No | None |
| Execution via MCP | Yes | `X-API-Key` header |
| Execution via x402 | Yes | Payment proof |
| Account management | Yes | Session or API key |

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

1. **Use exact trigger words**: `ghibli_style` not `ghibli style` (though cognates may handle this)
2. **Don't over-trigger**: 2-3 LoRAs maximum per generation
3. **Checkpoint matching**: Only use triggers compatible with the selected tool's base model

### LoRA Weight Syntax

Control LoRA strength by appending `:weight` to the trigger word:

```
trigger_word:weight
```

**Weight scale:**
| Weight | Effect | Use Case |
|--------|--------|----------|
| `0.2-0.4` | Subtle hint | Blend styles softly |
| `0.5-0.7` | Balanced | Good default for combining |
| `0.8-1.0` | Strong | Single LoRA, full effect |
| `1.0+` | Overpowering | Rarely needed, can cause artifacts |

**Examples:**
```
ghibli_style:0.8                    # Strong Ghibli influence
ethereal_portrait:0.5               # Medium ethereal effect
ghibli_style:0.4 ethereal:0.4       # Blend two styles equally
```

### Combining Multiple LoRAs

When using 2-3 LoRAs together, **reduce weights** to avoid conflicts:

**Single LoRA:**
```
ghibli_style portrait of a warrior, soft lighting
```
→ Uses default weight (~0.8-1.0)

**Two LoRAs combined:**
```
ghibli_style:0.5 ethereal_portrait:0.4 portrait of a warrior, soft lighting
```
→ Both styles blend without overpowering

**Three LoRAs (maximum recommended):**
```
ghibli_style:0.4 ethereal:0.3 detailed_skin:0.3 portrait...
```
→ Lower weights prevent muddy results

**Golden rule for combining:** Total weights should sum to ~1.0-1.2 for best results. Going higher risks artifacts or style conflicts.

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

**Response - Full spell definition:**
```json
{
  "name": "Portrait Upscale",
  "slug": "portrait-upscale",
  "description": "Generate a portrait and upscale to 4K",
  "visibility": "public",
  "steps": [
    {
      "stepId": 1,
      "toolIdentifier": "make",
      "parameters": { "width": 1024, "height": 1024 }
    },
    {
      "stepId": 2,
      "toolIdentifier": "real-esrgan-4x",
      "parameters": { "scale": 4 }
    }
  ],
  "connections": [
    { "from": { "stepId": 1, "output": "image" }, "to": { "stepId": 2, "input": "imageUrl" } }
  ],
  "exposedInputs": ["prompt", "style"]
}
```

**Understanding spell structure:**
- `steps`: Array of tools that execute in sequence
- `steps[].toolIdentifier`: The tool used (query `tools/list` to see its schema)
- `connections`: How outputs flow between steps
- `exposedInputs`: What parameters you pass when casting

**To understand a spell's capabilities:**
1. Get spell details via `spells/get`
2. Extract `toolIdentifier` from each step
3. Query `tools/list` to understand each tool's capabilities
4. The spell's power = combined power of its tools

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
   - toolId: "make" (the default image generator)
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
| 402 Payment Required (API key flow) | Insufficient credits | Inform user to add credits |
| 402 + `PAYMENT_REQUIRED` (x402 flow) | No `X-PAYMENT` header sent | Sign authorization and retry |
| 402 + `INSUFFICIENT_PAYMENT` (x402 flow) | Payment amount too small | Use `totalCostAtomic` from the 402 response body |
| 400 + `PAYMENT_ALREADY_USED` (x402 flow) | EIP-3009 authorization already consumed | Sign a new authorization |
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
| `/api/v1/generation/execute` | REST: Execute generation (primary) |
| `/api/v1/generation/cast` | REST: Execute generation (alias) |
| `/api/v1/generation/status/{id}` | REST: Poll for results |
| `/api/v1/points` | REST: Get credit balance |
| `/api/v1/points/balance` | REST: Get credit balance (alias) |
| `/api/v1/spells/public` | REST: List available spells |
| `/api/v1/spells/cast` | REST: Execute spell |
| `/api/v1/spells/casts/{id}` | REST: Spell status |
| `/api/v1/collections` | REST: Collection management |
| `/api/v1/trainings` | REST: Training management |
| `/api/v1/x402/tools` | REST: List tools with USDC pricing (public) |
| `/api/v1/x402/quote` | REST: Get USDC price quote (public) |
| `/api/v1/x402/generate` | REST: Execute tool via x402 payment (no account) |
| `/api/v1/x402/status/{id}` | REST: Poll x402 generation status (public) |
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

| Category | List | Execute | Create | Status |
|----------|------|---------|--------|--------|
| Tools | `tools/list` | `tools/call` | - | via generationId |
| Spells | `spells/list` | `spells/cast` | `spells/create` | `spells/status` |
| Collections | `collections/list` | `collections/cook/start` | `collections/create` | `collections/get` |
| Trainings | `trainings/list` | - | `trainings/create` | `trainings/get` |

---

*This skill enables rich AI generation workflows including single generations, spell workflows, batch collections, and custom model training. Always check tool and LoRA availability via the API before making recommendations.*