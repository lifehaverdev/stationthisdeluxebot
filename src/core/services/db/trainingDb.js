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
 *   offeringId: string,                  // key from trainingOfferings config
 *   baseModel: string,                   // e.g. "SD1.5", "SDXL"
 *   status: 'QUEUED'|'RUNNING'|'FAILED'|'COMPLETED',
 *   progress?: number,                   // 0-100
 *   failureReason?: string,
 *   createdAt: Date,
 *   updatedAt: Date,
 *   startedAt?: Date,
 *   completedAt?: Date,
 *
 *   // Financials
 *   costPoints?: number,
 *   paidAt?: Date,
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
   */
  async findTrainingsByUser(masterAccountId, options = {}) {
    try {
      const filter = { ownerAccountId: new ObjectId(masterAccountId) };
      return this.findMany(filter, options);
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

  async fetchQueued(limit = 3) {
    return this.findMany({ status: 'QUEUED' }, { limit, sort: { createdAt: 1 } });
  }
}

module.exports = TrainingDB;
