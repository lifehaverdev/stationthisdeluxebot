const { dbQueue, getCachedClient } = require('../db/utils/queue');

/**
 * CookJobStore
 * Lightweight Mongo-backed queue for cook generation jobs.
 * Uses `cook_jobs` collection and Change Streams for pub-sub.
 */
class CookJobStore {
  constructor() {
    this._initPromise = null;
    this.collection = null;
  }

  async _init() {
    if (this.collection) return;
    if (!this._initPromise) {
      this._initPromise = getCachedClient().then((client) => {
        const dbName = process.env.MONGO_DB_NAME || 'station';
        const db = client.db(dbName);
        this.collection = db.collection('cook_jobs');
        // Indexes to speed up Change Streams filtering & look-ups
        return this.collection.createIndexes([
          { key: { status: 1 } },
          { key: { collectionId: 1 } },
          { key: { userId: 1 } },
        ]);
      });
    }
    await this._initPromise;
  }

  /**
   * Enqueue a new job document with status `queued`.
   * @param {Object} job  – {spellIdOrToolId, userContext, collectionId, userId}
   */
  async enqueue(job) {
    await this._init();
    const doc = {
      ...job,
      status: 'queued',
      attempt: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.collection.insertOne(doc);
    return doc;
  }

  /**
   * Watch for new queued jobs and invoke callback.
   * Returns the Change Stream so caller can `.close()`.
   */
  async watchQueued(callback) {
    await this._init();
    const pipeline = [
      { $match: { 'fullDocument.status': 'queued' } },
    ];
    const changeStream = this.collection.watch(pipeline, { fullDocument: 'updateLookup' });
    changeStream.on('change', (change) => callback(change.fullDocument));
    return changeStream;
  }

  async markRunning(id) {
    await this._init();
    await this.collection.updateOne({ _id: id }, { $set: { status: 'running', updatedAt: new Date() } });
  }

  async markDone(id) {
    await this._init();
    await this.collection.updateOne({ _id: id }, { $set: { status: 'done', updatedAt: new Date() } });
  }

  async markFailed(id, errorMsg) {
    await this._init();
    await this.collection.updateOne({ _id: id }, { $set: { status: 'failed', error: errorMsg, updatedAt: new Date() } });
  }
}

// Export a singleton
module.exports = new CookJobStore(); 