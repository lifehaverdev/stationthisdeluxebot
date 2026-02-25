'use strict';

/**
 * TrainingService — in-process domain service for LoRA training sessions.
 * Replaces internalApiClient calls to /internal/v1/data/trainings/*.
 * Phase 6f of service-layer-migration.
 */
class TrainingService {
  constructor({ trainingDb, userService, datasetService, vastAIService, logger }) {
    this.trainingDb = trainingDb;
    this.userService = userService;
    this.datasetService = datasetService;
    this.vastAIService = vastAIService || null;
    this.logger = logger || console;
  }

  /** List all trainings owned by masterAccountId. Returns array (never null). */
  async listByOwner(masterAccountId) {
    return (await this.trainingDb.findTrainingsByUser(masterAccountId)) || [];
  }

  /** Get a single training by ID. Returns null if not found. Throws 400 on bad ID format. */
  async getById(trainingId) {
    try {
      return await this.trainingDb.findTrainingById(trainingId);
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('objectid')) {
        const e = new Error('Invalid trainingId format.');
        e.status = 400;
        throw e;
      }
      throw err;
    }
  }

  /** Create a new training session. Looks up wallet via userService; image count via datasetService. */
  async create({
    masterAccountId, name, notes, allowPublishing, tags, description, costPoints,
    datasetId, modelType, baseModel, offeringId, steps, learningRate, batchSize,
    resolution, loraRank, loraAlpha, loraDropout, triggerWords,
    trainingMode, controlDatasetId, controlSetId,
  }) {
    if (!masterAccountId || !name) {
      const e = new Error('masterAccountId and name are required.');
      e.status = 400;
      throw e;
    }
    if (!datasetId || !modelType || !triggerWords) {
      const e = new Error('datasetId, modelType, and triggerWords are required for training.');
      e.status = 400;
      throw e;
    }

    // Wallet lookup via UserService
    let walletAddress = null;
    const user = await this.userService.findById(masterAccountId);
    if (user && user.wallets && user.wallets.length > 0) {
      const primaryWallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
      walletAddress = primaryWallet.address;
      this.logger.debug(`[TrainingService] Found wallet ${walletAddress?.slice(0, 10)}... for user ${masterAccountId}`);
    }
    if (!walletAddress) {
      this.logger.error(`[TrainingService] No wallet found for user ${masterAccountId} — cannot start training`);
      const e = new Error('A connected wallet is required to start training. Please connect a wallet first.');
      e.status = 400;
      e.code = 'WALLET_REQUIRED';
      throw e;
    }

    // Dataset image count via DatasetService
    let datasetImageCount = 20;
    try {
      const dataset = this.datasetService ? await this.datasetService.getById(datasetId) : null;
      if (dataset && dataset.images) {
        datasetImageCount = dataset.images.length;
        this.logger.debug(`[TrainingService] Dataset ${datasetId} has ${datasetImageCount} images`);
      }
    } catch (datasetErr) {
      this.logger.warn(`[TrainingService] Failed to fetch dataset ${datasetId}: ${datasetErr.message}`);
    }

    const triggerWordsArray = Array.isArray(triggerWords)
      ? triggerWords
      : (triggerWords ? triggerWords.split(',').map(w => w.trim()) : []);
    const triggerWord = triggerWordsArray[0] || '';

    const newTrainingData = {
      userId: masterAccountId,
      ownerAccountId: masterAccountId,
      name,
      modelName: name,
      notes: notes || '',
      description: description || '',
      allowPublishing: allowPublishing || false,
      tags: tags || [],
      walletAddress,
      datasetId,
      datasetImageCount,
      modelType,
      baseModel: baseModel || modelType,
      offeringId: offeringId || '',
      steps: parseInt(steps) || 1000,
      learningRate: parseFloat(learningRate) || 0.0004,
      batchSize: parseInt(batchSize) || 1,
      resolution: resolution || '1024,1024',
      loraRank: parseInt(loraRank) || 16,
      loraAlpha: parseInt(loraAlpha) || 32,
      loraDropout: parseFloat(loraDropout) || 0.1,
      triggerWord,
      triggerWords: triggerWordsArray,
      costPoints: parseInt(costPoints) || 0,
      trainingMode: trainingMode || null,
      controlDatasetId: controlDatasetId || null,
      controlSetId: controlSetId || null,
      environment: process.env.TRAINING_ENVIRONMENT || 'production',
    };

    const created = await this.trainingDb.createTrainingSession(newTrainingData);
    if (!created) {
      const e = new Error('Failed to create training session.');
      e.status = 500;
      throw e;
    }
    return created;
  }

  /** Delete a training. Enforces ownership. */
  async delete(trainingId, masterAccountId) {
    if (!masterAccountId) {
      const e = new Error('masterAccountId is required.');
      e.status = 400;
      throw e;
    }
    const training = await this.trainingDb.findTrainingById(trainingId);
    if (!training) {
      const e = new Error('Training not found.');
      e.status = 404;
      throw e;
    }
    const ownerId = String(training.userId || training.ownerAccountId || '');
    if (ownerId !== masterAccountId) {
      const e = new Error('You can only delete your own trainings.');
      e.status = 403;
      throw e;
    }
    const result = await this.trainingDb.deleteTraining(trainingId);
    if (!result) {
      const e = new Error('Failed to delete training.');
      e.status = 500;
      throw e;
    }
    return { success: true, message: 'Training deleted successfully.' };
  }

  /** Retry a FAILED training. Enforces ownership and status check. */
  async retry(trainingId, masterAccountId) {
    if (!masterAccountId) {
      const e = new Error('masterAccountId is required.');
      e.status = 400;
      throw e;
    }
    const training = await this.trainingDb.findTrainingById(trainingId);
    if (!training) {
      const e = new Error('Training not found.');
      e.status = 404;
      throw e;
    }
    const ownerId = String(training.userId || training.ownerAccountId || '');
    if (ownerId !== masterAccountId) {
      const e = new Error('You can only retry your own trainings.');
      e.status = 403;
      throw e;
    }
    if (training.status !== 'FAILED') {
      const e = new Error('Only failed trainings can be retried.');
      e.status = 400;
      throw e;
    }
    const currentEnvironment = process.env.TRAINING_ENVIRONMENT || 'production';
    this.logger.debug(`[TrainingService] Retry will tag job ${trainingId} with environment: ${currentEnvironment}`);
    await this.trainingDb.setStatus(trainingId, 'QUEUED', {
      error: null,
      errorMessage: null,
      retryCount: (training.retryCount || 0) + 1,
      progress: 0,
      currentStep: 0,
      vastaiInstanceId: null,
      vastaiOfferId: null,
      startedAt: null,
      completedAt: null,
      environment: currentEnvironment,
    });
    const updatedTraining = await this.trainingDb.findTrainingById(trainingId);
    return { success: true, training: updatedTraining };
  }

  /** Cancel a non-terminal training. Enforces ownership and status check. Best-effort instance termination via VastAI. */
  async cancel(trainingId, masterAccountId) {
    if (!masterAccountId) {
      const e = new Error('masterAccountId is required.');
      e.status = 400;
      throw e;
    }
    const training = await this.trainingDb.findTrainingById(trainingId);
    if (!training) {
      const e = new Error('Training not found.');
      e.status = 404;
      throw e;
    }
    const ownerId = String(training.userId || training.ownerAccountId || '');
    if (ownerId !== masterAccountId) {
      const e = new Error('You can only cancel your own trainings.');
      e.status = 403;
      throw e;
    }
    const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
    if (TERMINAL.includes(training.status)) {
      const e = new Error(`Training is already ${training.status.toLowerCase()} and cannot be cancelled.`);
      e.status = 400;
      throw e;
    }
    await this.trainingDb.setStatus(trainingId, 'CANCELLED', {});
    if (training.vastaiInstanceId && this.vastAIService) {
      try {
        await this.vastAIService.terminateInstance(training.vastaiInstanceId);
      } catch (termErr) {
        this.logger.warn(`[TrainingService] Failed to terminate VastAI instance ${training.vastaiInstanceId}: ${termErr.message}`);
      }
    }
    const updatedTraining = await this.trainingDb.findTrainingById(trainingId);
    return { success: true, training: updatedTraining };
  }
}

module.exports = { TrainingService };
