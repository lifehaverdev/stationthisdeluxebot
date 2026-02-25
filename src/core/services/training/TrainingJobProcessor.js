/**
 * Training Job Processor
 *
 * Core logic for processing a single training job:
 * 1. Validate and charge upfront
 * 2. Provision GPU via VastAI
 * 3. Execute training via launch-training.js
 * 4. Monitor progress, handle stalls/timeouts
 * 5. Finalize (DB record, cache refresh, ComfyUI Deploy)
 * 6. Reconcile cost
 * 7. Terminate instance
 *
 * Separated from worker loop for testability and clarity.
 */

const { spawn } = require('child_process');
const path = require('path');
const TrainingCostEstimator = require('./TrainingCostEstimator');
const TrainingFinalizationService = require('./TrainingFinalizationService');
const DatasetDownloader = require('./DatasetDownloader');
const StallDetector = require('../vastai/StallDetector');
const TrainingOutputParser = require('../vastai/TrainingOutputParser');

// Grace period for stall recovery (15 minutes)
const STALL_GRACE_PERIOD_MS = 15 * 60 * 1000;

// Poll interval for monitoring
const MONITOR_POLL_INTERVAL_MS = 5000;

// Progress milestones for user notifications
const PROGRESS_MILESTONES = [25, 50, 75];

