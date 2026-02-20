/**
 * Mongo Service
 * 
 * Database operations for the training system using existing database services
 */

const { ObjectId } = require('../db/BaseDB');

class MongoService {
  constructor({ logger, db }) {
    this.logger = logger;
    this.db = db;
    
    // Initialize database collections (ensure keys match initializeDbServices)
    this.trainingDb = db.data.loraTrainings;
    this.datasetDb = db.data.dataset;
    this.loraModelDb = db.data.loraModels;
  }

  /**
   * Fetch queued training jobs
   * @param {number} limit - Maximum number of jobs to fetch
   * @returns {Promise<Array>} Array of queued jobs
   */
  async fetchQueuedJobs(limit = 3) {
    try {
      return await this.trainingDb.fetchQueued(limit);
    } catch (error) {
      this.logger.error('Failed to fetch queued jobs:', error);
      throw error;
    }
  }

  /**
   * Claim a job atomically to prevent race conditions
   * @param {string} jobId - Job ID to claim
   * @returns {Promise<boolean>} True if job was successfully claimed
   */
  async claimJob(jobId) {
    try {
      const result = await this.trainingDb.updateOne(
        { _id: new ObjectId(jobId), status: 'QUEUED' },
        { 
          $set: { 
            status: 'RUNNING',
            startedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
      
      return result.modifiedCount > 0;
    } catch (error) {
      this.logger.error(`Failed to claim job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Update job status
   * @param {string} jobId - Job ID
   * @param {string} status - New status
   * @param {Object} extra - Additional fields to update
   */
  async updateJobStatus(jobId, status, extra = {}) {
    try {
      const updateData = {
        status,
        updatedAt: new Date(),
        ...extra
      };
      
      await this.trainingDb.setStatus(jobId, status, extra);
      this.logger.debug(`Updated job ${jobId} status to ${status}`);
    } catch (error) {
      this.logger.error(`Failed to update job ${jobId} status:`, error);
      throw error;
    }
  }

  /**
   * Update job progress
   * @param {string} jobId - Job ID
   * @param {number} progress - Progress percentage (0-100)
   */
  async updateJobProgress(jobId, progress) {
    try {
      await this.trainingDb.incrementProgress(jobId, progress);
      this.logger.debug(`Updated job ${jobId} progress to ${progress}%`);
    } catch (error) {
      this.logger.error(`Failed to update job ${jobId} progress:`, error);
      throw error;
    }
  }

  /**
   * Get dataset by ID
   * @param {string} datasetId - Dataset ID
   * @returns {Promise<Object>} Dataset object
   */
  async getDataset(datasetId) {
    try {
      const dataset = await this.datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        throw new Error(`Dataset ${datasetId} not found`);
      }
      return dataset;
    } catch (error) {
      this.logger.error(`Failed to get dataset ${datasetId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new LoRA model record
   * @param {Object} modelData - Model data
   * @returns {Promise<Object>} Created model object
   */
  async createLoRAModel(modelData) {
    try {
      const model = await this.loraModelDb.createLoRAModel(modelData);
      this.logger.debug(`Created LoRA model: ${model.name} (${model.slug})`);
      return model;
    } catch (error) {
      this.logger.error('Failed to create LoRA model:', error);
      throw error;
    }
  }

  /**
   * Update LoRA model with training results
   * @param {string} modelId - Model ID
   * @param {Object} updateData - Data to update
   */
  async updateLoRAModel(modelId, updateData) {
    try {
      await this.loraModelDb.updateModel(modelId, updateData);
      this.logger.debug(`Updated LoRA model ${modelId}`);
    } catch (error) {
      this.logger.error(`Failed to update LoRA model ${modelId}:`, error);
      throw error;
    }
  }

  /**
   * Link training to dataset
   * @param {string} datasetId - Dataset ID
   * @param {string} trainingId - Training ID
   */
  async linkTrainingToDataset(datasetId, trainingId) {
    try {
      await this.datasetDb.linkTraining(datasetId, trainingId);
      this.logger.debug(`Linked training ${trainingId} to dataset ${datasetId}`);
    } catch (error) {
      this.logger.error(`Failed to link training to dataset:`, error);
      throw error;
    }
  }

  /**
   * Get training job by ID
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Training job object
   */
  async getTrainingJob(jobId) {
    try {
      const job = await this.trainingDb.findTrainingById(jobId);
      if (!job) {
        throw new Error(`Training job ${jobId} not found`);
      }
      return job;
    } catch (error) {
      this.logger.error(`Failed to get training job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get training jobs by user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of training jobs
   */
  async getTrainingJobsByUser(userId, options = {}) {
    try {
      return await this.trainingDb.findTrainingsByUser(userId, options);
    } catch (error) {
      this.logger.error(`Failed to get training jobs for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get LoRA model by ID
   * @param {string} modelId - Model ID
   * @returns {Promise<Object>} LoRA model object
   */
  async getLoRAModel(modelId) {
    try {
      const model = await this.loraModelDb.findById(modelId);
      if (!model) {
        throw new Error(`LoRA model ${modelId} not found`);
      }
      return model;
    } catch (error) {
      this.logger.error(`Failed to get LoRA model ${modelId}:`, error);
      throw error;
    }
  }

  /**
   * Get LoRA model by slug
   * @param {string} slug - Model slug
   * @returns {Promise<Object>} LoRA model object
   */
  async getLoRAModelBySlug(slug) {
    try {
      const model = await this.loraModelDb.findBySlug(slug);
      if (!model) {
        throw new Error(`LoRA model with slug ${slug} not found`);
      }
      return model;
    } catch (error) {
      this.logger.error(`Failed to get LoRA model by slug ${slug}:`, error);
      throw error;
    }
  }

  /**
   * Increment model usage count
   * @param {string} slug - Model slug
   */
  async incrementModelUsage(slug) {
    try {
      await this.loraModelDb.incrementUsage(slug);
      this.logger.debug(`Incremented usage for model ${slug}`);
    } catch (error) {
      this.logger.error(`Failed to increment usage for model ${slug}:`, error);
      throw error;
    }
  }

  /**
   * Get training statistics
   * @returns {Promise<Object>} Training statistics
   */
  async getTrainingStats() {
    try {
      const stats = {
        totalJobs: await this.trainingDb.countDocuments({}),
        queuedJobs: await this.trainingDb.countDocuments({ status: 'QUEUED' }),
        runningJobs: await this.trainingDb.countDocuments({ status: 'RUNNING' }),
        completedJobs: await this.trainingDb.countDocuments({ status: 'COMPLETED' }),
        failedJobs: await this.trainingDb.countDocuments({ status: 'FAILED' }),
        totalModels: await this.loraModelDb.countDocuments({}),
        totalDatasets: await this.datasetDb.countDocuments({})
      };
      
      return stats;
    } catch (error) {
      this.logger.error('Failed to get training stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old training jobs (older than 30 days)
   * @param {number} daysOld - Number of days old to clean up
   */
  async cleanupOldJobs(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const result = await this.trainingDb.deleteMany({
        status: { $in: ['COMPLETED', 'FAILED'] },
        completedAt: { $lt: cutoffDate }
      });
      
      this.logger.debug(`Cleaned up ${result.deletedCount} old training jobs`);
      return result.deletedCount;
    } catch (error) {
      this.logger.error('Failed to cleanup old jobs:', error);
      throw error;
    }
  }
}

module.exports = MongoService;
