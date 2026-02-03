/**
 * GPUScheduler - Queue Management & Model-Affinity Routing
 *
 * The "brain" that decides which jobs run where. Handles:
 *   - Routing requests to available GPU instances
 *   - Reordering queue by model affinity to minimize model swaps
 *   - Deciding when to spin up new instances based on queue depth
 *   - Tracking scheduling metrics
 *
 * Model affinity clustering improves throughput by keeping similar jobs
 * together - all flux-schnell jobs run on one instance while sdxl jobs
 * run on another, avoiding expensive model loading between each job.
 *
 * @see src/config/vastaiService.js for configuration values
 */
const { getServiceConfig } = require('../../../config/vastaiService');

// Instance type routing: maps request types to worker types
const REQUEST_TYPE_TO_INSTANCE = {
  'comfy-workflow': 'comfy-worker',
  'lora-inference': 'comfy-worker',
  'image-gen': 'comfy-worker'
  // Everything else defaults to 'custom-runner'
};

class GPUScheduler {
  /**
   * @param {object} options
   * @param {object} options.logger - Logger instance
   * @param {object} options.serviceJobDb - ServiceJobDB instance for queue access
   * @param {object} options.warmPoolManager - WarmPoolManager for instance tracking
   * @param {object} [options.config] - Optional config overrides
   */
  constructor({ logger, serviceJobDb, warmPoolManager, config = {} }) {
    if (!logger) {
      throw new Error('GPUScheduler requires a logger');
    }
    if (!serviceJobDb) {
      throw new Error('GPUScheduler requires a serviceJobDb');
    }
    if (!warmPoolManager) {
      throw new Error('GPUScheduler requires a warmPoolManager');
    }

    this.logger = logger;
    this.serviceJobDb = serviceJobDb;
    this.warmPoolManager = warmPoolManager;
    this.config = getServiceConfig(config);

    // Scheduling metrics
    this.metrics = {
      scheduledCount: 0,
      affinityHits: 0,
      affinityMisses: 0,
      spinupRequests: 0,
      lastScheduleTime: null
    };
  }