class TrainingJobProcessor {
  /**
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.trainingDb - TrainingDB instance
   * @param {Object} options.datasetDb - DatasetDB instance for downloading datasets
   * @param {Object} options.generationOutputsDb - GenerationOutputsDB for extracting per-image prompts
   * @param {Object} options.pointsService - PointsService for billing
   * @param {Object} options.vastaiService - VastAIService for instance management
   * @param {Function} options.refreshLoraCache - Function to refresh LoRA cache
   * @param {Function} options.alertOps - Function to alert ops (Telegram)
   * @param {Function} options.alertUser - Function to alert user
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.trainingDb = options.trainingDb;
    this.datasetDb = options.datasetDb;
    this.generationOutputsDb = options.generationOutputsDb;
    this.pointsService = options.pointsService;
    this.vastaiService = options.vastaiService;
    this.refreshLoraCache = options.refreshLoraCache;
    this.alertOps = options.alertOps || (() => {});
    this.alertUser = options.alertUser || (() => {});

    // Initialize cost estimator
    this.costEstimator = new TrainingCostEstimator({
      logger: this.logger,
      trainingDb: this.trainingDb,
    });

    // Initialize finalization service
    this.finalizationService = new TrainingFinalizationService({
      logger: this.logger,
      pointsService: this.pointsService,
      refreshLoraCache: this.refreshLoraCache,
    });

    // Initialize dataset downloader
    this.datasetDownloader = new DatasetDownloader({
      logger: this.logger,
      datasetDb: this.datasetDb,
      generationOutputsDb: this.generationOutputsDb,
    });

    // Path to launch-training.js
    this.launchTrainingScript = path.resolve(__dirname, '../../../../scripts/vastai/launch-training.js');
  }

  /**
   * Process a single training job end-to-end
   *
   * @param {Object} job - Training job from TrainingDB
   * @returns {Object} Processing result
   */
  async process(job) {
    const jobId = job._id.toString();
    this.logger.info(`[JobProcessor] Starting job ${jobId}: ${job.modelName}`);

    let instanceId = null;
    let result = { success: false, jobId };
    let chargedPoints = 0; // Track for refund on unexpected errors

    try {
      // Step 1: Estimate and charge upfront
      const chargeResult = await this._estimateAndCharge(job);
      if (!chargeResult.success) {
        await this.trainingDb.markFailed(jobId, chargeResult.error);
        this.alertUser(job.ownerAccountId, 'error', `Training failed: ${chargeResult.error}`);
        return { success: false, jobId, error: chargeResult.error };
      }
      chargedPoints = chargeResult.estimatedPoints; // Track for refund on unexpected errors

      // Step 2: Execute training (provisions, uploads, trains, uploads to HF/R2)
      this.alertUser(job.ownerAccountId, 'info', `Training started: ${job.modelName}`);
      const trainingResult = await this._executeTraining(job);
      instanceId = trainingResult.instanceId;

      if (trainingResult.cancelled) {
        this.logger.info(`[JobProcessor] Job ${jobId} was cancelled during execution`);
        if (trainingResult.instanceId) {
          await this._terminateInstance(trainingResult.instanceId, jobId);
        }
        await this._refundCancelled(job, chargedPoints);
        return { success: false, jobId, cancelled: true };
      }

      if (!trainingResult.success) {
        await this.trainingDb.markFailed(jobId, trainingResult.error, {
          vastaiInstanceId: instanceId,
        });
        this.alertOps('Training failed', { jobId, error: trainingResult.error });
        this.alertUser(job.ownerAccountId, 'error', `Training failed: ${trainingResult.error}`);

        // Still need to terminate instance
        if (instanceId) {
          await this._terminateInstance(instanceId, jobId);
        }

        // Reconcile cost (partial refund for failed job)
        await this._reconcileCost(job, chargeResult.estimatedPoints, trainingResult.actualDurationHours || 0);

        return { success: false, jobId, error: trainingResult.error };
      }

      // Step 3: Finalization
      await this.trainingDb.setStatusUnlessCancelled(jobId, 'FINALIZING');

      const finalizationResult = await this.finalizationService.finalize(
        trainingResult.trainingResult,
        job.ownerAccountId,
        {
          trainingId: jobId,
          datasetId: job.datasetId,
          walletAddress: job.walletAddress,
        }
      );

      // Check if finalization actually succeeded (model file must exist)
      if (!finalizationResult.success) {
        // finalizationResult.error is used for early validation failures
        // finalizationResult.errors is an array of errors from processing steps
        const errorMsg = finalizationResult.error
          || (finalizationResult.errors?.length > 0 ? finalizationResult.errors.join('; ') : null)
          || 'Finalization failed - unknown error';
        this.logger.error(`[JobProcessor] Finalization failed for ${jobId}: ${errorMsg}`);
        await this.trainingDb.markFailed(jobId, errorMsg);
        this.alertUser(job.ownerAccountId, 'error', `Training failed: ${errorMsg}`);

        // Refund points since no model was produced
        await this._reconcileCost(job, chargeResult.estimatedPoints, 0);

        return { success: false, jobId, error: errorMsg };
      }

      // Step 4: Reconcile cost
      const actualDurationHours = (trainingResult.trainingResult?.durationSeconds || 0) / 3600;
      const gpuRate = job.gpuHourlyRate || trainingResult.trainingResult?.gpuHourlyRate || 0.35;
      await this._reconcileCost(job, chargeResult.estimatedPoints, actualDurationHours, gpuRate);

      // Step 5: Mark completed
      await this.trainingDb.markCompleted(jobId, {
        loraModelId: finalizationResult.loraModel?._id,
        modelRepoUrl: trainingResult.trainingResult?.hfModelUrl || trainingResult.trainingResult?.r2ModelUrl,
        triggerWords: [job.triggerWord],
        previewImages: trainingResult.trainingResult?.sampleImageUrls || [],
      });

      // Step 6: Terminate instance
      if (instanceId) {
        await this._terminateInstance(instanceId, jobId);
      }

      this.alertUser(job.ownerAccountId, 'success', `Training completed: ${job.modelName}`);

      result = {
        success: true,
        jobId,
        loraModelId: finalizationResult.loraModel?._id,
        modelRepoUrl: trainingResult.trainingResult?.hfModelUrl,
      };

    } catch (err) {
      this.logger.error(`[JobProcessor] Unexpected error processing job ${jobId}:`, err);
      await this.trainingDb.markFailed(jobId, `Unexpected error: ${err.message}`);
      this.alertOps('CRITICAL: Job processing error', { jobId, error: err.message });

      // Attempt cleanup
      if (instanceId) {
        await this._terminateInstance(instanceId, jobId);
      }

      // Full refund on unexpected errors (no GPU time should be charged)
      if (chargedPoints > 0) {
        try {
          await this.pointsService.addPoints({
            walletAddress: job.walletAddress,
            masterAccountId: job.ownerAccountId,
            points: chargedPoints,
            rewardType: 'TRAINING_REFUND',
            description: `Training refund: unexpected error (${job.modelName})`,
            relatedItems: {
              trainingId: jobId,
              modelName: job.modelName,
              reason: `Unexpected error: ${err.message}`,
            },
          });
          this.logger.info(`[JobProcessor] Emergency refund of ${chargedPoints} points to ${job.walletAddress}`);
        } catch (refundErr) {
          this.logger.error(`[JobProcessor] Emergency refund failed:`, refundErr);
          this.alertOps('CRITICAL: Emergency refund FAILED', {
            jobId,
            ownerAccountId: job.ownerAccountId,
            amount: chargedPoints,
            error: refundErr.message,
          });
        }
      }

      result = { success: false, jobId, error: err.message };
    }

    return result;
  }

