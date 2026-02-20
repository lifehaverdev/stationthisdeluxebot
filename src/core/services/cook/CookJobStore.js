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
          { key: { createdAt: 1 } },
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

  async getById(id, projection = {}) {
    await this._init();
    return this.collection.findOne({ _id: id }, { projection });
  }

  /**
   * Atomically claim this specific job if it is queued. Returns the updated doc if claimed, or null if not queued.
   */
  async claimById(id) {
    await this._init();
    const res = await this.collection.findOneAndUpdate(
      { _id: id, status: 'queued' },
      { $set: { status: 'running', updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const job = res.value || null;
    return job;
  }

  /**
   * Atomically claim the next queued job (oldest first) by marking it running.
   * Returns the claimed job document or null if none available.
   */
  async claimNextQueued() {
    await this._init();
    const res = await this.collection.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'running', updatedAt: new Date() } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    );
    const job = res.value || null;
    return job;
  }

  /**
   * Watch for new queued jobs and invoke callback.
   * Returns a handle with .close(). Falls back to polling if change streams are not available or error.
   */
  async watchQueued(callback) {
    await this._init();
    const pipeline = [
      { $match: { 'fullDocument.status': 'queued' } },
    ];
    const intervalMs = Number(process.env.COOK_QUEUE_POLL_MS) || 1000;

    const startPolling = () => {
      const timer = setInterval(async () => {
        try {
          const job = await this.claimNextQueued();
          if (job) {
              callback(job);
          }
        } catch (e) {
          // continue polling silently
        }
      }, intervalMs);
      return { close: () => clearInterval(timer) };
    };

    try {
      const changeStream = this.collection.watch(pipeline, { fullDocument: 'updateLookup' });
      let pollHandle = null;
      changeStream.on('change', (change) => callback(change.fullDocument));
      changeStream.on('error', () => {
        // Switch to polling on runtime error
        try { changeStream.close(); } catch (_) {}
        if (!pollHandle) pollHandle = startPolling();
      });
      return {
        close: () => {
          try { changeStream.close(); } catch (_) {}
          if (pollHandle) pollHandle.close();
        }
      };
    } catch (err) {
      // Fallback to polling when change streams are unavailable
      return startPolling();
    }
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

  // Debug helpers
  async countByStatus(filter = {}) {
    await this._init();
    const statuses = ['queued', 'running', 'done', 'failed'];
    const out = {};
    for (const s of statuses) {
      out[s] = await this.collection.countDocuments({ ...filter, status: s });
    }
    return out;
  }

  async peekNextQueued(filter = {}) {
    await this._init();
    return this.collection.findOne({ ...filter, status: 'queued' }, { sort: { createdAt: 1 }, projection: { userContext: 0 } });
  }

  async getQueueDebug(filter = {}) {
    await this._init();
    const [counts, next] = await Promise.all([
      this.countByStatus(filter),
      this.peekNextQueued(filter),
    ]);
    return { counts, next };
  }
}

// Export a singleton
module.exports = new CookJobStore(); 