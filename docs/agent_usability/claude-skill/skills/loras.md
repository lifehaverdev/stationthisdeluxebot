# NOEMA: LoRAs & Trigger Words

LoRAs are style/character models activated by trigger words. 214+ available. MCP shorthand in `Skill.md`.

---

## Search

```
read noema://lora/search?q=anime&checkpoint=SDXL
```
REST: `GET /api/v1/loras/list?q={query}&checkpoint={FLUX|SDXL|SD1.5|All}`

`q` searches name, triggerWords, description, tags. Response: `name`, `triggerWords`, `checkpoint`, `defaultWeight`, `previewImages`.

---

## Using Trigger Words

Include trigger words directly in the prompt — system auto-detects at default weight:
```
"ghibli_style portrait of a warrior, soft lighting, whimsical atmosphere"
```

**Rule:** LoRA `checkpoint` must match the tool's `metadata.baseModel`. SDXL LoRA → SDXL tool.

---

## Weight Syntax

Append `!!` or `..` pairs to a trigger word to nudge strength:

| Suffix | Effect |
|--------|--------|
| (none) | Default weight |
| `!!` | +0.4 |
| `!!!!` | +0.8 |
| `..` | −0.4 |
| `....` | −0.8 |

```
ghibli_style!!            → stronger (+0.4)
ghibli_style..            → weaker (−0.4)
ghibli_style!!!!          → dominant (+0.8)
ghibli_style....          → suppressed (−0.8)
```

Old explicit syntax also works: `trigger_word:0.7`

---

## Combining Multiple LoRAs

Max 2-3 LoRAs. Combined strength should total ~1.0-1.2.
```
ghibli_style!! ethereal_portrait.... portrait of a warrior, soft lighting
```

---

## No LoRA Found?

1. Try related terms (`q=painterly`, `q=epic`, `q=magical`)
2. Still nothing → prompt-only with `dall-e-3` (best prompt interpretation)
3. For recurring needs → train a custom LoRA (`training.md`)

---

## Checkpoint → Tool

| Checkpoint | Compatible Tools |
|------------|-----------------|
| `FLUX` | `make`, `fluxdev`, flux-based tools |
| `SDXL` | `sdxl-base`, `sdxl-img2img`, SDXL tools |
| `SD1.5` | SD 1.5 tools |

Confirm via `metadata.baseModel` from `tools/list`.