  /**
   * Estimate cost and charge user upfront
   * @private
   */
  async _estimateAndCharge(job) {
    const jobId = job._id.toString();

    try {
      // Estimate cost
      const estimate = await this.costEstimator.estimate({
        baseModel: job.baseModel,
        steps: job.steps,
        imageCount: job.datasetImageCount || 20,
        gpuClass: '24GB', // Default for now
      });

      this.logger.debug(`[JobProcessor] Cost estimate for ${jobId}: ${estimate.estimatedPoints} points`);

      // Check balance and charge
      const deductionResult = await this.pointsService.deductPointsForTraining({
        walletAddress: job.walletAddress,
        pointsToDeduct: estimate.estimatedPoints,
        metadata: {
          source: 'training_prepaid',
          trainingId: jobId,
          modelName: job.modelName,
        },
      });

      // Record estimated cost
      await this.trainingDb.setEstimatedCost(jobId, estimate.estimatedPoints);

      this.logger.debug(`[JobProcessor] Charged ${estimate.estimatedPoints} points upfront for ${jobId}`);

      return {
        success: true,
        estimatedPoints: estimate.estimatedPoints,
        estimate,
        deductionResult,
      };

    } catch (err) {
      this.logger.error(`[JobProcessor] Failed to charge for job ${jobId}:`, err);
      return {
        success: false,
        error: err.message.includes('Insufficient') ? 'Insufficient balance' : err.message,
      };
    }
  }

