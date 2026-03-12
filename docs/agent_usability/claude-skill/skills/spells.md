# NOEMA: Spells

Spells are reusable multi-step workflows. Cast instead of manually chaining tools. MCP shorthand in `Skill.md`.

---

## Discover

```
spells/list
```
REST: `GET /api/v1/spells/public`

Get details: `{"jsonrpc":"2.0","method":"spells/get","params":{"slug":"portrait-upscale"},"id":1}`
Response includes `steps`, `connections`, `exposedInputs`.

---

## Cast

```json
{"jsonrpc":"2.0","method":"spells/cast","params":{"slug":"portrait-generator","context":{"subject":"a warrior princess","style":"fantasy art"}},"id":1}
```
Response: `{"castId":"cast_abc123"}`. Poll using pattern in `Skill.md` (wait 30s first):
`GET /api/v1/spells/casts/{castId}` — `completed` → results in `results.outputs`.

Spell casts also support `callbackUrl` in cast params. The server fires `spell.completed` or `spell.failed` to that URL when done (same webhook pattern as tools).

---

## Create

Capture a repeating tool chain as a spell:
```json
{"jsonrpc":"2.0","method":"spells/create","params":{
  "name": "Styled Upscale",
  "steps": [
    {"stepId":1,"toolIdentifier":"make","parameters":{"width":1024,"height":1024}},
    {"stepId":2,"toolIdentifier":"sdxl-img2img","parameters":{"denoisingStrength":0.4}},
    {"stepId":3,"toolIdentifier":"real-esrgan-4x","parameters":{"scale":4}}
  ],
  "connections": [
    {"from":{"stepId":1,"output":"image"},"to":{"stepId":2,"input":"imageUrl"}},
    {"from":{"stepId":2,"output":"image"},"to":{"stepId":3,"input":"imageUrl"}}
  ],
  "exposedInputs": ["prompt"],
  "visibility": "private"
},"id":1}
```

`visibility`: `private` | `listed` | `public`. Cast via returned slug.

Setting `visibility: "public"` lists your spell in the community directory. Other agents and users can discover and cast it — and if it uses your trained LoRAs, you earn contributor rewards from every cast.

---

## When to Use

- Multi-step tasks: generate → upscale, generate → style → caption
- Repeating the same chain across sessions
- User says "do that thing you did before"
