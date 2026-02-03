const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class ServiceJobDB
 *
 * Tracks lifecycle of GPU service requests (inference, workflows, etc.).
 * Distinct from TrainingDB - this handles general-purpose GPU tasks.
 * Consumed by workers which poll for `status: QUEUED` jobs.
 *
 * SCHEMA:
 * {
 *   _id: ObjectId,
 *   requestType: string,           // 'comfy-workflow', 'lora-inference', 'custom-script'
 *   instanceType: string,          // 'comfy-worker', 'custom-runner'
 *   userId: string,
 *   walletAddress: string,
 *   inputs: Object,
 *   outputs: Object,
 *   status: 'QUEUED'|'CLAIMED'|'EXECUTING'|'UPLOADING'|'COMPLETED'|'FAILED',
 *   failureReason?: string,
 *   assignedInstanceId?: string,
 *   createdAt: Date,
 *   updatedAt: Date,
 *   claimedAt?: Date,
 *   startedAt?: Date,
 *   completedAt?: Date,
 *   estimatedCostUsd?: number,
 *   actualGpuSeconds?: number,
 *   actualCostUsd?: number,
 *   billingReconciled?: boolean,
 *   requiredModel?: string,        // for scheduling affinity
 *   requiredLora?: string,
 * }
 */
class ServiceJobDB extends BaseDB {
  constructor(logger) {
    super('serviceJobs');
    this.logger = logger || console;
  }

  /**
   * Queue a new job for processing
   * @param {Object} data - Job data
   * @returns {Object} - Created job with _id
   */
  async queueJob(data) {
    const now = new Date();
    const payload = {
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      inputs: {},
      outputs: {},
      ...data,
    };
    try {
      const result = await this.insertOne(payload);
      return result.insertedId ? { _id: result.insertedId, ...payload } : null;
    } catch (err) {
      this.logger.error('[ServiceJobDB] queueJob error', err);
      throw err;
    }
  }

  /**
   * Fetch the next queued job for a given instance type
   * @param {string} instanceType - Type of worker instance
   * @returns {Object|null} - Next queued job or null
   */
  async fetchNextQueued(instanceType) {
    try {
      const filter = { status: 'QUEUED' };
      if (instanceType) {
        filter.instanceType = instanceType;
      }
      const jobs = await this.findMany(filter, { limit: 1, sort: { createdAt: 1 } });
      return jobs.length > 0 ? jobs[0] : null;
    } catch (err) {
      this.logger.error('[ServiceJobDB] fetchNextQueued error', err);
      throw err;
    }
  }

  /**
   * Fetch queued jobs that require a specific model (for affinity scheduling)
   * @param {string} requiredModel - Model identifier
   * @param {number} limit - Maximum jobs to return
   * @returns {Array} - Queued jobs requiring the model
   */
  async fetchQueuedByModel(requiredModel, limit = 10) {
    try {
      return this.findMany(
        { status: 'QUEUED', requiredModel },
        { limit, sort: { createdAt: 1 } }
      );
    } catch (err) {
      this.logger.error('[ServiceJobDB] fetchQueuedByModel error', err);
      throw err;
    }
  }

