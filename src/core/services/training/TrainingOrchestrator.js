/**
 * Training Orchestrator Service
 * 
 * Main coordination service that polls for training jobs and orchestrates
 * the complete training pipeline from job queuing to model registration.
 */

class TrainingOrchestrator {
  constructor({ logger, mongoService, cloudflareService, dockerService, recipeService, pointsService }) {
    this.logger = logger;
    this.mongoService = mongoService;
    this.cloudflareService = cloudflareService;
    this.dockerService = dockerService;
    this.recipeService = recipeService;
    this.pointsService = pointsService;
    
    this.isRunning = false;
    this.pollInterval = 5000; // 5 seconds
    this.maxConcurrentJobs = 2;
    this.activeJobs = new Set();
  }

  /**
   * Start the orchestrator to poll for training jobs
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Training orchestrator is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting training orchestrator...');
    
    // Start polling loop
    this.pollLoop();
  }

  /**
   * Stop the orchestrator
   */
  async stop() {
    this.isRunning = false;
    this.logger.info('Stopping training orchestrator...');
    
    // Wait for active jobs to complete
    while (this.activeJobs.size > 0) {
      this.logger.debug(`Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.logger.info('Training orchestrator stopped');
  }

  /**
   * Main polling loop
   */
  async pollLoop() {
    while (this.isRunning) {
      try {
        await this.processQueuedJobs();
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      } catch (error) {
        this.logger.error('Error in training orchestrator poll loop:', error);
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      }
    }
  }

  /**
   * Process queued training jobs
   */
  async processQueuedJobs() {
    // Check if we can start new jobs
    if (this.activeJobs.size >= this.maxConcurrentJobs) {
      return;
    }

    try {
      // Fetch queued jobs
      const queuedJobs = await this.mongoService.fetchQueuedJobs(this.maxConcurrentJobs - this.activeJobs.size);
      
      for (const job of queuedJobs) {
        if (this.activeJobs.has(job._id.toString())) {
          continue; // Job already being processed
        }

        // Claim the job atomically
        const claimed = await this.mongoService.claimJob(job._id);
        if (!claimed) {
          continue; // Job was claimed by another worker
        }

        // Process the job asynchronously
        this.processJob(job).catch(error => {
          this.logger.error(`Error processing job ${job._id}:`, error);
          this.activeJobs.delete(job._id.toString());
        });
      }
    } catch (error) {
      this.logger.error('Error fetching queued jobs:', error);
    }
  }

  /**
   * Process a single training job
   */
  async processJob(job) {
    const jobId = job._id.toString();
    this.activeJobs.add(jobId);
    
    try {
      this.logger.info(`Starting training job ${jobId} for model ${job.baseModel}`);
      
      // Update job status to RUNNING
      await this.mongoService.updateJobStatus(jobId, 'RUNNING', { startedAt: new Date() });
      
      // Get the training recipe
      const recipe = this.recipeService.getRecipe(job.baseModel);
      if (!recipe) {
        throw new Error(`No recipe found for model type: ${job.baseModel}`);
      }

      // Download dataset from Cloudflare
      this.logger.debug(`Downloading dataset for job ${jobId}`);
      const dataset = await this.mongoService.getDataset(job.datasetId);
      const datasetPath = await this.cloudflareService.downloadDataset(dataset, jobId);

      // Prepare training environment
      this.logger.debug(`Preparing training environment for job ${jobId}`);
      const trainingConfig = await recipe.prepareTrainingConfig(job, datasetPath);

      // Execute training in Docker container
      this.logger.debug(`Starting Docker training for job ${jobId}`);
      const trainingResult = await this.dockerService.runTraining(recipe, trainingConfig, jobId);

      // Upload trained model to Cloudflare
      this.logger.debug(`Uploading trained model for job ${jobId}`);
      const modelUrl = await this.cloudflareService.uploadModel(trainingResult.modelPath, jobId);

      // Register model in LoRAModelDB
      this.logger.debug(`Registering model for job ${jobId}`);
      const loraModel = await this.mongoService.createLoRAModel({
        name: `${dataset.name} - ${job.baseModel}`,
        slug: `${dataset.name.toLowerCase().replace(/\s+/g, '-')}-${job.baseModel.toLowerCase()}-${Date.now()}`,
        triggerWords: trainingResult.triggerWords || [dataset.name],
        modelType: job.baseModel,
        checkpoint: job.baseModel,
        trainedFrom: {
          trainingId: job._id,
          datasetId: job.datasetId,
          tool: 'training-system',
          steps: trainingResult.steps || 1000
        },
        description: `Trained LoRA model for ${dataset.name}`,
        previewImages: trainingResult.previewImages || [],
        createdBy: job.ownerAccountId,
        modelFileUrl: modelUrl,
        visibility: 'private'
      });

      // Update job with model information
      await this.mongoService.updateJobStatus(jobId, 'COMPLETED', {
        completedAt: new Date(),
        loraModelId: loraModel._id,
        modelRepoUrl: modelUrl,
        triggerWords: trainingResult.triggerWords,
        previewImages: trainingResult.previewImages
      });

      // Credit the trainer and dataset creator
      await this.creditUsers(job, loraModel);

      this.logger.info(`Training job ${jobId} completed successfully`);
      
    } catch (error) {
      this.logger.error(`Training job ${jobId} failed:`, error);
      
      // Update job status to FAILED
      await this.mongoService.updateJobStatus(jobId, 'FAILED', {
        completedAt: new Date(),
        failureReason: error.message
      });

      // Refund points for failed training
      await this.refundPoints(job);
      
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Credit users for successful training
   */
  async creditUsers(job, loraModel) {
    try {
      // Credit the trainer
      await this.pointsService.addPoints(job.ownerAccountId, 100, 'training_completion', {
        trainingId: job._id,
        modelId: loraModel._id
      });

      // Credit the dataset creator (if different from trainer)
      const dataset = await this.mongoService.getDataset(job.datasetId);
      if (dataset.ownerAccountId.toString() !== job.ownerAccountId.toString()) {
        await this.pointsService.addPoints(dataset.ownerAccountId, 50, 'dataset_usage', {
          trainingId: job._id,
          modelId: loraModel._id,
          datasetId: job.datasetId
        });
      }

      this.logger.debug(`Credited users for training job ${job._id}`);
    } catch (error) {
      this.logger.error(`Error crediting users for job ${job._id}:`, error);
    }
  }

  /**
   * Refund points for failed training
   */
  async refundPoints(job) {
    try {
      if (job.costPoints && job.costPoints > 0) {
        await this.pointsService.addPoints(job.ownerAccountId, job.costPoints, 'training_refund', {
          trainingId: job._id,
          reason: 'training_failed'
        });
        this.logger.debug(`Refunded ${job.costPoints} points for failed training job ${job._id}`);
      }
    } catch (error) {
      this.logger.error(`Error refunding points for job ${job._id}:`, error);
    }
  }

  /**
   * Get orchestrator status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.activeJobs.size,
      maxConcurrentJobs: this.maxConcurrentJobs
    };
  }
}

module.exports = TrainingOrchestrator;
