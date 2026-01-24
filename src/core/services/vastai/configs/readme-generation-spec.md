# README Generation Spec

How the upload script should populate `huggingface-readme-template.md`.

## Optimized Flow: Pre-generate README Before Training

Since we have all the information needed (captions, trigger word, model name) before training starts, we can:

1. **Before training**: Generate README using local OpenAI service, create HuggingFace repo
2. **During training**: Generate sample images using dataset captions
3. **After training**: Upload just safetensors + samples to existing repo

This approach:
- Reserves the HuggingFace repo name immediately
- No API calls needed from remote instance
- README is ready before training starts
- Faster post-training upload (just artifacts)

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE TRAINING (local)                                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Read        │───►│ OpenAI:     │───►│ Create HF   │     │
│  │ Captions    │    │ Description │    │ Repo+README │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  DURING TRAINING (VastAI)                                   │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │ Train LoRA  │───►│ Generate    │  (using captions       │
│  │ (N steps)   │    │ Samples     │   as prompts)          │
│  └─────────────┘    └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  AFTER TRAINING (local)                                     │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │ Download    │───►│ Upload to   │  (safetensors +        │
│  │ Artifacts   │    │ Existing HF │   samples only)        │
│  └─────────────┘    └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Static Values

```javascript
const DEFAULTS = {
  LICENSE: 'wtfpl',
  BASE_MODEL: 'black-forest-labs/FLUX.1-dev',
  LORA_STRENGTH: '0.8-1.0',
  GUIDANCE_SCALE: '3.5-4.0',
  INFERENCE_STEPS: '20-30',
};
```

## Dynamic Values from Job Context

| Placeholder | Source |
|-------------|--------|
| `{{MODEL_NAME}}` | `jobContext.modelName` |
| `{{TRIGGER_WORD}}` | `jobContext.triggerWord` |
| `{{HF_REPO_ID}}` | `ms2stationthis/${modelName}` |
| `{{TRAINING_STEPS}}` | `jobContext.steps` |

## Generated Content

### 1. `{{GENERATED_DESCRIPTION}}`

**Source:** Send 2-3 dataset captions to GPT/Claude API

**Prompt template:**
```
You are writing a HuggingFace model card description. Based on these training captions, write a 2-3 sentence description of what this LoRA does. Be specific about the visual style or subject matter. Keep it concise and professional.

Captions:
- {caption1}
- {caption2}
- {caption3}

Model name: {modelName}
Trigger word: {triggerWord}
```

**Example output:**
> This LoRA fine-tunes FLUX.1-dev to generate images of Pepe the Frog in various styles and scenarios. Trained on high-quality digital art featuring the iconic green frog character with expressive faces and detailed compositions. Best results when combining the trigger word with scene descriptions.

### 2. `{{SAMPLE_IMAGES_GRID}}`

**Source:** Sample images generated at end of training using dataset captions as prompts

**Format:**
```markdown
| | |
|:---:|:---:|
| ![Sample 1](samples/sample_001.png) | ![Sample 2](samples/sample_002.png) |
| *{caption1_short}* | *{caption2_short}* |
| ![Sample 3](samples/sample_003.png) | ![Sample 4](samples/sample_004.png) |
| *{caption3_short}* | *{caption4_short}* |
```

**Caption shortening:** Truncate to first 80 chars + "..."

**Sample selection:** Pick 4 diverse captions from dataset for final sampling

### 3. `{{EXAMPLE_PROMPTS}}`

**Source:** 3-4 short, practical prompts derived from training captions

**Format:**
```markdown
- `{triggerWord} in a forest, golden hour lighting`
- `{triggerWord} wearing a suit, professional photo`
- `{triggerWord} as a wizard, fantasy art style`
```

**Generation approach:**
1. Extract key subjects/styles from captions
2. Simplify to 8-15 words each
3. Always prepend trigger word

### 4. `{{EXAMPLE_PROMPT_SHORT}}`

