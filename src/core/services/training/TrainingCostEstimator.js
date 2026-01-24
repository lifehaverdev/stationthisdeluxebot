/**
 * Training Cost Estimator
 *
 * Estimates training costs based on:
 * - Model type (FLUX, SD1.5, SDXL)
 * - Training steps
 * - Dataset size (image count)
 * - GPU class (24GB, 48GB)
 *
 * Uses historical data when available, falls back to hardcoded estimates.
 * Applies conservative buffer (50%) for prepaid model.
 */

// Hardcoded baseline estimates (refined as data accumulates)
const TRAINING_ESTIMATES = {
  FLUX: {
    baseHoursPerStep: 0.0012,    // ~2.4 hrs for 2000 steps on 24GB
    perImageMultiplier: 1.02,    // +2% per image over baseline
    baselineImages: 20,
    minHours: 0.25,              // Minimum 15 min even for tiny jobs
  },
  SDXL: {
    baseHoursPerStep: 0.0008,    // Faster than FLUX
    perImageMultiplier: 1.015,
    baselineImages: 20,
    minHours: 0.15,
  },
  'SD1.5': {
    baseHoursPerStep: 0.0004,    // Much faster
    perImageMultiplier: 1.01,
    baselineImages: 20,
    minHours: 0.1,
  },
};

// Default GPU rates by VRAM class
const GPU_CLASS_RATES = {
  '24GB': 0.35,   // RTX 3090/4090 typical
  '48GB': 0.80,   // A6000 typical
  '80GB': 1.50,   // A100 typical
};

// Conservative buffer for prepaid model
const BUFFER_MULTIPLIER = 1.5;

// Platform fee percentage
const PLATFORM_FEE_PERCENT = 20;

// Points per USD
const POINTS_PER_USD = 10000;

class TrainingCostEstimator {
  /**
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.trainingDb - TrainingDB for historical data
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.trainingDb = options.trainingDb || null;
  }

  /**
   * Estimate training cost in points
   *
   * @param {Object} params - Training parameters
   * @param {string} params.baseModel - Model type (FLUX, SDXL, SD1.5)
   * @param {number} params.steps - Training steps
   * @param {number} params.imageCount - Number of images in dataset
   * @param {string} [params.gpuClass='24GB'] - GPU VRAM class
   * @returns {Object} Cost estimate
   */
  async estimate(params) {
    const { baseModel, steps, imageCount, gpuClass = '24GB' } = params;

    // Try historical estimation first
    if (this.trainingDb) {
      try {
        const historicalEstimate = await this._estimateFromHistory(params);
        if (historicalEstimate) {
          this.logger.info(`[CostEstimator] Using historical estimate for ${baseModel}`);
          return historicalEstimate;
        }
      } catch (err) {
        this.logger.warn(`[CostEstimator] Historical estimation failed: ${err.message}`);
      }
    }

    // Fall back to hardcoded estimates
    return this._estimateFromDefaults(params);
  }

  /**
   * Estimate from historical training data
   * @private
   */
  async _estimateFromHistory(params) {
    const { baseModel, steps, imageCount, gpuClass = '24GB' } = params;

    const historicalJobs = await this.trainingDb.getCompletedTrainingsForEstimation(baseModel, 20);

    if (historicalJobs.length < 5) {
      // Not enough data for reliable historical estimate
      return null;
    }

    // Calculate average hours per step from historical data
    let totalHoursPerStep = 0;
    let validSamples = 0;

    for (const job of historicalJobs) {
      if (job.startedAt && job.completedAt && job.steps > 0) {
        const durationHours = (job.completedAt - job.startedAt) / (1000 * 60 * 60);
        const hoursPerStep = durationHours / job.steps;

        // Filter outliers (more than 3x median)
        if (hoursPerStep > 0 && hoursPerStep < 0.01) {
          totalHoursPerStep += hoursPerStep;
          validSamples++;
        }
      }
    }

    if (validSamples < 3) {
      return null;
    }

    const avgHoursPerStep = totalHoursPerStep / validSamples;

    // Estimate for this job
    const estimatedHours = avgHoursPerStep * steps;

    // Apply image count adjustment (more images = slightly longer)
    const baselineImages = TRAINING_ESTIMATES[baseModel]?.baselineImages || 20;
    const imageMultiplier = 1 + ((imageCount - baselineImages) / baselineImages) * 0.1;
    const adjustedHours = estimatedHours * Math.max(0.8, Math.min(1.5, imageMultiplier));

    // Get GPU rate
    const gpuRate = GPU_CLASS_RATES[gpuClass] || GPU_CLASS_RATES['24GB'];

    // Calculate costs
    const gpuCostUsd = adjustedHours * gpuRate;
    const platformFeeUsd = gpuCostUsd * (PLATFORM_FEE_PERCENT / 100);
    const totalCostUsd = gpuCostUsd + platformFeeUsd;

    // Apply buffer
    const bufferedCostUsd = totalCostUsd * BUFFER_MULTIPLIER;
    const estimatedPoints = Math.ceil(bufferedCostUsd * POINTS_PER_USD);

    return {
      estimatedPoints,
      estimatedHours: adjustedHours,
      bufferedHours: adjustedHours * BUFFER_MULTIPLIER,
      gpuRate,
      gpuCostUsd,
      platformFeeUsd,
      totalCostUsd,
      bufferedCostUsd,
      source: 'historical',
      sampleCount: validSamples,
    };
  }

