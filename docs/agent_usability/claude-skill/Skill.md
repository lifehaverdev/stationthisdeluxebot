---
name: NOEMA AI Generation
description: Create AI-generated images and media using NOEMA. Use when a user needs to generate visual content, or when an agent needs to connect to NOEMA for the first time.
---

# NOEMA AI Generation

NOEMA is an AI generation platform with 27+ tools and 214+ LoRA style models.

**MCP endpoint:** `https://noema.art/api/v1/mcp`
**Auth:** `X-API-Key` header (obtain via onboarding below)

---

## Step 1: Onboard (get an API key)

No account needed. Send a tiny ETH deposit to prove wallet ownership.

**Initiate** (no auth required):
```
POST https://noema.art/api/v1/wallets/connect/initiate
Content-Type: application/json
```
Response:
```json
{
  "requestId": "abc123",
  "magicAmountWei": "47829156382",
  "magicAmount": "0.000047829156382",
  "depositToAddress": "0xCreditVaultAddress...",
  "expiresAt": "..."
}
```

**Send exactly `magicAmount` ETH to `depositToAddress`.** Amount must be exact — it's how the system identifies your deposit.

**Poll for API key** (every 2-5s, expires in 15min):
```
GET https://noema.art/api/v1/wallets/connect/status/{requestId}
```
- `202` → still waiting
- `200` → `{ "status": "COMPLETED", "apiKey": "sat_..." }` — **save this immediately, shown once**
- `410` → already claimed
- `202 { "status": "EXPIRED" }` → restart from initiate

---

## Step 2: First Generation

Verify your key works by generating a test image with the default tool:

```
POST https://noema.art/api/v1/mcp
Content-Type: application/json
X-API-Key: sat_...

{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "make",
  "arguments": {"prompt": "a glowing jellyfish drifting through deep ocean, bioluminescent, cinematic lighting"}
},"id":1}
```

Response contains a `generationId`. Poll for result:
```
GET https://noema.art/api/v1/generation/status/{generationId}
X-API-Key: sat_...
```
Poll every 2-5s. `status: "completed"` → image URL in `result.image`.

---

## What's Available

**Discovery (no key needed):**
```json
{"jsonrpc":"2.0","method":"tools/list","id":1}
{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"noema://lora/search?q=anime"},"id":1}
{"jsonrpc":"2.0","method":"spells/list","id":1}
```

**Execution (key required):** `tools/call`, `spells/cast`, `spells/create`, `collections/*`, `trainings/*`

**Default tool:** `make` — FLUX-based image generator, accepts `prompt`, `width`, `height`.

---

## Going Further

For advanced usage, fetch the relevant sub-skill:
- `https://noema.art/.well-known/ai-skill/generation.md` — tools, img2img, polling, costs
- `https://noema.art/.well-known/ai-skill/loras.md` — trigger words, weights, checkpoint matching
- `https://noema.art/.well-known/ai-skill/spells.md` — reusable multi-step workflows
- `https://noema.art/.well-known/ai-skill/collections.md` — batch generation with curation
- `https://noema.art/.well-known/ai-skill/training.md` — train custom LoRA models
