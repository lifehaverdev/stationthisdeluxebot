# NOEMA Trigger Word System

This document explains how trigger words work in NOEMA and how to recommend them effectively.

## What Are Trigger Words?

Trigger words are special phrases that activate **LoRA models** when included in generation prompts. LoRAs (Low-Rank Adaptations) are fine-tuned models that add specific styles, characters, or concepts to generations.

When a user's prompt contains a trigger word, NOEMA automatically:
1. Detects the trigger
2. Looks up the associated LoRA
3. Applies the LoRA with appropriate weight
4. Generates with that style/concept active

## How Triggers Are Structured

### Primary Triggers
Each LoRA has one or more **triggerWords** - the canonical activation phrases.

```json
{
  "name": "Ghibli Style",
  "triggerWords": ["GHIBLI"],
  "defaultWeight": 0.8
}
```

### Cognates (Aliases)
LoRAs can have **cognates** - alternative phrases that map to primary triggers.

```json
{
  "name": "Ghibli Style",
  "triggerWords": ["GHIBLI"],
  "cognates": [
    { "word": "studio ghibli", "replaceWith": "GHIBLI" },
    { "word": "ghibli style", "replaceWith": "GHIBLI" }
  ]
}
```

When a user writes "studio ghibli", it automatically maps to "GHIBLI".

### Multiple Triggers
Some LoRAs have multiple valid triggers:

```json
{
  "name": "JoyCat",
  "triggerWords": ["joycat", "anime joycat", "3d joycat", "painting of a joycat"]
}
```

Different triggers may produce slightly different results within the same LoRA.

## Checkpoint Compatibility

**Critical**: LoRAs only work with their trained checkpoint (base model).

| Checkpoint | Description |
|------------|-------------|
| `FLUX` | Flux model family |
| `SDXL` | Stable Diffusion XL |
| `SD1.5` | Stable Diffusion 1.5 |
| `SD3` | Stable Diffusion 3 |

**Before recommending a trigger word:**
1. Check which tool the user will use
2. Look up that tool's `metadata.baseModel`
3. Only recommend LoRAs matching that checkpoint

Example:
- User wants to use DALL-E → DALL-E doesn't use LoRAs (OpenAI model)
- User wants to use a FLUX tool → Only recommend `checkpoint: "FLUX"` LoRAs

## Weight Control

Trigger words can include weight modifiers:

