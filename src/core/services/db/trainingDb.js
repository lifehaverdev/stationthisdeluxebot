const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class TrainingDB
 *
 * Tracks lifecycle of training jobs that convert a Dataset → Model.
 * Consumed by training worker which polls for `status: QUEUED` jobs.
 *
 * SCHEMA:
 * {
 *   _id: ObjectId,
 *   datasetId: ObjectId,
 *   ownerAccountId: ObjectId,
 *   walletAddress: string,              // For billing via credit ledger
 *   offeringId: string,                 // key from trainingOfferings config
 *   baseModel: string,                  // e.g. "FLUX", "SD1.5", "SDXL"
 *   modelName: string,                  // User-specified model name
 *   triggerWord: string,                // Trigger word for the LoRA
 *   steps: number,                      // Training steps requested
 *   datasetImageCount: number,          // Number of images in dataset
 *
 *   status: 'QUEUED'|'PROVISIONING'|'UPLOADING'|'TRAINING'|'FINALIZING'|'COMPLETED'|'FAILED',
 *   progress?: number,                  // 0-100
 *   currentStep?: number,               // Current training step
 *   totalSteps?: number,                // Total steps (may differ from requested)
 *   currentLoss?: number,               // Latest loss value
 *   failureReason?: string,
 *
 *   createdAt: Date,
 *   updatedAt: Date,
 *   startedAt?: Date,
 *   completedAt?: Date,
 *
 *   // Cost estimation & prepaid
 *   estimatedCostPoints?: number,       // Conservative estimate charged upfront
 *   actualCostPoints?: number,          // Reconciled after completion
 *   costReconciled?: boolean,           // Whether refund/charge happened
 *
 *   // GPU instance tracking (critical for cleanup)
 *   vastaiInstanceId?: string,          // For termination
 *   vastaiOfferId?: string,             // What we rented
 *   gpuType?: string,                   // "RTX 4090" etc
 *   gpuHourlyRate?: number,             // $/hr
 *
 *   // Timeout tracking
 *   softTimeoutAt?: Date,               // Expected completion
 *   hardTimeoutAt?: Date,               // Max affordable runtime
 *   softTimeoutAlerted?: boolean,       // Whether soft timeout alert sent
 *
 *   // For sweeper
 *   instanceTerminatedAt?: Date,        // Null until confirmed dead
 *   terminationAttempts?: number,       // Retry counter
 *
 *   // Output linkage
 *   loraModelId?: ObjectId,             // FK to LoRAModelDb
 *   modelRepoUrl?: string,              // hf repo
 *   triggerWords?: [string],
 *   previewImages?: [string]
 * }
 */
class TrainingDB extends BaseDB {
  constructor(logger) {
    super('trainingJobs');
    this.logger = logger || console;
  }