  /**
   * Estimate from hardcoded defaults
   * @private
   */
  _estimateFromDefaults(params) {
    const { baseModel, steps, imageCount, gpuClass = '24GB' } = params;

    // Get model-specific estimates
    const modelEstimates = TRAINING_ESTIMATES[baseModel] || TRAINING_ESTIMATES.FLUX;

    // Base hours from steps
    let estimatedHours = modelEstimates.baseHoursPerStep * steps;

    // Adjust for dataset size
    const imageDiff = imageCount - modelEstimates.baselineImages;
    if (imageDiff > 0) {
      estimatedHours *= Math.pow(modelEstimates.perImageMultiplier, imageDiff);
    }

    // Enforce minimum
    estimatedHours = Math.max(modelEstimates.minHours, estimatedHours);

    // Get GPU rate
    const gpuRate = GPU_CLASS_RATES[gpuClass] || GPU_CLASS_RATES['24GB'];

    // Calculate costs
    const gpuCostUsd = estimatedHours * gpuRate;
    const platformFeeUsd = gpuCostUsd * (PLATFORM_FEE_PERCENT / 100);
    const totalCostUsd = gpuCostUsd + platformFeeUsd;

    // Apply buffer
    const bufferedCostUsd = totalCostUsd * BUFFER_MULTIPLIER;
    const estimatedPoints = Math.ceil(bufferedCostUsd * POINTS_PER_USD);

    this.logger.info(`[CostEstimator] Default estimate: ${baseModel}, ${steps} steps, ${imageCount} images`);
    this.logger.info(`[CostEstimator] Estimated: ${estimatedHours.toFixed(2)} hrs, ${estimatedPoints} points (buffered)`);

    return {
      estimatedPoints,
      estimatedHours,
      bufferedHours: estimatedHours * BUFFER_MULTIPLIER,
      gpuRate,
      gpuCostUsd,
      platformFeeUsd,
      totalCostUsd,
      bufferedCostUsd,
      source: 'default',
    };
  }

  /**
   * Calculate maximum affordable runtime given prepaid points and actual GPU rate
   *
   * @param {number} prepaidPoints - Points charged upfront
   * @param {number} actualGpuRate - Actual GPU rate in $/hr
   * @returns {number} Maximum hours the user can afford
   */
  calculateMaxAffordableHours(prepaidPoints, actualGpuRate) {
    // Reverse the calculation: points -> USD -> hours
    // points = hours * rate * (1 + platformFee) * pointsPerUsd
    // hours = points / (rate * (1 + platformFee) * pointsPerUsd)

    const platformMultiplier = 1 + (PLATFORM_FEE_PERCENT / 100);
    const maxHours = prepaidPoints / (actualGpuRate * platformMultiplier * POINTS_PER_USD);

    return maxHours;
  }

  /**
   * Calculate actual cost from training duration
   *
   * @param {number} durationHours - Actual training duration in hours
   * @param {number} gpuRate - GPU rate in $/hr
   * @returns {Object} Actual cost breakdown
   */
  calculateActualCost(durationHours, gpuRate) {
    const gpuCostUsd = durationHours * gpuRate;
    const platformFeeUsd = gpuCostUsd * (PLATFORM_FEE_PERCENT / 100);
    const totalCostUsd = gpuCostUsd + platformFeeUsd;
    const actualPoints = Math.ceil(totalCostUsd * POINTS_PER_USD);

    return {
      actualPoints,
      durationHours,
      gpuRate,
      gpuCostUsd,
      platformFeeUsd,
      totalCostUsd,
    };
  }

  /**
   * Calculate refund or overage
   *
   * @param {number} estimatedPoints - Points charged upfront
   * @param {number} actualPoints - Actual cost in points
   * @returns {Object} Reconciliation result
   */
  reconcile(estimatedPoints, actualPoints) {
    const difference = estimatedPoints - actualPoints;

    if (difference > 0) {
      return {
        action: 'refund',
        amount: difference,
        estimatedPoints,
        actualPoints,
      };
    } else if (difference < 0) {
      return {
        action: 'overage',
        amount: Math.abs(difference),
        estimatedPoints,
        actualPoints,
      };
    } else {
      return {
        action: 'none',
        amount: 0,
        estimatedPoints,
        actualPoints,
      };
    }
  }
}

// Export constants for external use
TrainingCostEstimator.TRAINING_ESTIMATES = TRAINING_ESTIMATES;
TrainingCostEstimator.GPU_CLASS_RATES = GPU_CLASS_RATES;
TrainingCostEstimator.BUFFER_MULTIPLIER = BUFFER_MULTIPLIER;
TrainingCostEstimator.PLATFORM_FEE_PERCENT = PLATFORM_FEE_PERCENT;
TrainingCostEstimator.POINTS_PER_USD = POINTS_PER_USD;

module.exports = TrainingCostEstimator;
