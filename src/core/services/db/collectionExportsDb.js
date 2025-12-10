const { BaseDB, ObjectId } = require('./BaseDB');

class CollectionExportsDB extends BaseDB {
  constructor(logger) {
    super('collectionExports');
    this.logger = logger || console;
  }

  async createJob(doc) {
    const payload = {
      ...doc,
      jobType: doc.jobType || 'archive',
      status: doc.status || 'pending',
      progress: doc.progress || { stage: 'queued', current: 0, total: 0 },
      createdAt: doc.createdAt || new Date(),
      updatedAt: doc.updatedAt || new Date()
    };
    const result = await this.insertOne(payload);
    return { ...payload, _id: result.insertedId };
  }

  async findById(id) {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    return this.findOne({ _id });
  }

  async findActiveForCollection(collectionId, userId, { jobType } = {}) {
    const query = {
      collectionId,
      userId,
      status: { $in: ['pending', 'running'] }
    };
    if (jobType) {
      query.jobType = jobType;
    }
    return this.findOne(query, { sort: { createdAt: -1 } });
  }

  async findLatestForCollection(collectionId, userId, { jobType } = {}) {
    const query = { collectionId, userId };
    if (jobType) {
      query.jobType = jobType;
    }
    return this.findOne(query, { sort: { createdAt: -1 } });
  }

  async findNextPending() {
    return this.findOne({ status: 'pending' }, { sort: { createdAt: 1 } });
  }

  async countPending() {
    return this.count({ status: 'pending' });
  }

  async resetRunningJobs() {
    const now = new Date();
    return this.updateMany(
      { status: 'running' },
      {
        $set: {
          status: 'pending',
          progress: { stage: 'queued', current: 0, total: 0 },
          updatedAt: now
        },
        $unset: { startedAt: '', finishedAt: '', downloadUrl: '', expiresAt: '' }
      }
    );
  }
}

module.exports = CollectionExportsDB;