  /**
   * Return all training jobs owned by a given user / master account.
   * Compatible with internal API expectation: findTrainingsByUser(masterAccountId)
   * Handles both string and ObjectId storage formats for ownerAccountId/userId
   */
  async findTrainingsByUser(masterAccountId, options = {}) {
    try {
      // Query both string and ObjectId formats, plus userId field for compatibility
      const filter = {
        $or: [
          { ownerAccountId: masterAccountId },
          { userId: masterAccountId },
          { ownerAccountId: new ObjectId(masterAccountId) },
        ]
      };
      const trainings = await this.findMany(filter, options);
      // Sort by createdAt descending (newest first)
      return trainings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (err) {
      this.logger.error('[TrainingDB] findTrainingsByUser error', err);
      throw err;
    }
  }

  /**
   * Fetch single training by id
   */
  async findTrainingById(trainingId) {
    try {
      return this.findOne({ _id: new ObjectId(trainingId) });
    } catch (err) {
      this.logger.error('[TrainingDB] findTrainingById error', err);
      throw err;
    }
  }

  /**
   * Delete a training by id
   */
  async deleteTraining(trainingId) {
    try {
      const result = await this.deleteOne({ _id: new ObjectId(trainingId) });
      return result.deletedCount > 0;
    } catch (err) {
      this.logger.error('[TrainingDB] deleteTraining error', err);
      throw err;
    }
  }

  /**
   * createTrainingSession expected by internal API.
   * Convenience wrapper for queueJob with userId/masterAccountId fields.
   */
  async createTrainingSession(data) {
    return this.queueJob(data);
  }

  async queueJob(data) {
    const now = new Date();
    const payload = {
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      progress: 0,
      ...data,
    };
    const result = await this.insertOne(payload);
    return result.insertedId ? { _id: result.insertedId, ...payload } : null;
  }

  async setStatus(jobId, status, extra = {}) {
    const patch = { status, updatedAt: new Date(), ...extra };
    return this.updateOne({ _id: new ObjectId(jobId) }, { $set: patch });
  }

  async incrementProgress(jobId, progress) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { progress, updatedAt: new Date() } }
    );
  }

  async attachModel(jobId, loraModelId, repoUrl) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { loraModelId: new ObjectId(loraModelId), modelRepoUrl: repoUrl, updatedAt: new Date() } }
    );
  }

  async fetchQueued(limit = 3, environment = null) {
    const filter = { status: 'QUEUED' };

    if (environment === 'development') {
      // Development worker: ONLY pick up explicitly tagged development jobs
      filter.environment = 'development';
    } else if (environment === 'production') {
      // Production worker: pick up production jobs OR jobs with no environment tag (default/legacy)
      filter.$or = [
        { environment: 'production' },
        { environment: { $exists: false } },
        { environment: null }
      ];
    }
    // If environment is null/undefined, no filter (pick up any - not recommended)

    const jobs = await this.findMany(filter, { limit, sort: { createdAt: 1 } });
    if (jobs.length > 0) {
      this.logger.debug(`[TrainingDB] fetchQueued found ${jobs.length} job(s) for env=${environment || 'any'}: ${jobs.map(j => j._id).join(', ')}`);
    }
    return jobs;
  }

  /**
   * Fetch next queued job (one at a time for worker)
   * @param {string} environment - Optional environment filter ('development' or 'production')
   */
  async fetchNextQueued(environment = null) {
    const jobs = await this.fetchQueued(1, environment);
    return jobs.length > 0 ? jobs[0] : null;
  }

  /**
   * Atomically claim a job for processing (prevents race conditions)
   * @param {ObjectId|string} jobId - Job to claim
   * @returns {Object|null} - Updated job if claimed, null if already claimed
   */
  async claimJob(jobId) {
    const collection = await this.getCollection();
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(jobId), status: 'QUEUED' },
      {
        $set: {
          status: 'PROVISIONING',
          startedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    return result;
  }

  /**
   * Update job with VastAI instance info (critical for cleanup)
   */
  async setInstanceInfo(jobId, instanceInfo) {
    const { vastaiInstanceId, vastaiOfferId, gpuType, gpuHourlyRate } = instanceInfo;
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          vastaiInstanceId,
          vastaiOfferId,
          gpuType,
          gpuHourlyRate,
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Set timeout timestamps after GPU is locked in
   */
  async setTimeouts(jobId, softTimeoutAt, hardTimeoutAt) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          softTimeoutAt,
          hardTimeoutAt,
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Update training progress
   */
  async updateProgress(jobId, { currentStep, totalSteps, loss, progress }) {
    const update = { updatedAt: new Date() };
    if (currentStep !== undefined) update.currentStep = currentStep;
    if (totalSteps !== undefined) update.totalSteps = totalSteps;
    if (loss !== undefined) update.currentLoss = loss;
    if (progress !== undefined) update.progress = progress;

    return this.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: update }
    );
  }

  /**
   * Mark soft timeout alert as sent
   */
  async markSoftTimeoutAlerted(jobId) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { softTimeoutAlerted: true, updatedAt: new Date() } }
    );
  }

  /**
   * Record estimated cost charged upfront
   */
  async setEstimatedCost(jobId, estimatedCostPoints) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { estimatedCostPoints, updatedAt: new Date() } }
    );
  }

  /**
   * Reconcile actual cost after training
   */
  async reconcileCost(jobId, actualCostPoints) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          actualCostPoints,
          costReconciled: true,
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Mark job as completed with final data
   */
  async markCompleted(jobId, completionData = {}) {
    const { loraModelId, modelRepoUrl, triggerWords, previewImages, actualCostPoints } = completionData;
    const update = {
      status: 'COMPLETED',
      completedAt: new Date(),
      updatedAt: new Date()
    };
    if (loraModelId) update.loraModelId = new ObjectId(loraModelId);
    if (modelRepoUrl) update.modelRepoUrl = modelRepoUrl;
    if (triggerWords) update.triggerWords = triggerWords;
    if (previewImages) update.previewImages = previewImages;
    if (actualCostPoints !== undefined) {
      update.actualCostPoints = actualCostPoints;
      update.costReconciled = true;
    }

    return this.updateOne(
      { _id: new ObjectId(jobId) },
      { $set: update }
    );
  }

  /**
   * Mark job as failed
   */
  async markFailed(jobId, failureReason, extra = {}) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          status: 'FAILED',
          failureReason,
          completedAt: new Date(),
          updatedAt: new Date(),
          ...extra
        }
      }
    );
  }

  /**
   * Record instance termination
   */
  async markInstanceTerminated(jobId, attempts = 1) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          instanceTerminatedAt: new Date(),
          terminationAttempts: attempts,
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Increment termination attempts (for retry tracking)
   */
  async incrementTerminationAttempts(jobId) {
    return this.updateOne(
      { _id: new ObjectId(jobId) },
      {
        $inc: { terminationAttempts: 1 },
        $set: { updatedAt: new Date() }
      }
    );
  }

  /**
   * Find orphan candidates for sweeper
   * Jobs that are done but instance not terminated
   */
  async findOrphanCandidates() {
    return this.findMany({
      vastaiInstanceId: { $exists: true, $ne: null },
      instanceTerminatedAt: null,
      status: { $in: ['COMPLETED', 'FAILED'] }
    });
  }

  /**
   * Find stuck jobs for sweeper
   * Jobs in active states with no update in specified duration
   */
  async findStuckJobs(staleThresholdMs = 2 * 60 * 60 * 1000) {
    return this.findMany({
      status: { $in: ['PROVISIONING', 'UPLOADING', 'TRAINING', 'FINALIZING'] },
      updatedAt: { $lt: new Date(Date.now() - staleThresholdMs) }
    });
  }

  /**
   * Get completed trainings for cost estimation data
   */
  async getCompletedTrainingsForEstimation(baseModel, limit = 50) {
    return this.findMany(
      {
        status: 'COMPLETED',
        baseModel,
        actualCostPoints: { $exists: true },
        gpuHourlyRate: { $exists: true }
      },
      {
        limit,
        sort: { completedAt: -1 },
        projection: {
          steps: 1,
          datasetImageCount: 1,
          gpuHourlyRate: 1,
          startedAt: 1,
          completedAt: 1,
          actualCostPoints: 1
        }
      }
    );
  }
}

module.exports = TrainingDB;
