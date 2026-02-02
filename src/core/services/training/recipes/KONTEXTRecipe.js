/**
 * KONTEXT Training Recipe
 *
 * Training recipe for FLUX KONTEXT LoRA models.
 * Supports two training modes:
 * - style_subject: Single dataset with captions (like standard FLUX)
 * - concept: Paired datasets (control + result) for teaching transformations
 */

class KONTEXTRecipe {
  constructor({ logger }) {
    this.logger = logger;
    this.modelType = 'KONTEXT';
    this.name = 'KONTEXT LoRA Training';
    this.description = 'Train LoRA models for FLUX KONTEXT with style/subject or concept modes';
  }

  getName() {
    return this.name;
  }

  getDescription() {
    return this.description;
  }

  getBaseImage() {
    return 'kontext-training:latest';
  }

  getSupportedFormats() {
    return ['jpg', 'jpeg', 'png', 'webp'];
  }

  getDefaultSteps() {
    return 3000;
  }

  getDefaultLearningRate() {
    return 1e-4;
  }

  isGpuRequired() {
    return true;
  }

  getEstimatedTime() {
    return 300; // 5 hours
  }

  getMinImages() {
    return 15;
  }

  getMaxImages() {
    return 150;
  }

  getRecommendedImages() {
    return 30;
  }

  getImageSize() {
    return '512x768'; // KONTEXT prefers smaller due to 2x latent size
  }

  getCostPoints() {
    return 250;
  }

  /**
   * Get available training modes for KONTEXT
   * @returns {Array<string>} ['style_subject', 'concept']
   */
  getTrainingModes() {
    return ['style_subject', 'concept'];
  }

  /**
   * Check if a training mode requires control dataset
   * @param {string} mode - 'style_subject' or 'concept'
   * @returns {boolean}
   */
  requiresControlDataset(mode) {
    return mode === 'concept';
  }

  /**
   * Get default configuration for a training mode
   * @param {string} mode - 'style_subject' or 'concept'
   * @returns {Object}
   */
  getDefaultConfig(mode = 'style_subject') {
    const base = {
      steps: this.getDefaultSteps(),
      learningRate: this.getDefaultLearningRate(),
      batchSize: 1,
      resolution: '512,768',
      loraRank: 16,
      loraAlpha: 16,
      optimizer: 'adamw8bit',
      scheduler: 'cosine',
      warmupSteps: 200,
      captionDropoutRate: 0.05,
      gradientCheckpointing: true,
      trainTextEncoder: false,
      noiseScheduler: 'flowmatch',
      dtype: 'bf16',
      quantize: true,
      saveEvery: 250,
      maxStepSavesToKeep: 4,
      trainingMode: mode,
    };

    return base;
  }

  /**
   * Validate training configuration
   * @param {Object} config
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateConfig(config) {
    const errors = [];

    if (!config.datasetPath) {
      errors.push('Dataset path is required');
    }

    if (!config.steps || config.steps < 500) {
      errors.push('Steps must be at least 500 for KONTEXT');
    }

    if (config.steps > 10000) {
      errors.push('Steps should not exceed 10000 for KONTEXT');
    }

    if (!config.learningRate || config.learningRate <= 0) {
      errors.push('Learning rate must be positive');
    }

    if (!config.batchSize || config.batchSize < 1) {
      errors.push('Batch size must be at least 1');
    }

    // Mode-specific validation
    if (config.trainingMode === 'concept') {
      if (!config.controlPath) {
        errors.push('Control path is required for concept training mode');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Prepare training configuration for a job
   * @param {Object} job - Training job document
   * @param {string} datasetPath - Path to result dataset
   * @param {string} [controlPath] - Path to control dataset (for concept mode)
   * @returns {Object}
   */
  async prepareTrainingConfig(job, datasetPath, controlPath = null) {
    const trainingMode = job.trainingMode || 'style_subject';

    const config = {
      datasetPath,
      controlPath: trainingMode === 'concept' ? controlPath : null,
      outputPath: '/workspace/output',
      modelType: this.modelType,
      baseModel: 'black-forest-labs/FLUX.1-Kontext-dev',
      trainingMode,
      steps: job.steps || this.getDefaultSteps(),
      learningRate: job.learningRate || this.getDefaultLearningRate(),
      batchSize: job.batchSize || 1,
      resolution: job.resolution || '512,768',
      loraRank: job.loraRank || 16,
      loraAlpha: job.loraAlpha || 16,
      optimizer: job.optimizer || 'adamw8bit',
      noiseScheduler: 'flowmatch',
      dtype: 'bf16',
      quantize: true,
      gradientCheckpointing: true,
      trainTextEncoder: false,
      captionDropoutRate: job.captionDropoutRate || 0.05,
      saveEvery: job.saveEvery || 250,
      maxStepSavesToKeep: job.maxStepSavesToKeep || 4,
      triggerWord: job.triggerWord || null,
      jobId: job._id.toString(),
      datasetId: job.datasetId.toString(),
      ownerId: job.ownerAccountId.toString()
    };

    this.logger.info(`Prepared KONTEXT training config for job ${job._id} (mode: ${trainingMode})`);
    return config;
  }
}

module.exports = KONTEXTRecipe;