  /**
   * Atomically claim a job for processing (prevents race conditions)
   * @param {ObjectId|string} jobId - Job to claim
   * @param {string} instanceId - ID of the instance claiming the job
   * @returns {Object|null} - Updated job if claimed, null if already claimed
   */
  async claimJob(jobId, instanceId) {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(jobId), status: 'QUEUED' },
        {
          $set: {
            status: 'CLAIMED',
            assignedInstanceId: instanceId,
            claimedAt: new Date(),
            updatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );
      return result;
    } catch (err) {
      this.logger.error('[ServiceJobDB] claimJob error', err);
      throw err;
    }
  }

  /**
   * Set job status with optional extra fields
   * @param {ObjectId|string} jobId - Job ID
   * @param {string} status - New status
   * @param {Object} extra - Additional fields to update
   * @returns {Object} - Update result
   */
  async setStatus(jobId, status, extra = {}) {
    try {
      const patch = { status, updatedAt: new Date(), ...extra };
      return this.updateOne({ _id: new ObjectId(jobId) }, { $set: patch });
    } catch (err) {
      this.logger.error('[ServiceJobDB] setStatus error', err);
      throw err;
    }
  }

  /**
   * Mark job as executing (started actual work)
   * @param {ObjectId|string} jobId - Job ID
   * @returns {Object} - Update result
   */
  async markExecuting(jobId) {
    try {
      return this.updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'EXECUTING',
            startedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
    } catch (err) {
      this.logger.error('[ServiceJobDB] markExecuting error', err);
      throw err;
    }
  }

  /**
   * Mark job as completed with outputs and GPU usage
   * @param {ObjectId|string} jobId - Job ID
   * @param {Object} outputs - Job outputs/results
   * @param {number} gpuSeconds - Actual GPU seconds used
   * @returns {Object} - Update result
   */
  async markCompleted(jobId, outputs = {}, gpuSeconds = null) {
    try {
      const update = {
        status: 'COMPLETED',
        outputs,
        completedAt: new Date(),
        updatedAt: new Date()
      };
      if (gpuSeconds !== null) {
        update.actualGpuSeconds = gpuSeconds;
      }
      return this.updateOne({ _id: new ObjectId(jobId) }, { $set: update });
    } catch (err) {
      this.logger.error('[ServiceJobDB] markCompleted error', err);
      throw err;
    }
  }

  /**
   * Mark job as failed
   * @param {ObjectId|string} jobId - Job ID
   * @param {string} reason - Failure reason
   * @returns {Object} - Update result
   */
  async markFailed(jobId, reason) {
    try {
      return this.updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            status: 'FAILED',
            failureReason: reason,
            completedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
    } catch (err) {
      this.logger.error('[ServiceJobDB] markFailed error', err);
      throw err;
    }
  }

  /**
   * Delete a job by ID
   * @param {ObjectId|string} jobId - Job ID
   * @returns {boolean} - True if deleted
   */
  async deleteJob(jobId) {
    try {
      const result = await this.deleteOne({ _id: new ObjectId(jobId) });
      return result.deletedCount > 0;
    } catch (err) {
      this.logger.error('[ServiceJobDB] deleteJob error', err);
      throw err;
    }
  }

  /**
   * Find all jobs assigned to a specific instance
   * @param {string} instanceId - Instance ID
   * @returns {Array} - Jobs assigned to the instance
   */
  async findJobsByInstance(instanceId) {
    try {
      return this.findMany(
        { assignedInstanceId: instanceId },
        { sort: { createdAt: -1 } }
      );
    } catch (err) {
      this.logger.error('[ServiceJobDB] findJobsByInstance error', err);
      throw err;
    }
  }

  /**
   * Find a job by ID
   * @param {ObjectId|string} jobId - Job ID
   * @returns {Object|null} - Job or null
   */
  async findJobById(jobId) {
    try {
      return this.findOne({ _id: new ObjectId(jobId) });
    } catch (err) {
      this.logger.error('[ServiceJobDB] findJobById error', err);
      throw err;
    }
  }

  /**
   * Find jobs by user ID with optional filtering
   * @param {string} userId - User ID
   * @param {Object} options - Query options (status, limit, skip, sort)
   * @returns {Array} - User's jobs
   */
  async findJobsByUser(userId, options = {}) {
    try {
      const filter = { userId };
      if (options.status) {
        filter.status = options.status;
      }
      const queryOptions = {
        sort: options.sort || { createdAt: -1 },
        limit: options.limit,
        skip: options.skip
      };
      return this.findMany(filter, queryOptions);
    } catch (err) {
      this.logger.error('[ServiceJobDB] findJobsByUser error', err);
      throw err;
    }
  }

  /**
   * Get the number of queued jobs for an instance type
   * @param {string} instanceType - Type of worker instance
   * @returns {number} - Count of queued jobs
   */
  async getQueueDepth(instanceType) {
    try {
      const filter = { status: 'QUEUED' };
      if (instanceType) {
        filter.instanceType = instanceType;
      }
      return this.count(filter);
    } catch (err) {
      this.logger.error('[ServiceJobDB] getQueueDepth error', err);
      throw err;
    }
  }

  /**
   * Aggregate queued jobs by required model (for affinity scheduling decisions)
   * @returns {Array} - Array of { _id: requiredModel, count: number, oldestCreatedAt: Date }
   */
  async getQueuedByModelAffinity() {
    try {
      const pipeline = [
        { $match: { status: 'QUEUED', requiredModel: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$requiredModel',
            count: { $sum: 1 },
            oldestCreatedAt: { $min: '$createdAt' }
          }
        },
        { $sort: { count: -1 } }
      ];
      return this.aggregate(pipeline);
    } catch (err) {
      this.logger.error('[ServiceJobDB] getQueuedByModelAffinity error', err);
      throw err;
    }
  }

  /**
   * Set billing reconciliation after cost calculation
   * @param {ObjectId|string} jobId - Job ID
   * @param {number} actualCostUsd - Actual cost in USD
   * @returns {Object} - Update result
   */
  async reconcileBilling(jobId, actualCostUsd) {
    try {
      return this.updateOne(
        { _id: new ObjectId(jobId) },
        {
          $set: {
            actualCostUsd,
            billingReconciled: true,
            updatedAt: new Date()
          }
        }
      );
    } catch (err) {
      this.logger.error('[ServiceJobDB] reconcileBilling error', err);
      throw err;
    }
  }

  /**
   * Find stuck jobs (in active states with no update in specified duration)
   * @param {number} staleThresholdMs - Milliseconds since last update to consider stuck
   * @returns {Array} - Stuck jobs
   */
  async findStuckJobs(staleThresholdMs = 30 * 60 * 1000) {
    try {
      return this.findMany({
        status: { $in: ['CLAIMED', 'EXECUTING', 'UPLOADING'] },
        updatedAt: { $lt: new Date(Date.now() - staleThresholdMs) }
      });
    } catch (err) {
      this.logger.error('[ServiceJobDB] findStuckJobs error', err);
      throw err;
    }
  }

  /**
   * Find jobs needing billing reconciliation
   * @returns {Array} - Jobs with completed status but not reconciled
   */
  async findUnreconciledJobs() {
    try {
      return this.findMany({
        status: 'COMPLETED',
        billingReconciled: { $ne: true }
      });
    } catch (err) {
      this.logger.error('[ServiceJobDB] findUnreconciledJobs error', err);
      throw err;
    }
  }
}

module.exports = ServiceJobDB;
