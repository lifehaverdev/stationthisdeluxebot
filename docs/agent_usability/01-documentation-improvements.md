# Documentation Improvements for Agent Usability

**Status:** TODO
**Priority:** High - Prerequisite for effective skill usage
**Created:** 2026-02-02

---

## Overview

For AI agents to effectively use NOEMA, our tool and LoRA documentation must be **agent-readable** - structured, complete, and semantically meaningful. Current documentation is human-oriented and often sparse.

This document outlines required improvements to make our data agent-navigable.

---

## Tool Documentation Improvements

### Current State

Tool definitions in `src/core/tools/definitions/` have:
- Basic `description` field (often one line)
- `inputSchema` with parameter descriptions
- Sparse `outputSchema`

### Required Improvements

#### 1. Enhanced Descriptions

**Current:**
```javascript
description: 'Generate images from text prompts using OpenAI\'s DALL·E 3 model.'
```

**Improved:**
```javascript
description: `Generate images from text prompts using OpenAI's DALL·E 3 model.

Best for: High-fidelity images, complex prompt following, photorealistic outputs.
Limitations: No LoRA support, limited size options, content policy restrictions.
Typical use cases: Product mockups, concept art, photorealistic scenes.
Compared to alternatives: Better prompt adherence than SDXL, less stylistic flexibility.`
```

#### 2. Semantic Tags

Add machine-readable capability tags:

```javascript
capabilities: [
  'text-to-image',
  'photorealistic',
  'high-fidelity',
  'prompt-accurate'
],
limitations: [
  'no-lora-support',
  'content-policy-restricted',
  'fixed-sizes'
]
```

#### 3. Use Case Examples

Add concrete examples agents can pattern-match:

```javascript
examplePrompts: [
  {
    intent: 'product photography',
    prompt: 'Professional product photo of a sleek wireless headphone on white background, studio lighting',
    notes: 'DALL-E excels at commercial/product imagery'
  },
  {
    intent: 'concept art',
    prompt: 'Fantasy castle on floating island, dramatic clouds, golden hour lighting',
    notes: 'Good for detailed architectural concepts'
  }
]
```

#### 4. Comparison Guidance

Help agents choose between similar tools:

```javascript
alternatives: {
  'flux-dev': 'Use when LoRA styles are needed or content policy is restrictive',
  'sdxl-base': 'Use for faster generation or specific SDXL LoRAs'
},
preferWhen: [
  'User needs accurate prompt following',
  'Photorealistic output required',
  'No style customization needed'
],
avoidWhen: [
  'User wants anime/illustrated styles',
  'Custom LoRA models required',
  'Specific aspect ratios beyond 1:1, 16:9, 9:16'
]
```

#### 5. Output Specifications

Expand outputSchema:

```javascript
outputSchema: {
  image: {
    type: 'url',
    format: 'png',
    maxDimensions: '1792x1024',
    expiresIn: '1 hour',
    description: 'Direct URL to generated image. Download promptly as URLs expire.'
  }
}
```

---

## LoRA Documentation Improvements

### Current State

LoRA records have:
- `name`, `triggerWords`, `description`
- `checkpoint`, `defaultWeight`
- `tags` (often sparse)

### Required Improvements

#### 1. Structured Descriptions

**Current:**
```javascript
description: 'Ghibli style'
```

**Improved:**
```javascript
description: `Applies Studio Ghibli anime aesthetic to generations.

Visual characteristics:
- Soft, hand-painted look with visible brushwork
- Warm, nostalgic color palette
- Whimsical, dreamlike atmosphere
- Detailed natural environments

Works best with: Landscapes, character portraits, fantasy scenes
Avoid with: Photorealistic subjects, modern/tech imagery
Recommended weight: 0.6-0.9 (higher = more stylized)`
```

#### 2. Style Tags (Machine-Readable)

```javascript
styleTags: {
  aesthetic: ['anime', 'hand-painted', 'whimsical'],
  mood: ['nostalgic', 'warm', 'dreamlike'],
  subjects: ['landscapes', 'characters', 'nature', 'fantasy'],
  avoidSubjects: ['photorealistic', 'tech', 'modern']
}
```

#### 3. Compatibility Notes

```javascript
compatibility: {
  worksWellWith: ['anime_eyes_v2', 'soft_lighting'],
  conflictsWith: ['photorealistic_v3', 'harsh_shadows'],
  notes: 'Combine with character LoRAs at reduced weight (0.4-0.5)'
}
```

#### 4. Example Outputs

```javascript
exampleGenerations: [
  {
    prompt: 'GHIBLI forest landscape with small cottage',
    imageUrl: 'https://...',
    weight: 0.8,
    tool: 'sdxl-base'
  }
]
```

#### 5. Semantic Search Fields

Add fields optimized for agent search:

```javascript
searchableTerms: [
  'studio ghibli', 'miyazaki', 'totoro style', 'spirited away',
  'anime landscape', 'japanese animation', 'hand drawn anime'
],
notRelatedTo: [
  'photorealistic', '3d render', 'pixel art'
]
```

---

## Implementation Plan

### Phase 1: Schema Updates

1. **Update ToolDefinition.js** - Add new optional fields
2. **Update LoRA schema** - Add new documentation fields
3. **Maintain backwards compatibility** - All new fields optional

### Phase 2: Content Migration

1. **Audit existing tools** - List all tools needing updates
2. **Audit existing LoRAs** - Identify sparse documentation
3. **Prioritize by usage** - Start with most-used tools/LoRAs
4. **Batch updates** - Update 5-10 per session

### Phase 3: Validation

1. **Test with skill** - Verify Claude can navigate improved docs
2. **Iterate on format** - Adjust based on agent performance
3. **Add linting** - Enforce documentation completeness

---

## Affected Files

### Tool Definitions
```
src/core/tools/definitions/
├── chatgpt.js
├── dalleImage.js
├── joycaption.js
├── ltxVideo.js
├── qwenLayered.js
├── staticImageTool.js
└── stringPrimitiveTool.js
```

### LoRA Schema
```
src/core/services/db/loRAModelDb.js
```

### API Responses
```
src/api/external/toolsApi.js
src/api/internal/loras/lorasApi.js
```

---

## Success Criteria

- [ ] All public tools have multi-paragraph descriptions
- [ ] All tools have `capabilities` and `limitations` arrays
- [ ] All tools have `examplePrompts` with 2+ examples
- [ ] Top 50 LoRAs have structured descriptions
- [ ] All LoRAs have `styleTags` populated
- [ ] Claude skill can accurately recommend tools based on intent
- [ ] Claude skill can find relevant LoRAs for style requests

---

## Notes

This documentation work benefits ALL agent integrations:
- Claude Skill (Phase 1)
- x402 payment descriptions (Phase 2)
- ERC-8004 capability advertising (Phase 3)

Investing here pays dividends across all three pathways.
