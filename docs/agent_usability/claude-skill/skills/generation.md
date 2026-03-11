# NOEMA: Generation

Advanced generation patterns. Assumes you have an API key (see `Skill.md`).

**Base URL:** `https://noema.art` · **Auth:** `X-API-Key` header

---

## Tool Selection

List available tools:
```json
{"jsonrpc":"2.0","method":"tools/list","id":1}
```
Each tool has `toolId`, `displayName`, `commandName`, `metadata.baseModel`, `inputSchema`, `costingModel`.

**Aliases:** Use `commandName` (e.g. `"make"`), `displayName`, or the full `toolId` interchangeably.

| Use case | Tool |
|----------|------|
| Default image | `make` (FLUX) |
| Best prompt following | `dall-e-3` |
| Image-to-image | `sdxl-img2img` |
| Video | `ltx-video` |
| Upscale | `real-esrgan-4x` |
| Image caption | `joycaption` |

---

## Execute Generation

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "make",
  "arguments": {"prompt": "...", "width": 1024, "height": 1024}
},"id":1}
```

**Via REST:**
```
POST https://noema.art/api/v1/generation/execute
X-API-Key: {key}
Content-Type: application/json

{"toolId": "make", "inputs": {"prompt": "...", "width": 1024, "height": 1024}}
```

**Response** (both methods): parse `content[0].text` → `{ "generationId": "gen_abc123", "status": "pending" }`

---

## Polling

```
GET https://noema.art/api/v1/generation/status/{generationId}
X-API-Key: {key}
```

| Status | Meaning |
|--------|---------|
| `pending` / `processing` | Poll again in 2-5s |
| `completed` | Done — `result.image` has URL |
| `failed` | Check `error` field |

Images: 10-30s. Videos: 60-180s. Abandon after 5min.

---

## Batch Variations

Use `input_batch` to generate multiple variations in one call (5-20 pieces):
```json
{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "make",
  "arguments": {
    "input_batch": [
      {"prompt": "cyberpunk city, rainy night"},
      {"prompt": "cyberpunk city, golden hour"},
      {"prompt": "cyberpunk city, neon fog"}
    ]
  }
},"id":1}
```

For 20+ pieces with curation, use Collections (`collections.md`).

---

## Image Input (img2img)

Tools expecting `imageUrl` accept:
- Public HTTPS URL
- Base64 data URL (`data:image/png;base64,...`)
- URLs from previous NOEMA generations

```json
{"jsonrpc":"2.0","method":"tools/call","params":{
  "name": "sdxl-img2img",
  "arguments": {
    "imageUrl": "https://...",
    "prompt": "transform to watercolor style",
    "denoisingStrength": 0.6
  }
},"id":1}
```

---

## LoRA-First Pattern

When a user mentions ANY style, search LoRAs before generating. See `loras.md` for full details.

Quick search:
```json
{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"noema://lora/search?q=ghibli&checkpoint=SDXL"},"id":1}
```
Include trigger words in prompt: `"GHIBLI style, soft colors, whimsical atmosphere"`

---

## Cost

Check `tool.costingModel` for pricing. Query credit balance:
```
GET https://noema.art/api/v1/points
X-API-Key: {key}
```

---

## Error Reference

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Invalid/missing API key | Check key |
| 402 (API flow) | Insufficient credits | Add credits |
| 404 | Tool not found | Verify via `tools/list` |
| 429 | Rate limited | Wait and retry |
| 502 | Backend issue | Retry after delay |
