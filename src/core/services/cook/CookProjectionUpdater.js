const { getCachedClient } = require('../db/utils/queue');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('CookProjection');

class CookProjectionUpdater {
  constructor() {
    this._initPromise = null;
    this.eventsCol = null;
    this.statusCol = null;
    this.changeStream = null;
  }

  async _init() {
    if (this.eventsCol) return;
    if (!this._initPromise) {
      this._initPromise = getCachedClient().then(async (client) => {
        const dbName = process.env.MONGO_DB_NAME || 'station';
        const db = client.db(dbName);
        this.eventsCol = db.collection('cook_events');
        this.statusCol = db.collection('cook_status');
        await this.statusCol.createIndex({ 'key.collectionId': 1, 'key.userId': 1 }, { unique: true });
      });
    }
    await this._initPromise;
  }

  /**
   * Rebuild status projection by folding all events (for dev / recovery).
   */
  async rebuild() {
    await this._init();
    logger.info('[CookProjection] Rebuilding status projection…');
    const cursor = this.eventsCol.find({}).sort({ ts: 1 });
    await this.statusCol.deleteMany({});
    for await (const evt of cursor) {
      await this._applyEvent(evt, false);
    }
    logger.info('[CookProjection] Rebuild complete');
  }

  /**
   * Start watching event stream and apply in real-time.
   */
  async watch() {
    await this._init();
    if (this.changeStream) return; // already watching
    try {
      this.changeStream = this.eventsCol.watch([{ $match: { operationType: 'insert' } }], { fullDocument: 'updateLookup' });
      this.changeStream.on('change', async (change) => {
        const evt = change.fullDocument;
        try { await this._applyEvent(evt, true); }
        catch (err) { logger.error('applyEvent error', err); }
      });
      this.changeStream.on('error', (err) => {
        logger.error('[CookProjection] Change stream error:', err.message);
        logger.warn('[CookProjection] Disabling live updates; will rely on polling.');
        this.changeStream = null;
      });
      logger.info('[CookProjection] Change stream watching');
    } catch (err) {
      logger.warn('[CookProjection] Change streams not supported – falling back to polling every 30s');
      setInterval(async () => {
        try {
          const latest = await this.eventsCol.find({}).sort({ ts: 1 }).toArray();
          for (const evt of latest) await this._applyEvent(evt, true);
        } catch(e){ logger.error('Polling projection error', e);}
      }, 30000);
    }
  }

  /**
   * Reducer – mutates one status doc.
   */
  _reduce(status, evt) {
    switch (evt.type) {
      case 'CookStarted':
        status.state = 'cooking';
        status.generationCount = 0;
        status.queued = 1;
        break;
      case 'PieceQueued':
        status.queued = (status.queued || 0) + 1;
        break;
      case 'PieceGenerated':
        status.generationCount = (status.generationCount || 0) + 1;
        status.lastGenerated = evt.ts;
        status.queued = Math.max((status.queued || 1) - 1, 0);
        break;
      case 'PieceApproved':
        status.approved = (status.approved || 0) + 1;
        break;
      case 'PieceRejected':
        status.rejected = (status.rejected || 0) + 1;
        break;
      case 'CookPaused':
        status.state = 'paused';
        break;
      case 'CookResumed':
        status.state = 'cooking';
        break;
      case 'CookCompleted':
        status.state = 'completed';
        break;
    }
    return status;
  }

  async _applyEvent(evt, upsert = true) {
    const key = { collectionId: evt.collectionId, userId: evt.userId };
    const docKey = { key };

    const existing = await this.statusCol.findOne(docKey);
    let newStatus = existing ? { ...existing } : { key, state: 'idle', generationCount: 0, queued: 0, approved: 0, rejected: 0 };
    newStatus = this._reduce(newStatus, evt);
    newStatus.updatedAt = new Date();

    if (existing) {
      await this.statusCol.replaceOne({ _id: existing._id }, newStatus);
    } else if (upsert) {
      await this.statusCol.insertOne(newStatus);
    }
  }

  async getStatus(collectionId, userId) {
    await this._init();
    return this.statusCol.findOne({ key: { collectionId, userId } }, { projection: { _id: 0 } });
  }
}

module.exports = new CookProjectionUpdater(); 