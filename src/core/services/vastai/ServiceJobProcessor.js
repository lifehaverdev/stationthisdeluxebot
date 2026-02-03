/**
 * ServiceJobProcessor - Individual service request processor
 *
 * Processes individual GPU service requests (inference, workflows, etc.)
 * Similar to TrainingJobProcessor but for short-lived requests.
 *
 * FLOW:
 *   1. Mark job as EXECUTING via serviceJobDb.markExecuting()
 *   2. Generate signed R2 upload URL for results via storageService
 *   3. Execute job via serviceRunner.executeJob(job, { r2UploadUrl })
 *   4. If failed: markFailed, completeJob (to release instance), return error
 *   5. Calculate cost based on GPU seconds and hourly rate
 *   6. Bill user via pointsService
 *   7. Mark completed via serviceJobDb.markCompleted()
 *   8. Release instance via scheduler.completeJob()
 *   9. Return result
 *
 * BILLING:
 *   - Cost = (gpuSeconds / 3600) * hourlyRate * tierMultiplier
 *   - Tier multipliers determine markup (free tier gets higher multiplier)
 *   - Points conversion: 1 point ~ $0.0001 (multiply USD by 10000)
 *   - Billing failures are logged but don't fail the job (ops handles manually)
 *
 * @see src/core/services/training/TrainingJobProcessor.js - Similar pattern for training
 * @see src/core/services/vastai/ServiceRunner.js - Job execution
 */

class ServiceJobProcessor {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance
   * @param {object} options.serviceJobDb - ServiceJobDB instance
   * @param {object} options.scheduler - GPUScheduler instance
   * @param {object} options.serviceRunner - ServiceRunner instance
   * @param {object} options.pointsService - PointsService for billing
   * @param {object} options.storageService - R2 storage service for upload URLs
   * @param {object} options.config - Configuration options
   */
  constructor(options = {}) {
    if (!options.logger) {
      throw new Error('ServiceJobProcessor requires a logger');
    }
    if (!options.serviceJobDb) {
      throw new Error('ServiceJobProcessor requires a serviceJobDb');
    }
    if (!options.scheduler) {
      throw new Error('ServiceJobProcessor requires a scheduler');
    }
    if (!options.serviceRunner) {
      throw new Error('ServiceJobProcessor requires a serviceRunner');
    }

    this.logger = options.logger;
    this.serviceJobDb = options.serviceJobDb;
    this.scheduler = options.scheduler;
    this.serviceRunner = options.serviceRunner;
    this.pointsService = options.pointsService || null;
    this.storageService = options.storageService || null;
    this.config = {
      // Tier multipliers for cost calculation
      // Higher multiplier = higher cost for user
      tierMultipliers: {
        free: 1.5,      // Free tier: 1.5x markup
        holder: 1.2,    // Token holders: 1.2x markup
        premium: 1.0    // Premium/VIP: no markup
      },
      // Points per USD (1 point ~ $0.0001)
      pointsPerUsd: 10000,
      ...options.config
    };
  }

