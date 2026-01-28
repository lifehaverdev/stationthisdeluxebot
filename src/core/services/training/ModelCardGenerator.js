/**
 * ModelCardGenerator
 *
 * Generates HuggingFace README.md model cards for trained LoRAs.
 * Designed to run BEFORE training starts since all required info
 * (captions, trigger word, model name) is available upfront.
 *
 * Flow:
 * 1. Read captions from dataset manifest
 * 2. Call OpenAI to generate tailored description
 * 3. Build complete README from template
 * 4. Return README content (caller handles HF upload)
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '../vastai/configs/huggingface-readme-template.md');

const DEFAULTS = {
  LICENSE: 'wtfpl',
  BASE_MODEL: 'black-forest-labs/FLUX.1-dev',
  LORA_STRENGTH: '0.8-1.0',
  GUIDANCE_SCALE: '3.5-4.0',
  INFERENCE_STEPS: '20-30',
  HF_ORG: 'ms2stationthis',
  LORA_RANK: '32',
  LORA_ALPHA: '32',
  OPTIMIZER: 'adamw8bit',
  LEARNING_RATE: '1e-4',
  TRAIN_DTYPE: 'bf16',
  RESOLUTION: '512, 768, 1024',
};

class ModelCardGenerator {
  /**
   * @param {object} options
   * @param {object} options.openaiService - Instance of OpenAIService
   * @param {object} options.logger - Logger instance
   */
  constructor({ openaiService, logger } = {}) {
    this.openai = openaiService;
    this.logger = logger || console;
  }

  /**
   * Generate a complete model card README
   *
   * @param {object} params
   * @param {string} params.modelName - Name of the model (e.g., "pepeflux")
   * @param {string} params.triggerWord - Trigger word for the LoRA
   * @param {number} params.trainingSteps - Number of training steps
   * @param {string[]} params.captions - Array of dataset captions
   * @param {string} [params.description] - User-provided description (skips OpenAI if provided)
   * @param {string} [params.hfOrg] - HuggingFace organization
   * @returns {Promise<{readme: string, description: string, samplePrompts: string[]}>}
   */
  async generate({ modelName, triggerWord, trainingSteps, captions, description: userDescription, hfOrg = DEFAULTS.HF_ORG, trainingConfig = {} }) {
    this.logger.info(`[ModelCardGenerator] Generating model card for ${modelName}`);

    let description;

    // Priority: 1. User-provided description, 2. OpenAI-generated, 3. Fallback
    if (userDescription && userDescription.trim()) {
      this.logger.info(`[ModelCardGenerator] Using user-provided description`);
      description = userDescription.trim();
    } else {
      // Select ONE caption for description generation (captions can be very long)
      const selectedCaptions = this._selectDiverseCaptions(captions, 1);
      this.logger.info(`[ModelCardGenerator] Selected ${selectedCaptions.length} caption for OpenAI description`);

      // Generate description via OpenAI (falls back to default if OpenAI fails)
      description = await this._generateDescription({
        modelName,
        triggerWord,
        captions: selectedCaptions,
      });
    }

    // 3. Select captions for sample image prompts (4 for 2x2 grid)
    const sampleCaptions = this._selectDiverseCaptions(captions, 4);
    const samplePrompts = this._prepareSamplePrompts(sampleCaptions, triggerWord);

    // 4. Build example prompts (short, practical)
    const examplePrompts = this._buildExamplePrompts(captions, triggerWord);

    // 5. Load and populate template
    const readme = this._buildReadme({
      modelName,
      triggerWord,
      trainingSteps,
      description,
      samplePrompts,
      examplePrompts,
      hfOrg,
      trainingConfig,
    });

    return {
      readme,
      description,
      samplePrompts,  // Return these so training config can use them
      examplePrompts,
    };
  }

  /**
   * Select diverse captions from dataset
   * Picks evenly-spaced captions for variety
   */
  _selectDiverseCaptions(captions, count) {
    if (!captions || captions.length === 0) {
      return [];
    }

    const filtered = captions.filter(c => c && c.trim().length > 10);
    if (filtered.length <= count) {
      return filtered;
    }

    const step = Math.floor(filtered.length / count);
    const selected = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.min(i * step, filtered.length - 1);
      selected.push(filtered[idx]);
    }
    return selected;
  }

  /**
   * Generate description using OpenAI
   */
  async _generateDescription({ modelName, triggerWord, captions }) {
    if (!this.openai) {
      this.logger.warn('[ModelCardGenerator] No OpenAI service, using fallback description');
      return this._fallbackDescription(modelName, triggerWord);
    }

    // Truncate caption to avoid token explosion (style captions can be 500+ chars)
    const truncatedCaption = captions[0]?.slice(0, 300) || 'custom style';

    const prompt = `Based on this training caption, write a 2-sentence description for a HuggingFace LoRA model card. Be specific about the visual style.

Model: ${modelName}
Trigger: ${triggerWord}
Caption: ${truncatedCaption}

Write ONLY the description, no headers.`;

    try {
      const result = await this.openai.executeChatCompletion({
        prompt,
        instructions: 'You are writing HuggingFace model card descriptions. Be concise and specific about what the LoRA does.',
        model: 'gpt-4o-mini',
        temperature: 0.7,
      });

      return result.content.trim();
    } catch (err) {
      this.logger.error(`[ModelCardGenerator] OpenAI error: ${err.message}`);
      return this._fallbackDescription(modelName, triggerWord);
    }
  }

  _fallbackDescription(modelName, triggerWord) {
    return `This LoRA fine-tunes FLUX.1-dev for custom image generation. Use the trigger word \`${triggerWord}\` in your prompts to activate the trained style. Trained using the StationThis pipeline.`;
  }

  /**
   * Prepare sample prompts for training config
   * Ensures trigger word is present
   */
  _prepareSamplePrompts(captions, triggerWord) {
    const trigger = triggerWord.toLowerCase();
    return captions.map(caption => {
      if (caption.toLowerCase().includes(trigger)) {
        return caption;
      }
      return `${triggerWord}, ${caption}`;
    });
  }

  /**
   * Build short, practical example prompts
   */
  _buildExamplePrompts(captions, triggerWord) {
    // Extract key phrases and simplify
    const examples = [];

    // Try to extract diverse short phrases from captions
    const phrases = new Set();
    for (const caption of captions.slice(0, 10)) {
      // Split on commas and take interesting phrases
      const parts = caption.split(',').map(p => p.trim()).filter(p => p.length > 5 && p.length < 50);
      parts.forEach(p => phrases.add(p));
    }

    // Take first 4 unique phrases
    const uniquePhrases = [...phrases].slice(0, 4);

    // Build example prompts
    for (const phrase of uniquePhrases) {
      examples.push(`\`${triggerWord} ${phrase.toLowerCase()}\``);
    }

    // Add some generic fallbacks if needed
    if (examples.length < 3) {
      examples.push(`\`${triggerWord} portrait, soft lighting, detailed\``);
      examples.push(`\`${triggerWord} in a scenic environment\``);
    }

    return examples.slice(0, 4);
  }

  /**
   * Build the final README from template
   */
  _buildReadme({ modelName, triggerWord, trainingSteps, description, samplePrompts, examplePrompts, hfOrg, trainingConfig = {} }) {
    let template;
    try {
      template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    } catch (err) {
      this.logger.error(`[ModelCardGenerator] Failed to read template: ${err.message}`);
      throw new Error('Failed to read README template');
    }

    const hfRepoId = `${hfOrg}/${modelName}`;

    // Build sample images grid (placeholders - will be uploaded later)
    const sampleGrid = this._buildSampleGrid(samplePrompts);

    // Build widget YAML for HuggingFace model card preview
    const widgetYaml = this._buildWidgetYaml(samplePrompts, modelName);

    // Build example prompts markdown
    const examplePromptsMarkdown = examplePrompts.map(p => `- ${p}`).join('\n');

    // Simple short prompt for code example
    const examplePromptShort = 'portrait, soft lighting, detailed';

    // Replace all placeholders — trainingConfig values override defaults
    const replacements = {
      '{{LICENSE}}': DEFAULTS.LICENSE,
      '{{BASE_MODEL}}': DEFAULTS.BASE_MODEL,
      '{{MODEL_NAME}}': modelName,
      '{{TRIGGER_WORD}}': triggerWord,
      '{{HF_REPO_ID}}': hfRepoId,
      '{{TRAINING_STEPS}}': String(trainingSteps),
      '{{LORA_STRENGTH}}': DEFAULTS.LORA_STRENGTH,
      '{{GUIDANCE_SCALE}}': DEFAULTS.GUIDANCE_SCALE,
      '{{INFERENCE_STEPS}}': DEFAULTS.INFERENCE_STEPS,
      '{{GENERATED_DESCRIPTION}}': description,
      '{{WIDGET_YAML}}': widgetYaml,
      '{{SAMPLE_IMAGES_GRID}}': sampleGrid,
      '{{EXAMPLE_PROMPTS}}': examplePromptsMarkdown,
      '{{EXAMPLE_PROMPT_SHORT}}': examplePromptShort,
      '{{LORA_RANK}}': String(trainingConfig.loraRank || DEFAULTS.LORA_RANK),
      '{{LORA_ALPHA}}': String(trainingConfig.loraAlpha || DEFAULTS.LORA_ALPHA),
      '{{OPTIMIZER}}': trainingConfig.optimizer || DEFAULTS.OPTIMIZER,
      '{{LEARNING_RATE}}': trainingConfig.learningRate || DEFAULTS.LEARNING_RATE,
      '{{TRAIN_DTYPE}}': trainingConfig.trainDtype || DEFAULTS.TRAIN_DTYPE,
      '{{RESOLUTION}}': trainingConfig.resolution || DEFAULTS.RESOLUTION,
    };

    let readme = template;
    for (const [placeholder, value] of Object.entries(replacements)) {
      readme = readme.split(placeholder).join(value);
    }

    return readme;
  }

  /**
   * Build sample images grid markdown
   * Images will be uploaded later, this creates the structure
   */
  _buildSampleGrid(samplePrompts) {
    if (!samplePrompts || samplePrompts.length === 0) {
      return '*Sample images will be added after training completes.*';
    }

    // Truncate captions for display
    const truncate = (s, len = 60) => s.length > len ? s.slice(0, len) + '...' : s;

    // Build 2x2 grid
    const rows = [];
    rows.push('| | |');
    rows.push('|:---:|:---:|');

    for (let i = 0; i < samplePrompts.length; i += 2) {
      // ai-toolkit generates JPG samples
      const img1 = `![Sample ${i + 1}](samples/sample_${String(i).padStart(3, '0')}.jpg)`;
      const img2 = samplePrompts[i + 1]
        ? `![Sample ${i + 2}](samples/sample_${String(i + 1).padStart(3, '0')}.jpg)`
        : '';
      rows.push(`| ${img1} | ${img2} |`);

      const cap1 = `*${truncate(samplePrompts[i])}*`;
      const cap2 = samplePrompts[i + 1] ? `*${truncate(samplePrompts[i + 1])}*` : '';
      rows.push(`| ${cap1} | ${cap2} |`);
    }

    return rows.join('\n');
  }

  /**
   * Build widget YAML for HuggingFace model card preview.
   * Uses the first sample prompt as the text and the first sample image as the output.
   */
  _buildWidgetYaml(samplePrompts, modelName) {
    if (!samplePrompts || samplePrompts.length === 0) {
      return '  - text: "' + modelName + '"';
    }

    // Use first sample prompt. Escape double quotes for YAML safety.
    const promptText = samplePrompts[0].replace(/"/g, '\\"');
    const lines = [
      `  - text: "${promptText}"`,
      `    output:`,
      `      url: samples/sample_000.jpg`,
    ];
    return lines.join('\n');
  }

  /**
   * Extract captions from a dataset manifest
   * @param {object} manifest - Dataset manifest with images array
   * @returns {string[]} Array of captions
   */
  static extractCaptionsFromManifest(manifest) {
    if (!manifest || !manifest.images) {
      return [];
    }
    return manifest.images
      .map(img => img.caption)
      .filter(c => c && c.trim().length > 0);
  }

  /**
   * Extract training config values from a YAML config template.
   * Parses the static (non-templated) values like LoRA rank, optimizer, etc.
   *
   * @param {string} configPath - Path to the YAML config template
   * @returns {object} Extracted training config values
   */
  static extractTrainingConfig(configPath) {
    let content;
    try {
      content = fs.readFileSync(configPath, 'utf-8');
    } catch (err) {
      return {};
    }

    const extract = (pattern) => {
      const match = content.match(pattern);
      return match ? match[1].trim() : null;
    };

    // Extract LoRA network config
    const loraRank = extract(/^\s+linear:\s*(\d+)/m);
    const loraAlpha = extract(/^\s+linear_alpha:\s*(\d+)/m);

    // Extract training params
    const optimizer = extract(/^\s+optimizer:\s*"?([^"\s]+)"?/m);
    const learningRate = extract(/^\s+lr:\s*([^\s#]+)/m);
    const trainDtype = extract(/^\s+dtype:\s*([^\s#]+)/m);
    const batchSize = extract(/^\s+batch_size:\s*(\d+)/m);
    const gradAccum = extract(/^\s+gradient_accumulation_steps:\s*(\d+)/m);

    // Extract resolution array
    const resMatch = content.match(/^\s+resolution:\s*\[\s*([^\]]+)\]/m);
    const resolution = resMatch
      ? resMatch[1].split(',').map(s => s.trim()).join(', ')
      : null;

    // Extract EMA config
    const useEma = extract(/^\s+use_ema:\s*(true|false)/m);
    const emaDecay = extract(/^\s+ema_decay:\s*([^\s#]+)/m);

    // Extract model quantization
    const quantize = extract(/^\s+quantize:\s*(true|false)/m);

    const config = {};
    if (loraRank) config.loraRank = loraRank;
    if (loraAlpha) config.loraAlpha = loraAlpha;
    if (optimizer) config.optimizer = optimizer;
    if (learningRate) config.learningRate = learningRate;
    if (trainDtype) config.trainDtype = trainDtype;
    if (batchSize) config.batchSize = batchSize;
    if (gradAccum) config.gradAccum = gradAccum;
    if (resolution) config.resolution = resolution;
    if (useEma) config.useEma = useEma === 'true';
    if (emaDecay) config.emaDecay = emaDecay;
    if (quantize) config.quantize = quantize === 'true';

    return config;
  }
}

module.exports = ModelCardGenerator;