| Syntax | Effect |
|--------|--------|
| `GHIBLI` | Uses LoRA's `defaultWeight` (e.g., 0.8) |
| `GHIBLI:0.5` | Half strength - subtle effect |
| `GHIBLI:1.2` | Stronger than default |
| `GHIBLI:0.0` | Suppresses the LoRA (won't apply) |

**Weight guidelines:**
- `0.3-0.5`: Subtle influence
- `0.6-0.8`: Balanced (typical default)
- `0.9-1.2`: Strong influence
- `1.3+`: Very strong (may cause artifacts)

## Querying Available Triggers

### Search for LoRAs

```http
GET https://noema.art/api/v1/loras/list?checkpoint=SDXL&q=anime
```

This returns LoRAs matching "anime" that are compatible with SDXL.

### What the Search Queries

The `q` parameter searches across **five fields** (case-insensitive regex):

| Field | Example Match |
|-------|---------------|
| `name` | "Anime Style XL" matches `q=anime` |
| `slug` | "anime_style_xl" matches `q=anime` |
| `triggerWords` | ["anime_xl"] matches `q=anime` |
| `description` | "Airbrushed dreamlike portrait..." matches `q=dreamlike` |
| `tags.tag` | ["style", "portrait"] matches `q=portrait` |

**This means you can search by semantic concepts, not just trigger names.**

Examples:
- `q=dreamy` → finds LoRAs with "dreamy" in description
- `q=portrait` → finds LoRAs tagged or described as portrait-focused
- `q=meme` → finds meme character LoRAs
- `q=retro` → finds vintage/retro aesthetic LoRAs

### Search Strategy for Agents

1. **Start broad**: Search the user's intent (`q=watercolor`)
2. **Filter by checkpoint**: Add `&checkpoint=FLUX` to match the tool
3. **Sort by popularity**: Add `&filterType=popular` to get well-tested options
4. **Read descriptions**: Use the `description` field to understand what each LoRA does and when to recommend it

### Response Example

```json
{
  "loras": [
    {
      "name": "Anime Style XL",
      "slug": "anime_style_xl",
      "triggerWords": ["anime_xl", "animestyle"],
      "cognates": [
        { "word": "anime", "replaceWith": "anime_xl" }
      ],
      "checkpoint": "SDXL",
      "defaultWeight": 0.7,
      "description": "Clean anime/manga style for SDXL. Creates crisp linework with vibrant colors. Best for character illustrations and portraits. Works well with detailed prompts. May struggle with realistic subjects.",
      "tags": ["style", "anime"],
      "uses": 2340
    }
  ]
}
```

## Recommendation Strategy

### Step 1: Parse User Intent
What style/concept is the user describing?

| User Says | Likely Looking For |
|-----------|-------------------|
| "anime style" | Anime LoRAs |
| "like Ghibli" | Ghibli-specific LoRAs |
| "photorealistic" | Photo/realism LoRAs |
| "my character X" | User's custom trained LoRAs |
| "oil painting" | Painterly style LoRAs |

### Step 2: Match Checkpoint
Determine which generation tool they'll use, then filter LoRAs by checkpoint.

### Step 3: Search and Rank
Query LoRAs with relevant search terms. Consider:
- **Popularity** (`usageCount`) - well-tested LoRAs with proven results
- **Tags** - category matching (style, character, meme, portrait, etc.)
- **Description** - read carefully to understand:
  - What visual effect it produces
  - What subjects it works best with
  - What it does NOT work well with
  - Why users choose this over alternatives

### Step 4: Recommend Triggers
Present options to the user with:
- Trigger word to use
- What effect it produces
- Recommended weight

### Step 5: Incorporate in Prompt
Place trigger words naturally in the prompt:

**Good:**
```
"anime_xl portrait of a warrior, detailed armor, dramatic lighting"
```

**Also Good (trigger integrated):**
```
"portrait of a warrior in anime_xl style, detailed armor"
```

**Avoid:**
```
"anime_xl anime_xl anime_xl portrait" (don't repeat)
```

## Combining Multiple LoRAs

Users can combine 2-3 LoRAs for unique effects:

```
"GHIBLI portrait of joycat in a forest, soft lighting"
```

This activates both `ghibli_style` and `joycatv2` LoRAs.

**Guidelines:**
- Maximum 3 LoRAs per generation (more causes conflicts)
- Reduce weights when combining (`GHIBLI:0.5 joycat:0.5`)
- Some combinations don't work well (conflicting styles)

## Internal Processing

When NOEMA receives a prompt, the resolution service:

1. **Tokenizes** the prompt
2. **Looks up** each token against the trigger map
3. **Resolves conflicts** (if multiple LoRAs share a trigger):
   - User's private LoRAs take priority
   - Then shared private LoRAs
   - Then public LoRAs (sorted by recency)
4. **Generates** `<lora:slug:weight>` tags internally
5. **Sends** to ComfyUI for generation

**Example transformation:**
```
Input:  "A ghibli character with joycat companion"
Output: "A <lora:ghibli_style:0.8> ghibli character with
         <lora:joycatv2:1.0> joycat companion"
```

The user never sees the `<lora:>` tags - they're handled internally.

## Common Trigger Categories

### Style Triggers
- Anime/manga styles
- Photorealistic enhancements
- Painterly effects (oil, watercolor)
- Vintage/retro aesthetics
- Game art styles (pixel, 3D render)

### Character Triggers
- User-trained characters
- Popular character LoRAs
- Species/creature types

### Concept Triggers
- Lighting effects
- Composition styles
- Scene types (cyberpunk, fantasy)
- Texture/material effects

### Technical Triggers
- Quality enhancers
- Detail boosters
- Specific artist styles

## Edge Cases

### Unknown Triggers
If a word isn't in the trigger map, it's passed through as regular prompt text. No harm done.

### Case Sensitivity
Triggers are **case-insensitive**. `GHIBLI`, `ghibli`, and `Ghibli` all work.

### Partial Matches
The system uses exact token matching. "ghibli" triggers the LoRA, but "ghiblistyle" (no space) might not.

### Private LoRAs
Users may have private LoRAs only they can access. These won't appear in public searches but will activate for that user.

## Best Practices for Claude

1. **Always check checkpoint compatibility** before recommending triggers
2. **Search by semantic concepts**, not just trigger names - use `q=dreamy` not just `q=petravoice`
3. **Read the description field** before recommending - it tells you what the LoRA does, what it's best for, and what to avoid
4. **Explain what triggers do** - users may not know the LoRA names
5. **Suggest weights** for fine-tuning the effect
6. **Warn about combinations** that might conflict
7. **Respect tool limitations** - DALL-E and some tools don't use LoRAs
8. **Use filterType=popular** when unsure - high-usage LoRAs have proven results