  /**
   * Process a single service job end-to-end
   *
   * @param {object} job - Job object from ServiceJobDB
   * @param {object} context - Processing context
   * @param {string} context.instanceId - VastAI instance ID processing this job
   * @param {number} context.hourlyRate - GPU hourly rate in USD
   * @returns {Promise<object>} Result with { success, outputs, gpuSeconds, costUsd, error }
   */
  async process(job, context = {}) {
    const jobId = job._id.toString();
    const { instanceId, hourlyRate = 0 } = context;

    this.logger.info(`[ServiceJobProcessor] Processing job ${jobId} (type: ${job.requestType})`);

    let gpuSeconds = 0;
    let costUsd = 0;

    try {
      // Step 1: Mark job as executing
      await this.serviceJobDb.markExecuting(jobId);
      this.logger.info(`[ServiceJobProcessor] Job ${jobId} marked as EXECUTING`);

      // Step 2: Generate signed R2 upload URL for results
      const r2UploadUrl = await this._generateUploadUrl(jobId);

      // Step 3: Execute job via serviceRunner
      const result = await this.serviceRunner.executeJob(job, { r2UploadUrl });
      gpuSeconds = result.gpuSeconds || 0;

      // Step 4: Handle failure
      if (!result.success) {
        this.logger.error(`[ServiceJobProcessor] Job ${jobId} execution failed: ${result.error}`);

        // Mark job as failed
        await this.serviceJobDb.markFailed(jobId, result.error);

        // Release instance back to pool
        await this._releaseInstance(jobId, instanceId, job.requestType);

        return {
          success: false,
          outputs: null,
          gpuSeconds,
          costUsd: 0,
          error: result.error
        };
      }

      // Step 5: Calculate cost
      costUsd = this._calculateCost(gpuSeconds, hourlyRate, job.userId);
      this.logger.info(`[ServiceJobProcessor] Job ${jobId} cost: $${costUsd.toFixed(6)} (${gpuSeconds.toFixed(2)}s @ $${hourlyRate}/hr)`);

      // Step 6: Bill user (non-blocking - failures logged but don't fail job)
      await this._billUser(job, costUsd, gpuSeconds);

      // Step 7: Mark job as completed
      await this.serviceJobDb.markCompleted(jobId, result.outputs, gpuSeconds);
      this.logger.info(`[ServiceJobProcessor] Job ${jobId} marked as COMPLETED`);

      // Step 8: Release instance back to pool
      await this._releaseInstance(jobId, instanceId, job.requestType);

      // Step 9: Return success result
      return {
        success: true,
        outputs: result.outputs,
        gpuSeconds,
        costUsd,
        error: null
      };

    } catch (err) {
      this.logger.error(`[ServiceJobProcessor] Unexpected error processing job ${jobId}:`, err);

      // Attempt to mark failed and release instance
      try {
        await this.serviceJobDb.markFailed(jobId, `Unexpected error: ${err.message}`);
      } catch (markErr) {
        this.logger.error(`[ServiceJobProcessor] Failed to mark job ${jobId} as failed:`, markErr);
      }

      try {
        await this._releaseInstance(jobId, instanceId, job.requestType);
      } catch (releaseErr) {
        this.logger.error(`[ServiceJobProcessor] Failed to release instance for job ${jobId}:`, releaseErr);
      }

      return {
        success: false,
        outputs: null,
        gpuSeconds,
        costUsd: 0,
        error: err.message
      };
    }
  }

  /**
   * Calculate cost based on GPU seconds and hourly rate
   *
   * @param {number} gpuSeconds - Actual GPU seconds used
   * @param {number} hourlyRate - GPU hourly rate in USD
   * @param {string} userId - User ID for tier lookup
   * @returns {number} Cost in USD
   * @private
   */
  _calculateCost(gpuSeconds, hourlyRate, userId) {
    const tier = this._getUserTier(userId);
    const multiplier = this.config.tierMultipliers[tier] || this.config.tierMultipliers.free;
    return (gpuSeconds / 3600) * hourlyRate * multiplier;
  }

  /**
   * Get user's pricing tier based on token holdings
   *
   * For now, always returns 'free'. Later will check token holdings.
   *
   * @param {string} userId - User ID
   * @returns {string} Tier name ('free', 'holder', or 'premium')
   * @private
   */
  _getUserTier(userId) {
    // TODO: Check token holdings via token service
    // For now, everyone is on free tier
    return 'free';
  }

  /**
   * Generate signed R2 upload URL for job results
   *
   * @param {string} jobId - Job ID for path generation
   * @returns {Promise<string>} Signed upload URL or placeholder
   * @private
   */
  async _generateUploadUrl(jobId) {
    if (!this.storageService) {
      this.logger.warn(`[ServiceJobProcessor] No storageService available, using placeholder URL`);
      return `placeholder://results/${jobId}`;
    }

    try {
      // Generate a signed URL for uploading results
      // Path: service-jobs/{jobId}/results.json (or similar)
      const key = `service-jobs/${jobId}/results.json`;
      const url = await this.storageService.getSignedUploadUrl(key, {
        expiresIn: 3600, // 1 hour expiry
        contentType: 'application/json'
      });
      this.logger.info(`[ServiceJobProcessor] Generated R2 upload URL for job ${jobId}`);
      return url;
    } catch (err) {
      this.logger.error(`[ServiceJobProcessor] Failed to generate R2 upload URL: ${err.message}`);
      // Return placeholder if storage service fails - job can still proceed
      return `placeholder://results/${jobId}`;
    }
  }