  /**
   * Main scheduling method - find the next job to process.
   *
   * Algorithm:
   * 1. Get queue state grouped by model affinity
   * 2. For each instance type, check for available instances
   * 3. If instance available, find best job (prefer jobs matching loaded model)
   * 4. If no instance, check if we should spin up a new one
   *
   * @returns {Promise<object|null>} { job, instance, needsProvisioning } or null
   */
  async scheduleNext() {
    try {
      // Get all queued jobs grouped by model
      const modelGroups = await this.serviceJobDb.getQueuedByModelAffinity();

      if (!modelGroups || modelGroups.length === 0) {
        // Check for jobs without model affinity
        const anyJob = await this.serviceJobDb.fetchNextQueued();
        if (!anyJob) {
          return null;
        }

        // Have a job but no model affinity data - try to schedule it
        const instanceType = this._getInstanceTypeForJob(anyJob);
        const instance = this.warmPoolManager.getAvailableInstance(instanceType);

        if (instance) {
          this.metrics.scheduledCount++;
          this.metrics.lastScheduleTime = Date.now();
          return { job: anyJob, instance, needsProvisioning: false };
        }

        // Check if we should spin up
        if (await this._shouldSpinupInstance(instanceType)) {
          this.metrics.spinupRequests++;
          return { job: anyJob, instance: null, needsProvisioning: true };
        }

        return null;
      }

      // Get all queued jobs for reordering
      const allQueuedJobs = [];
      for (const group of modelGroups) {
        const jobs = await this.serviceJobDb.fetchQueuedByModel(group._id, 100);
        allQueuedJobs.push(...jobs);
      }

      // Also get jobs without a required model
      const jobsWithoutModel = await this._fetchJobsWithoutModel();
      allQueuedJobs.push(...jobsWithoutModel);

      if (allQueuedJobs.length === 0) {
        return null;
      }

      // Try to find an available instance and match it with a job
      const instanceTypes = ['comfy-worker', 'custom-runner'];

      for (const instanceType of instanceTypes) {
        const instance = this.warmPoolManager.getAvailableInstance(instanceType);

        if (instance) {
          // Reorder jobs with model affinity, prioritizing the loaded model
          const loadedModel = instance.loadedModel || null;
          const reorderedJobs = this.reorderByModelAffinity(allQueuedJobs, loadedModel);

          // Find best job for this instance
          const job = this._findBestJobForInstance(instance, reorderedJobs);

          if (job) {
            if (loadedModel && job.requiredModel === loadedModel) {
              this.metrics.affinityHits++;
            } else if (loadedModel && job.requiredModel && job.requiredModel !== loadedModel) {
              this.metrics.affinityMisses++;
            }

            this.metrics.scheduledCount++;
            this.metrics.lastScheduleTime = Date.now();
            return { job, instance, needsProvisioning: false };
          }
        }
      }

      // No available instance - check if we should spin up
      const firstJob = allQueuedJobs[0];
      const instanceType = this._getInstanceTypeForJob(firstJob);

      if (await this._shouldSpinupInstance(instanceType)) {
        this.metrics.spinupRequests++;
        return { job: firstJob, instance: null, needsProvisioning: true };
      }

      return null;
    } catch (error) {
      this.logger.error(`[GPUScheduler] scheduleNext error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reorder jobs by model affinity to minimize model swaps.
   *
   * Strategy:
   * 1. Group jobs by requiredModel
   * 2. Sort each group by createdAt (FIFO within group)
   * 3. Put currentLoadedModel group first if known
   * 4. Sort remaining groups by size (largest first - most efficient)
   *
   * @param {Array} jobs - Jobs to reorder
   * @param {string|null} currentLoadedModel - Currently loaded model on instance
   * @returns {Array} Reordered jobs array
   */
  reorderByModelAffinity(jobs, currentLoadedModel = null) {
    if (!jobs || jobs.length === 0) {
      return [];
    }

    // Group jobs by requiredModel
    const groups = new Map();
    const noModelJobs = [];

    for (const job of jobs) {
      const model = job.requiredModel;
      if (!model) {
        noModelJobs.push(job);
        continue;
      }

      if (!groups.has(model)) {
        groups.set(model, []);
      }
      groups.get(model).push(job);
    }

    // Sort each group by createdAt (FIFO within group)
    for (const [, groupJobs] of groups) {
      groupJobs.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
    }

    // Build ordered groups array
    const orderedGroups = [];

    // Put currentLoadedModel first if it exists
    if (currentLoadedModel && groups.has(currentLoadedModel)) {
      orderedGroups.push({
        model: currentLoadedModel,
        jobs: groups.get(currentLoadedModel)
      });
      groups.delete(currentLoadedModel);
    }

    // Sort remaining groups by size (largest first)
    const remainingGroups = Array.from(groups.entries())
      .map(([model, groupJobs]) => ({ model, jobs: groupJobs }))
      .sort((a, b) => b.jobs.length - a.jobs.length);

    orderedGroups.push(...remainingGroups);

    // Flatten to single array
    const result = [];
    for (const group of orderedGroups) {
      result.push(...group.jobs);
    }

    // Add jobs without model requirement at the end
    noModelJobs.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTime - bTime;
    });
    result.push(...noModelJobs);

    return result;
  }

  /**
   * Claim a job for processing on an instance.
   *
   * @param {string} jobId - Job ID to claim
   * @param {string} instanceId - Instance ID claiming the job
   * @returns {Promise<object|null>} Claimed job or null if claim failed
   */
  async claimJob(jobId, instanceId) {
    try {
      // Atomically claim the job
      const claimedJob = await this.serviceJobDb.claimJob(jobId, instanceId);

      if (!claimedJob) {
        this.logger.warn(`[GPUScheduler] Failed to claim job ${jobId} - already claimed or not found`);
        return null;
      }

      // Mark instance as busy
      const marked = this.warmPoolManager.markBusy(instanceId);
      if (!marked) {
        this.logger.warn(`[GPUScheduler] Failed to mark instance ${instanceId} as busy`);
        // Job is still claimed, continue anyway
      }

      this.logger.info(`[GPUScheduler] Job ${jobId} claimed by instance ${instanceId}`);
      return claimedJob;
    } catch (error) {
      this.logger.error(`[GPUScheduler] claimJob error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark a job as complete and return instance to idle pool.
   *
   * @param {string} jobId - Job ID that completed
   * @param {string} instanceId - Instance ID that processed the job
   * @param {string} requestType - Type of request (for warmth calculation)
   */
  async completeJob(jobId, instanceId, requestType) {
    try {
      // Mark instance as idle with warmth bonus for request type
      const marked = this.warmPoolManager.markIdle(instanceId, requestType);

      if (!marked) {
        this.logger.warn(`[GPUScheduler] Failed to mark instance ${instanceId} as idle`);
      }

      this.logger.info(`[GPUScheduler] Job ${jobId} completed on instance ${instanceId}`);
    } catch (error) {
      this.logger.error(`[GPUScheduler] completeJob error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get current scheduling metrics.
   *
   * @returns {object} Scheduling metrics
   */
  async getMetrics() {
    const queueDepth = await this.serviceJobDb.getQueueDepth();
    const poolState = this.warmPoolManager.getPoolState();

    return {
      queueDepth,
      poolState,
      spinupThreshold: this.config.spinupThreshold,
      maxInstances: this.config.maxInstances,
      scheduling: {
        scheduledCount: this.metrics.scheduledCount,
        affinityHits: this.metrics.affinityHits,
        affinityMisses: this.metrics.affinityMisses,
        affinityHitRate: this.metrics.scheduledCount > 0
          ? (this.metrics.affinityHits / this.metrics.scheduledCount * 100).toFixed(1) + '%'
          : 'N/A',
        spinupRequests: this.metrics.spinupRequests,
        lastScheduleTime: this.metrics.lastScheduleTime
      }
    };
  }

  // =====================
  // Private Methods
  // =====================

  /**
   * Find the best job for an instance based on model affinity.
   *
   * @param {object} instance - Instance data with optional loadedModel
   * @param {Array} jobs - Reordered jobs array
   * @returns {object|null} Best matching job or null
   * @private
   */
  _findBestJobForInstance(instance, jobs) {
    if (!jobs || jobs.length === 0) {
      return null;
    }

    const instanceType = instance.instanceType;

    // First try to find a job that matches the loaded model
    if (instance.loadedModel) {
      for (const job of jobs) {
        if (this._getInstanceTypeForJob(job) !== instanceType) {
          continue;
        }
        if (job.requiredModel === instance.loadedModel) {
          return job;
        }
      }
    }

    // Fall back to first job that matches instance type
    for (const job of jobs) {
      if (this._getInstanceTypeForJob(job) === instanceType) {
        return job;
      }
    }

    return null;
  }

  /**
   * Check if we should spin up a new instance.
   *
   * Conditions:
   * - Queue depth >= spinupThreshold
   * - Current instance count < maxInstances
   *
   * @param {string} instanceType - Type of instance to potentially spin up
   * @returns {Promise<boolean>} Whether to spin up a new instance
   * @private
   */
  async _shouldSpinupInstance(instanceType) {
    const queueDepth = await this.serviceJobDb.getQueueDepth(instanceType);
    const currentInstances = this.warmPoolManager.getInstanceCount();

    const shouldSpinup =
      queueDepth >= this.config.spinupThreshold &&
      currentInstances < this.config.maxInstances;

    if (shouldSpinup) {
      this.logger.info(
        `[GPUScheduler] Spinup recommended: queue depth ${queueDepth} >= threshold ${this.config.spinupThreshold}, ` +
        `instances ${currentInstances} < max ${this.config.maxInstances}`
      );
    }

    return shouldSpinup;
  }

  /**
   * Get the instance type required for a job based on its request type.
   *
   * @param {object} job - Job with requestType field
   * @returns {string} Instance type ('comfy-worker' or 'custom-runner')
   * @private
   */
  _getInstanceTypeForJob(job) {
    const requestType = job?.requestType;
    return REQUEST_TYPE_TO_INSTANCE[requestType] || 'custom-runner';
  }

  /**
   * Fetch jobs that don't have a requiredModel set.
   *
   * @returns {Promise<Array>} Jobs without model affinity
   * @private
   */
  async _fetchJobsWithoutModel() {
    try {
      // Use the general fetch method with no model filter
      // and filter client-side for jobs without requiredModel
      const job = await this.serviceJobDb.fetchNextQueued();
      if (job && !job.requiredModel) {
        return [job];
      }
      return [];
    } catch (error) {
      this.logger.error(`[GPUScheduler] _fetchJobsWithoutModel error: ${error.message}`);
      return [];
    }
  }
}

module.exports = GPUScheduler;
