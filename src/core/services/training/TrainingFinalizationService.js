/**
 * Training Finalization Service
 *
 * Handles post-training tasks after launch-training.js completes:
 * 1. Create LoRA model record in database
 * 2. Refresh LoRA trigger map cache (so model is immediately usable)
 * 3. Queue ComfyUI Deploy upload (model file URL stored for async processing)
 * 4. Charge user for training cost
 *
 * Input: trainingResult JSON from launch-training.js
 * Output: { success, loraModel, charged, errors }
 */

const LoRAModelsDB = require('../db/loRAModelDb');
const axios = require('axios');

const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com/api/volume/model';

class TrainingFinalizationService {
  /**
   * @param {Object} options - Service configuration
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.loraModelsDb - LoRAModelsDB instance (optional, will create if not provided)
   * @param {Function} options.refreshLoraCache - Function to refresh LoRA trigger map cache
   * @param {Object} options.pointsService - PointsService instance for billing (optional)
   * @param {Object} options.comfyUIService - ComfyUIService instance (optional, for future direct upload)
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.loraModelsDb = options.loraModelsDb || new LoRAModelsDB(this.logger);
    this.refreshLoraCache = options.refreshLoraCache || null;
    this.pointsService = options.pointsService || null;
    this.comfyUIService = options.comfyUIService || null;

    // Cost multiplier: convert USD training cost to points
    // e.g., $0.10 training cost * 10000 = 1000 points
    this.usdToPointsMultiplier = options.usdToPointsMultiplier || 10000;

    // Platform fee percentage on top of GPU cost
    this.platformFeePercent = options.platformFeePercent || 20; // 20% markup
  }

  /**
   * Finalize a completed training job
   *
   * @param {Object} trainingResult - Result from launch-training.js
   * @param {boolean} trainingResult.success - Whether training succeeded
   * @param {string} trainingResult.modelName - Name of the trained model
   * @param {string} trainingResult.triggerWord - Trigger word for the model
   * @param {number} trainingResult.steps - Training steps
   * @param {string} trainingResult.baseModel - Base model used
   * @param {string} [trainingResult.hfRepoId] - HuggingFace repo ID
   * @param {string} [trainingResult.hfModelUrl] - HuggingFace model URL
   * @param {string} [trainingResult.r2ModelUrl] - Cloudflare R2 model URL
   * @param {string} [trainingResult.gpuType] - GPU type used
   * @param {number} [trainingResult.gpuHourlyRate] - GPU hourly rate in USD
   * @param {number} [trainingResult.durationSeconds] - Training duration in seconds
   * @param {number} [trainingResult.trainingCost] - Calculated training cost in USD
   * @param {number} [trainingResult.finalStep] - Final training step reached
   * @param {number} [trainingResult.totalSteps] - Total steps configured
   * @param {number} [trainingResult.finalLoss] - Final loss value
   * @param {string} [trainingResult.instanceId] - VastAI instance ID
   * @param {string} [trainingResult.jobId] - Training job ID
   * @param {string} masterAccountId - User's master account ID
   * @param {Object} [options] - Additional options
   * @param {string} [options.trainingId] - Training session ID from loraTrainings collection
   * @param {string} [options.datasetId] - Dataset ID used for training
   * @param {string[]} [options.sampleImageUrls] - URLs to sample images
   * @param {string} [options.description] - Model description
   * @param {string} options.walletAddress - User's wallet address for billing (required)
   * @returns {Promise<Object>} Finalization result
   */
  async finalize(trainingResult, masterAccountId, options = {}) {
    const errors = [];
    let loraModel = null;
    let charged = null;
    let cacheRefreshed = false;

    this.logger.info(`[TrainingFinalizationService] Starting finalization for ${trainingResult.modelName} (user: ${masterAccountId})`);

    // Validate required fields
    if (!trainingResult.success) {
      this.logger.warn('[TrainingFinalizationService] Training was not successful, skipping finalization');
      return {
        success: false,
        error: 'Training did not complete successfully',
        loraModel: null,
        charged: null,
        cacheRefreshed: false
      };
    }

    if (!trainingResult.modelName || !trainingResult.triggerWord) {
      throw new Error('trainingResult must include modelName and triggerWord');
    }

    // Check for actual model file URL, not just repo ID
    // hfRepoId is created BEFORE training, but hfModelUrl only exists AFTER successful upload
    if (!trainingResult.hfModelUrl && !trainingResult.r2ModelUrl) {
      this.logger.warn('[TrainingFinalizationService] No model file URL - training may have failed to produce output');
      return {
        success: false,
        error: 'No model file was uploaded (hfModelUrl or r2ModelUrl required)',
        loraModel: null,
        charged: null,
        cacheRefreshed: false
      };
    }

    if (!masterAccountId) {
      throw new Error('masterAccountId is required');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Create LoRA model record in database
    // ─────────────────────────────────────────────────────────────────────────
    try {
      this.logger.info('[TrainingFinalizationService] Creating LoRA model record...');

      loraModel = await this.loraModelsDb.createTrainedLoRAModel({
        modelName: trainingResult.modelName,
        triggerWord: trainingResult.triggerWord,
        steps: trainingResult.steps || trainingResult.totalSteps,
        hfRepoId: trainingResult.hfRepoId,
        r2ModelUrl: trainingResult.r2ModelUrl,
        sampleImageUrls: options.sampleImageUrls || [],
        description: options.description || null,
        baseModel: trainingResult.baseModel,
        trainingId: options.trainingId || trainingResult.jobId,
        datasetId: options.datasetId,
        trainingDuration: trainingResult.durationSeconds,
        finalLoss: trainingResult.finalLoss
      }, masterAccountId);

      if (loraModel) {
        this.logger.info(`[TrainingFinalizationService] LoRA model created: ${loraModel.slug} (ID: ${loraModel._id})`);
      } else {
        errors.push('Failed to create LoRA model record');
        this.logger.error('[TrainingFinalizationService] createTrainedLoRAModel returned null');
      }
    } catch (err) {
      errors.push(`LoRA model creation failed: ${err.message}`);
      this.logger.error('[TrainingFinalizationService] Error creating LoRA model:', err);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Refresh LoRA trigger map cache
    // ─────────────────────────────────────────────────────────────────────────
    if (loraModel && this.refreshLoraCache) {
      try {
        this.logger.info('[TrainingFinalizationService] Refreshing LoRA trigger map cache...');
        await this.refreshLoraCache();
        cacheRefreshed = true;
        this.logger.info('[TrainingFinalizationService] LoRA cache refreshed successfully');
      } catch (err) {
        errors.push(`Cache refresh failed: ${err.message}`);
        this.logger.error('[TrainingFinalizationService] Error refreshing LoRA cache:', err);
      }
    } else if (!this.refreshLoraCache) {
      this.logger.warn('[TrainingFinalizationService] No refreshLoraCache function provided, skipping cache refresh');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Upload to ComfyUI Deploy
    // ─────────────────────────────────────────────────────────────────────────
    let comfyDeployResult = null;
    if (loraModel && options.uploadToComfyDeploy !== false) {
      try {
        this.logger.info('[TrainingFinalizationService] Uploading to ComfyUI Deploy...');
        comfyDeployResult = await this.uploadToComfyDeploy(loraModel);

        if (comfyDeployResult.success) {
          this.logger.info(`[TrainingFinalizationService] ComfyUI Deploy upload successful`);
        } else {
          // ComfyDeploy is non-critical - model is already on HuggingFace
          // Don't add to errors array, just warn. Result is tracked in comfyDeployResult.
          this.logger.warn(`[TrainingFinalizationService] ComfyUI Deploy upload failed (non-critical): ${comfyDeployResult.error}`);
        }
      } catch (err) {
        errors.push(`ComfyUI Deploy upload error: ${err.message}`);
        this.logger.error('[TrainingFinalizationService] ComfyUI Deploy upload error:', err);
      }
    } else if (options.uploadToComfyDeploy === false) {
      this.logger.info('[TrainingFinalizationService] ComfyUI Deploy upload skipped (disabled via options)');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Charge user for training cost
    // ─────────────────────────────────────────────────────────────────────────
    if (this.pointsService && trainingResult.trainingCost > 0) {
      try {
        this.logger.info('[TrainingFinalizationService] Calculating training charge...');

        // Calculate total cost with platform fee
        const gpuCostUsd = trainingResult.trainingCost;
        const platformFeeUsd = gpuCostUsd * (this.platformFeePercent / 100);
        const totalCostUsd = gpuCostUsd + platformFeeUsd;

        // Convert to points
        const pointsToCharge = Math.ceil(totalCostUsd * this.usdToPointsMultiplier);

        this.logger.info(`[TrainingFinalizationService] Cost breakdown: GPU=$${gpuCostUsd.toFixed(4)}, Fee=$${platformFeeUsd.toFixed(4)}, Total=$${totalCostUsd.toFixed(4)}, Points=${pointsToCharge}`);

        // Deduct points using the credit ledger
        const deductionResult = await this.pointsService.deductPointsForTraining({
          walletAddress: options.walletAddress,
          pointsToDeduct: pointsToCharge,
          metadata: {
            source: 'training',
            trainingId: options.trainingId || trainingResult.jobId,
            modelName: trainingResult.modelName,
            modelSlug: loraModel?.slug,
            trainingCostUsd: totalCostUsd,
            gpuType: trainingResult.gpuType,
            gpuHourlyRate: trainingResult.gpuHourlyRate,
            durationSeconds: trainingResult.durationSeconds
          }
        });

        charged = {
          gpuCostUsd,
          platformFeeUsd,
          totalCostUsd,
          pointsCharged: pointsToCharge,
          gpuType: trainingResult.gpuType,
          gpuHourlyRate: trainingResult.gpuHourlyRate,
          durationSeconds: trainingResult.durationSeconds,
          deductionSource: deductionResult.source,
          previousBalance: deductionResult.previousBalance,
          newBalance: deductionResult.newBalance
        };

        this.logger.info(`[TrainingFinalizationService] Training charge completed: ${pointsToCharge} points ($${totalCostUsd.toFixed(4)} USD) via ${deductionResult.source}`);
      } catch (err) {
        errors.push(`Billing failed: ${err.message}`);
        this.logger.error('[TrainingFinalizationService] Error processing training charge:', err);

        // Include partial charge info for debugging
        const gpuCostUsd = trainingResult.trainingCost;
        const platformFeeUsd = gpuCostUsd * (this.platformFeePercent / 100);
        const totalCostUsd = gpuCostUsd + platformFeeUsd;
        const pointsToCharge = Math.ceil(totalCostUsd * this.usdToPointsMultiplier);

        charged = {
          gpuCostUsd,
          platformFeeUsd,
          totalCostUsd,
          pointsCharged: 0,
          error: err.message
        };
      }
    } else if (!this.pointsService) {
      this.logger.warn('[TrainingFinalizationService] No pointsService provided, skipping billing');
    } else if (trainingResult.trainingCost <= 0) {
      this.logger.info('[TrainingFinalizationService] Training cost is zero, skipping billing');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RESULT
    // ─────────────────────────────────────────────────────────────────────────
    const success = loraModel !== null && errors.length === 0;

    const result = {
      success,
      loraModel: loraModel ? {
        _id: loraModel._id,
        slug: loraModel.slug,
        name: loraModel.name,
        triggerWords: loraModel.triggerWords,
        publishedTo: loraModel.publishedTo
      } : null,
      charged,
      cacheRefreshed,
      comfyDeploy: comfyDeployResult,
      errors: errors.length > 0 ? errors : null
    };

    this.logger.info(`[TrainingFinalizationService] Finalization complete. Success: ${success}, Errors: ${errors.length}`);

    return result;
  }

  /**
   * Upload a trained model to ComfyUI Deploy
   *
   * Uses the ComfyDeploy volume/model API to register the model file.
   * Supports HuggingFace repos and direct download links (R2).
   *
   * @param {Object} loraModel - The LoRA model record from createTrainedLoRAModel
   * @returns {Promise<Object>} Upload result { success, comfyDeployId, error }
   */
  async uploadToComfyDeploy(loraModel) {
    const apiKey = process.env.COMFY_DEPLOY_API_KEY;
    if (!apiKey) {
      this.logger.warn('[TrainingFinalizationService] COMFY_DEPLOY_API_KEY not set, skipping ComfyUI Deploy upload');
      return { success: false, error: 'COMFY_DEPLOY_API_KEY not configured' };
    }

    if (!loraModel?.publishedTo) {
      return { success: false, error: 'No publishedTo info in model record' };
    }

    const { huggingfaceRepo, cloudflareUrl, modelFileUrl } = loraModel.publishedTo;
    const filename = `${loraModel.slug}.safetensors`;
    const folderPath = 'loras'; // ComfyUI loras folder

    let payload;

    if (huggingfaceRepo) {
      // Use direct link to HuggingFace file - more reliable than huggingface source
      // The huggingface source had issues with file size (downloaded wrong content)
      const directUrl = `https://huggingface.co/${huggingfaceRepo}/resolve/main/${loraModel.name}.safetensors`;
      payload = {
        source: 'link',
        folderPath,
        filename,
        downloadLink: directUrl
      };
      this.logger.info(`[TrainingFinalizationService] Uploading to ComfyDeploy via direct link: ${directUrl}`);
    } else if (cloudflareUrl || modelFileUrl) {
      // Use direct link source for R2 or other URLs
      const downloadUrl = cloudflareUrl || modelFileUrl;
      payload = {
        source: 'link',
        folderPath,
        filename,
        downloadLink: downloadUrl
      };
      this.logger.info(`[TrainingFinalizationService] Uploading to ComfyDeploy via direct link: ${downloadUrl}`);
    } else {
      return { success: false, error: 'No download URL available' };
    }

    try {
      this.logger.info(`[TrainingFinalizationService] POST ${COMFY_DEPLOY_API_URL}`);
      this.logger.info(`[TrainingFinalizationService] Payload: ${JSON.stringify(payload)}`);

      const response = await axios.post(COMFY_DEPLOY_API_URL, payload, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (response.status === 200 || response.status === 201) {
        this.logger.info(`[TrainingFinalizationService] ComfyDeploy upload success: ${JSON.stringify(response.data)}`);

        // Update the model record with ComfyDeploy info
        if (response.data?.id || response.data?.fileId) {
          const comfyDeployId = response.data.id || response.data.fileId;
          await this.loraModelsDb.updateModel(loraModel._id, {
            'publishedTo.comfyDeployId': comfyDeployId,
            'publishedTo.comfyDeployPath': `${folderPath}/${filename}`,
            'publishedTo.comfyDeployUploadedAt': new Date()
          });
          return { success: true, comfyDeployId };
        }

        return { success: true, comfyDeployId: null };
      } else {
        this.logger.error(`[TrainingFinalizationService] ComfyDeploy unexpected status: ${response.status}`);
        return { success: false, error: `Unexpected status: ${response.status}` };
      }
    } catch (err) {
      // Always log full response for debugging 4xx errors
      if (err.response?.status && err.response?.data) {
        this.logger.error(`[TrainingFinalizationService] ComfyDeploy ${err.response.status} response:`, JSON.stringify(err.response.data, null, 2));
      }

      let errorMsg = err.response?.data?.message || err.response?.data?.error || err.message;
      // Handle case where response.data is an object without message property
      if (err.response?.data && typeof err.response.data === 'object' && !err.response.data.message && !err.response.data.error) {
        errorMsg = `${err.message}: ${JSON.stringify(err.response.data)}`;
      }
      this.logger.error(`[TrainingFinalizationService] ComfyDeploy upload failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Parse the TRAINING_RESULT_JSON from launch-training.js stdout
   *
   * @param {string} stdout - Full stdout from launch-training.js
   * @returns {Object|null} Parsed training result or null if not found
   */
  static parseTrainingResult(stdout) {
    const startMarker = '--- TRAINING_RESULT_JSON ---';
    const endMarker = '--- END_TRAINING_RESULT_JSON ---';

    const startIdx = stdout.indexOf(startMarker);
    const endIdx = stdout.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      return null;
    }

    const jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();

    try {
      return JSON.parse(jsonStr);
    } catch (err) {
      console.error('Failed to parse TRAINING_RESULT_JSON:', err.message);
      return null;
    }
  }
}

module.exports = TrainingFinalizationService;