  /**
   * Execute training via launch-training.js child process
   *
   * Parallelizes dataset download with VastAI provisioning:
   * 1. Create temp directory immediately
   * 2. Start download AND spawn launch-training.js in parallel
   * 3. launch-training.js provisions VastAI, waits for .ready marker before upload
   * 4. When DATASET_UPLOADED marker seen, clean up temp immediately
   * 5. Training continues (local temp already cleaned)
   *
   * @private
   */
  async _executeTraining(job) {
    const jobId = job._id.toString();
    const baseDir = '/tmp/training';
    const datasetDir = path.join(baseDir, jobId, 'dataset');

    // Create directory structure immediately (download will populate it)
    const fsp = require('fs').promises;
    await fsp.mkdir(datasetDir, { recursive: true });

    this.logger.debug(`[JobProcessor] Starting parallel: download dataset + provision VastAI`);
    await this.trainingDb.setStatus(jobId, 'PROVISIONING');

    // Start download in background (will write .ready marker when done)
    // For KONTEXT concept mode, control images will be downloaded from embellishments
    const downloadOptions = {};
    if (job.controlSetId) {
      // If a specific control set (embellishment) ID was specified, use it
      downloadOptions.controlSetId = job.controlSetId;
    }
    const downloadPromise = this.datasetDownloader.download(
      job.datasetId.toString(),
      jobId,
      downloadOptions
    ).then(result => {
      this.logger.debug(`[JobProcessor] Dataset download complete: ${result.imageCount} images, ${result.captionCount} captions, hasControlImages: ${result.hasControlImages}`);
      return result;
    }).catch(err => {
      this.logger.error(`[JobProcessor] Dataset download failed: ${err.message}`);
      throw err;
    });

    // Run training - launch-training.js will wait for .ready marker before uploading
    const self = this;

    // Pre-compute control directory path for KONTEXT concept mode
    // The actual download will create this directory if control images exist
    const controlDir = path.join(baseDir, jobId, 'control');

    return new Promise((resolve) => {
      // Build command arguments
      const args = [
        this.launchTrainingScript,
        '--datasetDir', datasetDir,
        '--trigger', job.triggerWord,
        '--modelName', job.modelName,
        '--steps', job.steps.toString(),
        '--hfUpload', // Default to HuggingFace
      ];

      // Add optional description if user provided one
      if (job.description && job.description.trim()) {
        args.push('--description', job.description.trim());
      }

      // Always pass baseModel for correct checkpoint tagging
      const baseModel = job.baseModel || 'FLUX';
      args.push('--baseModel', baseModel);

      // Add KONTEXT-specific arguments for concept mode
      if (baseModel === 'KONTEXT') {
        if (job.trainingMode) {
          args.push('--trainingMode', job.trainingMode);

          // For concept mode, pass control dir path - script will check if it exists
          if (job.trainingMode === 'concept') {
            args.push('--controlDir', controlDir);
            this.logger.debug(`[JobProcessor] KONTEXT concept mode: control dir will be ${controlDir}`);
          }
        }
      }

      this.logger.debug(`[JobProcessor] Spawning: node ${args.join(' ')}`);

      const child = spawn('node', args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let cancelledByPoller = false;
      const stopCancelPoller = this._startCancelPoller(
        jobId, child,
        () => { cancelledByPoller = true; }
      );

      let cleanedUp = false;
      const cleanup = () => {
        if (!cleanedUp && datasetDir) {
          cleanedUp = true;
          self.datasetDownloader.cleanup(datasetDir).catch(() => {});
        }
      };

      // If download fails, kill the child process
      downloadPromise.catch(err => {
        this.logger.error(`[JobProcessor] Download failed, killing training process`);
        stopCancelPoller();
        child.kill('SIGTERM');
        cleanup();
        resolve({
          success: false,
          instanceId: null,
          error: `Failed to download dataset: ${err.message}`,
        });
      });

      let stdout = '';
      let stderr = '';
      let instanceId = null;
      let lastProgress = 0;
      const milestonesNotified = new Set();

      const parser = new TrainingOutputParser();
      const stallDetector = new StallDetector({ logger: this.logger });

      // Parse stdout for progress
      child.stdout.on('data', async (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Log raw output for visibility (strip trailing newlines for cleaner logs)
        const trimmed = chunk.trimEnd();
        if (trimmed) {
          trimmed.split('\n').forEach(line => {
            if (line.trim()) process.stdout.write(`[TRAIN] ${line}\n`);
          });
        }

        // Extract instance ID when provisioned (multiple patterns)
        // Pattern 1: "Successfully rented offer X, instance Y"
        // Pattern 2: "Instance Y status=running"
        // Always check — provision retries may produce a new instance ID.
        {
          const rentedMatch = chunk.match(/Successfully rented offer \d+, instance (\d+)/);
          const statusMatch = chunk.match(/Instance (\d+) status=/);
          const foundId = rentedMatch?.[1] || statusMatch?.[1];

          if (foundId && foundId !== instanceId) {
            if (instanceId) {
              this.logger.debug(`[JobProcessor] Instance ID changed: ${instanceId} -> ${foundId} (provision retry)`);
            }
            instanceId = foundId;
            this.logger.debug(`[JobProcessor] Detected instance ID: ${instanceId}`);

            // Extract GPU info if available (GPU: RTX 4090 | ... | Price: $0.XX/hr)
            const gpuMatch = chunk.match(/GPU:\s*([^|]+)\s*\|.*?Price:\s*\$([0-9.]+)\/hr/);
            const gpuType = gpuMatch?.[1]?.trim();
            const gpuHourlyRate = gpuMatch?.[2] ? parseFloat(gpuMatch[2]) : null;

            await this.trainingDb.setInstanceInfo(jobId, {
              vastaiInstanceId: instanceId,
              gpuType: gpuType || null,
              gpuHourlyRate: gpuHourlyRate || null,
            });
          }
        }

        // Transition to RUNNING when instance is ready and SSH verified
        if (chunk.includes('Instance ready at') || chunk.includes('SSH auth verified')) {
          if (instanceId) {
            await this.trainingDb.setStatusUnlessCancelled(jobId, 'RUNNING');
          }
        }

        // Clean up local temp directory as soon as upload to remote is complete
        if (chunk.includes('DATASET_UPLOADED')) {
          this.logger.debug(`[JobProcessor] Dataset uploaded to remote, cleaning up local temp`);
          cleanup();
        }

        // Parse training progress (wrapped in try-catch to prevent crashes)
        try {
          const parsed = parser.parse(chunk);
          // Only accept progress if totalSteps is plausibly the configured training steps.
          // During model loading, tqdm bars have tiny totals (2, 21, etc.)
          // Training steps are typically 500+, so require totalSteps >= 50% of job.steps
          const minExpectedSteps = Math.floor(job.steps * 0.5);
          if (parsed.lastStep && parsed.totalSteps && parsed.totalSteps >= minExpectedSteps) {
            const progress = Math.round((parsed.lastStep / parsed.totalSteps) * 100);

            // Update DB
            await this.trainingDb.updateProgress(jobId, {
              currentStep: parsed.lastStep,
              totalSteps: parsed.totalSteps,
              loss: parsed.lastLoss,
              progress,
            });

            // Feed stall detector
            try {
              stallDetector.recordSample({
                step: parsed.lastStep,
                totalSteps: parsed.totalSteps,
                eta: parsed.estimatedTimeRemaining,
              });
            } catch (stallErr) {
              this.logger.warn(`[JobProcessor] Stall detector error (non-fatal):`, stallErr.message);
            }

            // Notify on milestones
            for (const milestone of PROGRESS_MILESTONES) {
              if (progress >= milestone && lastProgress < milestone && !milestonesNotified.has(milestone)) {
                milestonesNotified.add(milestone);
                this.alertUser(job.ownerAccountId, 'info', `Training ${milestone}% complete: ${job.modelName}`);
              }
            }
            lastProgress = progress;
          }
        } catch (parseErr) {
          this.logger.warn(`[JobProcessor] Progress parse error (non-fatal):`, parseErr.message);
        }
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;

        // Log stderr for visibility
        const trimmed = chunk.trimEnd();
        if (trimmed) {
          trimmed.split('\n').forEach(line => {
            if (line.trim()) process.stderr.write(`[TRAIN:ERR] ${line}\n`);
          });
        }
      });

      child.on('close', (code) => {
        this.logger.debug(`[JobProcessor] launch-training.js exited with code ${code}`);
        stopCancelPoller();
        cleanup();
        if (cancelledByPoller) {
          resolve({ success: false, cancelled: true, instanceId });
          return;
        }

        if (code === 0) {
          // Parse the training result JSON
          const trainingResult = TrainingFinalizationService.parseTrainingResult(stdout);

          if (trainingResult && trainingResult.success) {
            resolve({
              success: true,
              instanceId,
              trainingResult,
            });
          } else {
            resolve({
              success: false,
              instanceId,
              error: 'Training completed but result parsing failed',
              stdout,
              stderr,
            });
          }
        } else {
          resolve({
            success: false,
            instanceId,
            error: `Training script exited with code ${code}`,
            stdout,
            stderr,
          });
        }
      });

      child.on('error', (err) => {
        this.logger.error(`[JobProcessor] Failed to spawn training script:`, err);
        cleanup();
        resolve({
          success: false,
          instanceId,
          error: `Failed to spawn training: ${err.message}`,
        });
      });
    });
  }

  /**
   * Reconcile actual cost with prepaid amount
   * @private
   */
  async _reconcileCost(job, estimatedPoints, actualDurationHours, gpuRate) {
    const jobId = job._id.toString();

    try {
      gpuRate = gpuRate || job.gpuHourlyRate || 0.35;
      const actualCost = this.costEstimator.calculateActualCost(actualDurationHours, gpuRate);
      const reconciliation = this.costEstimator.reconcile(estimatedPoints, actualCost.actualPoints);

      await this.trainingDb.reconcileCost(jobId, actualCost.actualPoints);

      if (reconciliation.action === 'refund' && reconciliation.amount > 0) {
        this.logger.debug(`[JobProcessor] Refunding ${reconciliation.amount} points for job ${jobId}`);

        try {
          await this.pointsService.addPoints({
            walletAddress: job.walletAddress,
            masterAccountId: job.ownerAccountId,
            points: reconciliation.amount,
            rewardType: 'TRAINING_REFUND',
            description: `Training refund: job ${reconciliation.action} (${job.modelName})`,
            relatedItems: {
              trainingId: jobId,
              modelName: job.modelName,
              estimated: estimatedPoints,
              actual: actualCost.actualPoints,
              reason: 'Job failed or completed early',
            },
          });
          this.logger.debug(`[JobProcessor] Refunded ${reconciliation.amount} points to ${job.walletAddress}`);
        } catch (refundErr) {
          this.logger.error(`[JobProcessor] Refund failed for ${jobId}:`, refundErr);
          // Alert ops for manual processing if auto-refund fails
          this.alertOps('Refund FAILED - manual action needed', {
            jobId,
            ownerAccountId: job.ownerAccountId,
            walletAddress: job.walletAddress,
            amount: reconciliation.amount,
            estimated: estimatedPoints,
            actual: actualCost.actualPoints,
            error: refundErr.message,
          });
        }
      } else if (reconciliation.action === 'overage') {
        this.logger.warn(`[JobProcessor] Overage of ${reconciliation.amount} points for job ${jobId}`);
        this.alertOps('Training overage (do not auto-charge)', {
          jobId,
          walletAddress: job.walletAddress,
          amount: reconciliation.amount,
          estimated: estimatedPoints,
          actual: actualCost.actualPoints,
        });
      }

      return reconciliation;

    } catch (err) {
      this.logger.error(`[JobProcessor] Cost reconciliation failed for ${jobId}:`, err);
      this.alertOps('Cost reconciliation failed', { jobId, error: err.message });
      return null;
    }
  }

  /**
   * Terminate VastAI instance with retry
   * @private
   */
  async _terminateInstance(instanceId, jobId) {
    const maxAttempts = 5;
    const backoff = [5, 15, 30, 60, 120];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.debug(`[JobProcessor] Terminating instance ${instanceId} (attempt ${attempt})`);
        await this.vastaiService.terminateInstance(instanceId);
        await this.trainingDb.markInstanceTerminated(jobId, attempt);
        this.logger.debug(`[JobProcessor] Instance ${instanceId} terminated successfully`);
        return true;

      } catch (err) {
        // 404 means instance already terminated - treat as success
        if (err.message?.includes('not found') || err.status === 404) {
          this.logger.debug(`[JobProcessor] Instance ${instanceId} already terminated (404)`);
          await this.trainingDb.markInstanceTerminated(jobId, attempt);
          return true;
        }

        this.logger.error(`[JobProcessor] Termination attempt ${attempt} failed: ${err.message}`);
        await this.trainingDb.incrementTerminationAttempts(jobId);

        if (attempt === maxAttempts) {
          this.alertOps('CRITICAL: Instance termination failed', {
            instanceId,
            jobId,
            attempts: maxAttempts,
            error: err.message,
          });
          return false;
        }

        await this._wait(backoff[attempt - 1] * 1000);
      }
    }