  /**
   * Bill user for the job cost
   *
   * Converts USD to points and deducts from user's balance.
   * Failures are logged but don't fail the job - ops will handle manually.
   *
   * @param {object} job - Job object with userId, walletAddress
   * @param {number} costUsd - Cost in USD
   * @param {number} gpuSeconds - GPU seconds used
   * @returns {Promise<void>}
   * @private
   */
  async _billUser(job, costUsd, gpuSeconds) {
    const jobId = job._id.toString();

    // Convert USD to points (1 point ~ $0.0001)
    const pointsToDeduct = Math.ceil(costUsd * this.config.pointsPerUsd);

    if (pointsToDeduct <= 0) {
      this.logger.info(`[ServiceJobProcessor] No points to deduct for job ${jobId} (cost: $${costUsd.toFixed(6)})`);
      return;
    }

    this.logger.info(`[ServiceJobProcessor] Billing job ${jobId}: ${pointsToDeduct} points ($${costUsd.toFixed(6)})`);

    // Check if points service is available and has the deduct method
    if (!this.pointsService || typeof this.pointsService.deductPointsForService !== 'function') {
      // Try fallback to deductPointsForTraining if available (similar signature)
      if (this.pointsService && typeof this.pointsService.deductPointsForTraining === 'function') {
        try {
          await this.pointsService.deductPointsForTraining({
            walletAddress: job.walletAddress,
            pointsToDeduct,
            metadata: {
              source: 'service_job',
              jobId,
              requestType: job.requestType,
              gpuSeconds,
              costUsd
            }
          });
          this.logger.info(`[ServiceJobProcessor] Billed ${pointsToDeduct} points to ${job.walletAddress} (via training method)`);
          return;
        } catch (err) {
          this.logger.error(`[ServiceJobProcessor] Billing failed for job ${jobId}: ${err.message}`);
          this.logger.warn(`[ServiceJobProcessor] BILLING ALERT: Job ${jobId} completed but billing failed. Manual reconciliation needed.`);
          this.logger.warn(`[ServiceJobProcessor] Details: wallet=${job.walletAddress}, points=${pointsToDeduct}, costUsd=${costUsd}`);
          // Don't throw - let job complete
          return;
        }
      }

      this.logger.warn(`[ServiceJobProcessor] No pointsService available for billing job ${jobId}`);
      this.logger.warn(`[ServiceJobProcessor] BILLING ALERT: Job ${jobId} completed but no billing performed. Manual reconciliation needed.`);
      this.logger.warn(`[ServiceJobProcessor] Details: wallet=${job.walletAddress}, points=${pointsToDeduct}, costUsd=${costUsd}`);
      return;
    }

    try {
      await this.pointsService.deductPointsForService({
        walletAddress: job.walletAddress,
        pointsToDeduct,
        metadata: {
          source: 'service_job',
          jobId,
          requestType: job.requestType,
          gpuSeconds,
          costUsd
        }
      });
      this.logger.info(`[ServiceJobProcessor] Billed ${pointsToDeduct} points to ${job.walletAddress}`);
    } catch (err) {
      this.logger.error(`[ServiceJobProcessor] Billing failed for job ${jobId}: ${err.message}`);
      this.logger.warn(`[ServiceJobProcessor] BILLING ALERT: Job ${jobId} completed but billing failed. Manual reconciliation needed.`);
      this.logger.warn(`[ServiceJobProcessor] Details: wallet=${job.walletAddress}, points=${pointsToDeduct}, costUsd=${costUsd}`);
      // Don't throw - let job complete, ops will handle billing issues
    }
  }

  /**
   * Release instance back to the pool
   *
   * @param {string} jobId - Job ID
   * @param {string} instanceId - Instance ID to release
   * @param {string} requestType - Request type for warmth tracking
   * @returns {Promise<void>}
   * @private
   */
  async _releaseInstance(jobId, instanceId, requestType) {
    if (!instanceId) {
      this.logger.warn(`[ServiceJobProcessor] No instanceId provided for job ${jobId}, skipping release`);
      return;
    }

    try {
      await this.scheduler.completeJob(jobId, instanceId, requestType);
      this.logger.info(`[ServiceJobProcessor] Released instance ${instanceId} for job ${jobId}`);
    } catch (err) {
      this.logger.error(`[ServiceJobProcessor] Failed to release instance ${instanceId}: ${err.message}`);
      throw err;
    }
  }
}

module.exports = ServiceJobProcessor;
