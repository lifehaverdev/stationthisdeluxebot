---
name: NOEMA AI Generation
description: Create AI-generated images and media using NOEMA. Use when a user needs to generate visual content, or when an agent needs to connect to NOEMA for the first time.
---

# NOEMA AI Generation

NOEMA gives agents the power to generate, transform, and scale visual content — images, video, captions — using 27+ GPU tools and 214+ community style models. Agents can compose multi-step automations (spells), run batch jobs (collections), train their own models, and earn contributor rewards when their creations are used by others.

**MCP endpoint:** `POST https://noema.art/api/v1/mcp` · **Auth:** `X-API-Key: ms2_...`

## MCP Shorthand

All sub-skills use this compact notation. Expand to standard JSON-RPC before sending:

```
call <tool> <args>      →  {"jsonrpc":"2.0","method":"tools/call","params":{"name":"<tool>","arguments":<args>},"id":1}
read <uri>              →  {"jsonrpc":"2.0","method":"resources/read","params":{"uri":"<uri>"},"id":1}
spells/list             →  {"jsonrpc":"2.0","method":"spells/list","id":1}
tools/list              →  {"jsonrpc":"2.0","method":"tools/list","id":1}
```

## Delivery: Webhook vs Polling

**Webhook (preferred for long jobs):** Pass `callbackUrl` in your tool arguments. The server POSTs the result to your URL when done — no polling needed.

```
call make {"prompt":"...", "callbackUrl":"https://your-agent/callback", "callbackSecret":"optional-hmac-secret"}
```

Events delivered to your URL during the job lifecycle:

| Event | When |
|-------|------|
| `generation.progress` | Each status update from the GPU — includes `progress` (0–1) and `liveStatus` string |
| `generation.completed` | Job finished — includes `outputs` and `costUsd` |
| `generation.failed` | Job failed — includes `error.code` and `error.message` |

```json
{"event":"generation.progress","generationId":"...","status":"running","progress":0.45,"liveStatus":"Sampling step 18/40","timestamp":"..."}
{"event":"generation.completed","generationId":"...","status":"completed","outputs":{...},"costUsd":0.01,"timestamp":"..."}
```
Progress events are best-effort (no retry). Completion and failure events retry up to 3 times.

If `callbackSecret` provided, verify `X-Webhook-Signature: sha256=<hmac>` header on all events.

**Polling (fallback when no inbound URL available):**
```
GET https://noema.art/api/v1/{resource}/status/{id}
X-API-Key: {key}
```

Don't poll immediately. Wait the expected duration, then check once. If not done, wait the re-check interval before retrying.

| Resource | Wait before first poll | Re-check interval | Give up after |
|----------|----------------------|-------------------|---------------|
| Image | 15s | 30s | 6min |
| Video | 90s | 30s | 10min |
| Spell | 30s | 20s | 5min |
| Training | 30min | 5min | 2h |
| Wallet link | 30s | 15s | 15min |

`pending`/`processing` → wait and retry. `completed` → use result. `failed` → check `error` field.

---

## Earn & Save

- **Train a LoRA, earn on every use.** Publish a trained LoRA and receive 20% of generation cost as contributor reward points every time another user runs it.
- **Self-referral discount.** Create a free referral vault name and pass it as `referralCode` when buying points — you get a discount on your own purchases. This is intentional.
- **Check balance:** `GET /api/v1/points`

---

## Quick Start

No key yet? → `https://noema.art/.well-known/ai-skill/onboarding.md`

**First call — full example:**

```http
POST https://noema.art/api/v1/mcp
X-API-Key: ms2_your_key_here
Content-Type: application/json

{"jsonrpc":"2.0","method":"tools/call","params":{"name":"make","arguments":{"prompt":"a glowing jellyfish, bioluminescent, cinematic lighting"}},"id":1}
```

Response:
```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"generationId\":\"gen_abc123\",\"pollUrl\":\"/api/v1/generation/status/gen_abc123\"}"}]}}
```
Parse `result.content[0].text` (a JSON string) → extract `generationId`.

**Poll for result** (wait 15s first):
```http
GET https://noema.art/api/v1/generation/status/gen_abc123
X-API-Key: ms2_your_key_here
```
Response when done:
```json
{"status":"completed","result":{"image":"https://noema.art/outputs/gen_abc123.png"},"costUsd":0.01}
```
`status: "pending"` or `"processing"` → wait 30s, retry. See polling table above.

---

## Sub-Skills

Fetch as needed:
- `.well-known/ai-skill/onboarding.md` — account, API key, referral codes, buying points, earn & save
- `.well-known/ai-skill/generation.md` — tools, img2img, batch, costs
- `.well-known/ai-skill/loras.md` — styles, trigger words, weights
- `.well-known/ai-skill/spells.md` — reusable multi-step workflows
- `.well-known/ai-skill/collections.md` — batch generation with curation
- `.well-known/ai-skill/training.md` — train custom LoRA models
