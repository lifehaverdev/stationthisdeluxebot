# NOEMA: Generation

Advanced generation. Assumes API key — see `onboarding.md`. MCP shorthand defined in `Skill.md`.

---

## Tool Selection

`tools/list` — each tool has `toolId`, `commandName`, `metadata.baseModel`, `inputSchema`, `costingModel`.

| Use case | Tool |
|----------|------|
| Default image | `make` (FLUX) |
| Best prompt following | `dall-e-3` |
| Image-to-image | `sdxl-img2img` |
| Video | `ltx-video` |
| Upscale | `real-esrgan-4x` |
| Caption | `joycaption` |

---

## Execute

Before calling an unfamiliar tool, call `tools/list` and inspect its `inputSchema` to know exactly what parameters it accepts.

```
call make {"prompt": "...", "width": 1024, "height": 1024}
```
REST: `POST /api/v1/generation/execute` `{"toolId":"make","inputs":{...}}`

Response: `{"generationId":"gen_abc123","pollUrl":"..."}`. If you passed `callbackUrl`, the result is pushed to you — no polling needed. Otherwise poll per `Skill.md` (image: wait 15s, up to 6min; video: wait 90s first).
`completed` → `result.image`.

---

## Batch Variations

5-20 pieces in one call:
```
call make {"input_batch": [{"prompt": "cyberpunk city, rain"}, {"prompt": "cyberpunk city, gold"}, {"prompt": "cyberpunk city, fog"}]}
```
For 20+ with curation → `collections.md`.

---

## Image Input (img2img)

Accepts public HTTPS URL, base64 `data:image/png;base64,...`, or prior NOEMA generation URL.
```
call sdxl-img2img {"imageUrl": "https://...", "prompt": "watercolor style", "denoisingStrength": 0.6}
```

---

## LoRA-First Pattern

When user mentions any style, search LoRAs before generating — see `loras.md`.
```
read noema://lora/search?q=ghibli&checkpoint=SDXL
```
Include trigger words in prompt. Match LoRA checkpoint to tool base model.

---

## Cost & Balance

Check `tool.costingModel`. Balance: `GET /api/v1/points`

---

## Errors

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Bad/missing key | Check key |
| 402 | No credits | Add credits via `onboarding.md` |
| 404 | Tool not found | Check via `tools/list` |
| 429 | Rate limited | Retry with backoff |
| 502 | Backend issue | Retry after delay |
