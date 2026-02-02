/**
 * KONTEXTConfigGenerator
 *
 * Generates ai-toolkit YAML configuration for KONTEXT LoRA training.
 * Supports both style_subject mode (single dataset) and concept mode (paired datasets).
 */

class KONTEXTConfigGenerator {
  constructor({ logger }) {
    this.logger = logger || console;
  }

  /**
   * Generate ai-toolkit YAML config for KONTEXT training
   *
   * @param {Object} options
   * @param {string} options.name - Model name
   * @param {string} options.datasetPath - Path to result dataset folder
   * @param {string} [options.controlPath] - Path to control folder (concept mode only)
   * @param {string} options.trainingMode - 'style_subject' or 'concept'
   * @param {number} [options.steps=3000] - Training steps
   * @param {number} [options.learningRate=1e-4] - Learning rate
   * @param {number} [options.loraRank=16] - LoRA rank
   * @param {number} [options.loraAlpha=16] - LoRA alpha
   * @param {string} [options.triggerWord] - Trigger word for the model
   * @param {number} [options.saveEvery=250] - Save checkpoint every N steps
   * @param {number} [options.sampleEvery=250] - Sample every N steps
   * @param {string[]} [options.samplePrompts] - Prompts for sampling during training
   * @returns {string} YAML configuration
   */
  generate(options) {
    const {
      name,
      datasetPath,
      controlPath,
      trainingMode,
      steps = 3000,
      learningRate = 1e-4,
      loraRank = 16,
      loraAlpha = 16,
      triggerWord,
      saveEvery = 250,
      sampleEvery = 250,
      samplePrompts = []
    } = options;

    // Build dataset config
    let datasetConfig = `        - folder_path: "${datasetPath}"`;

    if (trainingMode === 'concept' && controlPath) {
      datasetConfig += `
          control_path: "${controlPath}"`;
    }

    datasetConfig += `
          caption_ext: "txt"
          caption_dropout_rate: 0.05
          shuffle_tokens: false
          cache_latents_to_disk: true
          resolution: [ 512, 768 ]`;

    // Build trigger word config
    const triggerConfig = triggerWord
      ? `      trigger_word: "${triggerWord}"`
      : '#      trigger_word: "your_trigger"';

    // Build sample prompts
    const defaultPrompts = [
      'make the person smile',
      'give the person an afro',
      'turn this image into a cartoon',
      'put this person in an action film'
    ];
    const prompts = samplePrompts.length > 0 ? samplePrompts : defaultPrompts;
    const promptsYaml = prompts.map(p => `          - "${p}"`).join('\n');

    const yaml = `---
job: extension
config:
  name: "${name}"
  process:
    - type: 'sd_trainer'
      training_folder: "output"
      device: cuda:0
${triggerConfig}
      network:
        type: "lora"
        linear: ${loraRank}
        linear_alpha: ${loraAlpha}
      save:
        dtype: float16
        save_every: ${saveEvery}
        max_step_saves_to_keep: 4
        push_to_hub: false
      datasets:
${datasetConfig}
      train:
        batch_size: 1
        steps: ${steps}
        gradient_accumulation_steps: 1
        train_unet: true
        train_text_encoder: false
        gradient_checkpointing: true
        noise_scheduler: "flowmatch"
        optimizer: "adamw8bit"
        lr: ${learningRate}
        timestep_type: "weighted"
        dtype: bf16
      model:
        name_or_path: "black-forest-labs/FLUX.1-Kontext-dev"
        arch: "flux_kontext"
        quantize: true
      sample:
        sampler: "flowmatch"
        sample_every: ${sampleEvery}
        width: 1024
        height: 1024
        prompts:
${promptsYaml}
        neg: ""
        seed: 42
        walk_seed: true
        guidance_scale: 4
        sample_steps: 20
meta:
  name: "[name]"
  version: '1.0'
`;

    return yaml;
  }
}

module.exports = KONTEXTConfigGenerator;