**For the code snippet** - just one simple example:
```
in a garden, soft lighting, detailed
```

## Sample Image Generation Strategy

### At Training End (in TrainingRunner)

Instead of random baseline prompts, use actual dataset captions:

```javascript
// Select 4 diverse captions for final samples
function selectSampleCaptions(datasetManifest, triggerWord) {
  const captions = datasetManifest.images
    .map(img => img.caption)
    .filter(Boolean);

  // Pick evenly spaced captions for diversity
  const step = Math.floor(captions.length / 4);
  const selected = [
    captions[0],
    captions[step],
    captions[step * 2],
    captions[step * 3] || captions[captions.length - 1]
  ];

  // Ensure trigger word is present
  return selected.map(c =>
    c.toLowerCase().includes(triggerWord.toLowerCase())
      ? c
      : `${triggerWord} ${c}`
  );
}
```

### Config Modification

In `flux-lora-24gb-aitoolkit.yaml`, the `sample.prompts` should be dynamically populated:

```yaml
sample:
  sampler: "flowmatch"
  sample_every: {{TRAINING_STEPS}}  # Only at end
  width: 1024
  height: 1024
  prompts: {{SAMPLE_PROMPTS_ARRAY}}  # From dataset captions
  seed: 42
  walk_seed: true
  guidance_scale: 4
  sample_steps: 20
```

## File Structure for Upload

```
upload_package/
├── {modelName}.safetensors    # The trained model
├── README.md                   # Generated from template
└── samples/
    ├── sample_001.png         # Generated at training end
    ├── sample_002.png
    ├── sample_003.png
    └── sample_004.png
```

## Upload Flow (Optimized: Pre-generate Before Training)

### Phase 1: Before Training (local)

```javascript
// In launch-training.js or training worker

const ModelCardGenerator = require('./src/core/services/training/ModelCardGenerator');
const OpenAIService = require('./src/core/services/openai/openaiService');

// 1. Read captions from dataset manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const captions = ModelCardGenerator.extractCaptionsFromManifest(manifest);

// 2. Generate model card
const generator = new ModelCardGenerator({
  openaiService: new OpenAIService({ logger }),
  logger,
});

const { readme, samplePrompts } = await generator.generate({
  modelName: 'pepeflux',
  triggerWord: 'pepe',
  trainingSteps: 2000,
  captions,
});

// 3. Create HuggingFace repo + upload README
await hf.createRepo({ name: modelName, type: 'model' });
await hf.uploadFile({ path: 'README.md', content: readme });

// 4. Inject samplePrompts into training config
// (so samples are generated with dataset captions)
trainingConfig.sample.prompts = samplePrompts;
```

### Phase 2: During Training (VastAI)

Training runs normally. Sample images are generated at the end using the `samplePrompts` from the dataset captions.

### Phase 3: After Training (local)

```javascript
// 1. Download artifacts
await ssh.download(`${jobRoot}/output/${modelName}/${modelName}.safetensors`, localPath);
await ssh.download(`${jobRoot}/output/${modelName}/samples/`, localSamplesPath);

// 2. Upload to existing HF repo
await hf.uploadFile({ path: `${modelName}.safetensors`, file: safetensorsPath });
await hf.uploadFolder({ path: 'samples/', folder: localSamplesPath });

// 3. Return HuggingFace URL
return `https://huggingface.co/${hfOrg}/${modelName}`;
```

## API Requirements

- **OpenAI/Claude API** for description generation
- **HuggingFace Hub API** for uploads (`huggingface_hub` Python or REST API)
- Alternative: `hf` CLI tool via SSH on remote instance

## Error Handling

| Failure | Fallback |
|---------|----------|
| GPT description fails | Use generic: "A LoRA trained on custom images. Use trigger word `{trigger}` to activate." |
| Sample images missing | Omit sample grid, add note "Sample images coming soon" |
| HuggingFace upload fails | Upload to Cloudflare R2 instead |