    return false;
  }

  /**
   * Issue a cancellation refund with a 10% penalty.
   * @private
   */
  async _refundCancelled(job, chargedPoints) {
    if (!chargedPoints || chargedPoints <= 0) return;
    const jobId = job._id.toString();
    const penalty = Math.round(chargedPoints * 0.10);
    const refundPoints = chargedPoints - penalty;
    if (refundPoints <= 0) return;
    try {
      await this.pointsService.addPoints({
        walletAddress: job.walletAddress,
        masterAccountId: job.ownerAccountId,
        points: refundPoints,
        rewardType: 'TRAINING_REFUND_CANCELLED',
        description: `Cancellation refund (10% penalty): ${job.modelName}`,
        relatedItems: {
          trainingId: jobId,
          modelName: job.modelName,
          chargedPoints,
          penalty,
          refundPoints,
        },
      });
      await this.trainingDb.reconcileCost(jobId, penalty);
      this.logger.info(
        `[JobProcessor] Cancellation: refunded ${refundPoints} pts, kept ${penalty} pts penalty (${jobId})`
      );
    } catch (refundErr) {
      this.logger.error(`[JobProcessor] Cancellation refund FAILED:`, refundErr);
      this.alertOps('Cancellation refund FAILED — manual action needed', {
        jobId,
        ownerAccountId: job.ownerAccountId,
        walletAddress: job.walletAddress,
        refundPoints,
        penalty,
        error: refundErr.message,
      });
    }
  }

  /**
   * Check if a job has been cancelled
   * @private
   */
  async _isCancelled(jobId) {
    const job = await this.trainingDb.findTrainingById(jobId);
    return job?.status === 'CANCELLED';
  }

  /**
   * Poll DB every intervalMs; kill child and invoke onCancelled when CANCELLED detected.
   * Returns a stop-cleanup function.
   * @private
   */
  _startCancelPoller(jobId, child, onCancelled, intervalMs = 20000) {
    const timer = setInterval(async () => {
      try {
        if (await this._isCancelled(jobId)) {
          this.logger.info(`[JobProcessor] Job ${jobId} cancelled — killing child process`);
          clearInterval(timer);
          onCancelled();
          child.kill('SIGTERM');
        }
      } catch (err) {
        this.logger.warn(`[JobProcessor] Cancel poll error (non-fatal): ${err.message}`);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }

  /**
   * Wait helper
   * @private
   */
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TrainingJobProcessor;
