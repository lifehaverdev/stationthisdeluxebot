# NOEMA: LoRAs & Trigger Words

LoRAs are trained style/character models activated by trigger words in prompts. NOEMA has 214+.

---

## Search LoRAs

**Via MCP:**
```json
{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"noema://lora/search?q=anime&checkpoint=SDXL"},"id":1}
```

**Via REST:**
```
GET https://noema.art/api/v1/loras/list?q={query}&checkpoint={FLUX|SDXL|SD1.5|All}
```

`q` searches name, slug, triggerWords, description, tags. Search by style concept (`q=dreamy`), subject (`q=portrait`), aesthetic (`q=cyberpunk`), etc.

Response fields per LoRA: `name`, `triggerWords`, `description`, `checkpoint`, `defaultWeight`, `tags`, `previewImages`

---

## Using Trigger Words

Include trigger words directly in your prompt:
```
"ghibli_style portrait of a warrior, soft lighting, whimsical atmosphere"
```

The system auto-detects triggers — no special syntax needed at default weight.

**Rule:** Only use LoRAs whose `checkpoint` matches the tool's base model. SDXL LoRA → SDXL tool.

---

## Controlling Weight

Append `:weight` to a trigger to control strength:
```
trigger_word:weight
```

| Weight | Effect |
|--------|--------|
| `0.2–0.4` | Subtle blend |
| `0.5–0.7` | Balanced (good default when combining) |
| `0.8–1.0` | Strong, single LoRA |
| `1.0+` | Overpowering — risks artifacts |

---

## Combining Multiple LoRAs

Max 2-3 LoRAs. Reduce weights when combining — total should sum to ~1.0–1.2:

```
ghibli_style:0.4 ethereal_portrait:0.4 portrait of a warrior, soft lighting
```

Single LoRA at full strength:
```
ghibli_style portrait of a warrior, soft lighting
```

---

## No LoRA Found?

1. Try related terms (`q=painterly`, `q=epic`, `q=magical`)
2. Still nothing → fall back to prompt-only with DALL-E 3 (best prompt interpretation)
3. For recurring needs → train a custom LoRA (`training.md`)

---

## Checkpoint → Tool Matching

| Checkpoint | Compatible Tools |
|------------|-----------------|
| `FLUX` | `make`, `fluxdev`, flux-based tools |
| `SDXL` | `sdxl-base`, `sdxl-img2img`, SDXL tools |
| `SD1.5` | SD 1.5 tools |

Always check `metadata.baseModel` from `tools/list` to confirm compatibility.
