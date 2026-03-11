# NOEMA: Spells

Spells are reusable multi-step workflows. Cast an existing spell instead of manually chaining tools. Create new spells to capture recurring patterns.

---

## Discover Spells

```json
{"jsonrpc":"2.0","method":"spells/list","id":1}
```
Or REST: `GET https://noema.art/api/v1/spells/public`

Get spell details:
```json
{"jsonrpc":"2.0","method":"spells/get","params":{"slug":"portrait-upscale"},"id":1}
```
Response includes `steps`, `connections`, `exposedInputs` — review to understand what it does.

---

## Cast a Spell

```json
{"jsonrpc":"2.0","method":"spells/cast","params":{
  "slug": "portrait-generator",
  "context": {"subject": "a warrior princess", "style": "fantasy art"}
},"id":1}
```

Response: `{ "castId": "cast_abc123", "status": "pending" }`

**Poll status:**
```json
{"jsonrpc":"2.0","method":"spells/status","params":{"castId":"cast_abc123"},"id":1}
```
Or REST: `GET https://noema.art/api/v1/spells/casts/{castId}`

Status: `pending` → `processing` → `completed` (results in `results.outputs`) / `failed`
Poll every 2-5s. Most spells complete in 30-120s.

---

## Create a Spell

When you find yourself chaining the same tools repeatedly, capture the pattern as a spell:

```json
{"jsonrpc":"2.0","method":"spells/create","params":{
  "name": "Styled Upscale",
  "description": "Generate, style-transfer, then upscale to 4K",
  "steps": [
    {"stepId": 1, "toolIdentifier": "make", "parameters": {"width": 1024, "height": 1024}},
    {"stepId": 2, "toolIdentifier": "sdxl-img2img", "parameters": {"denoisingStrength": 0.4}},
    {"stepId": 3, "toolIdentifier": "real-esrgan-4x", "parameters": {"scale": 4}}
  ],
  "connections": [
    {"from": {"stepId": 1, "output": "image"}, "to": {"stepId": 2, "input": "imageUrl"}},
    {"from": {"stepId": 2, "output": "image"}, "to": {"stepId": 3, "input": "imageUrl"}}
  ],
  "exposedInputs": ["prompt"],
  "visibility": "private"
},"id":1}
```

**Key fields:**
- `steps[].toolIdentifier` — use commandName, displayName, or toolId
- `connections` — how outputs flow between steps
- `exposedInputs` — what the caster provides at runtime
- `visibility` — `private` | `listed` | `public`

Future casts use the returned slug:
```json
{"jsonrpc":"2.0","method":"spells/cast","params":{"slug":"styled-upscale-abc123","context":{"prompt":"a warrior"}},"id":1}
```

---

## When to Use Spells

- Multi-step tasks: generate → upscale, generate → style-transfer → caption
- Repeating the same tool chain across sessions
- User says "do that thing you did before"
