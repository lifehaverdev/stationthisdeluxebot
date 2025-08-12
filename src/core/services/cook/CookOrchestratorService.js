const { getCachedClient } = require('../db/utils/queue');
const CookJobStore = require('./CookJobStore');
const TraitEngine = require('./TraitEngine');
const { v4: uuidv4 } = require('uuid');

class CookOrchestratorService {
  constructor() {
    this._initPromise = null;
    this.events = null; // Mongo collection
  }

  async _init() {
    if (this.events) return;
    if (!this._initPromise) {
      this._initPromise = getCachedClient().then((client) => {
        const dbName = process.env.MONGO_DB_NAME || 'station';
        this.events = client.db(dbName).collection('cook_events');
        return this.events.createIndex({ collectionId: 1, userId: 1, ts: 1 });
      });
    }
    await this._initPromise;
  }

  async appendEvent(type, payload) {
    await this._init();
    await this.events.insertOne({ type, ...payload, ts: new Date() });
  }

  /**
   * Start cook: create initial generation job.
   * Expects traitTypes & paramsTemplate for now.
   */
  async startCook({ collectionId, userId, spellId, toolId, traitTypes = [], paramsTemplate = {} }) {
    if (!spellId && !toolId) throw new Error('spellId or toolId required');

    const { selectedTraits, traitDetails } = TraitEngine.generateTraitSelection(traitTypes);
    const finalParams = TraitEngine.applyTraitsToParams(paramsTemplate, selectedTraits);

    const job = await CookJobStore.enqueue({
      spellIdOrToolId: spellId || toolId,
      userContext: finalParams,
      collectionId,
      userId,
    });

    await this.appendEvent('CookStarted', { collectionId, userId });
    await this.appendEvent('PieceQueued', { collectionId, userId, jobId: job._id });

    return { jobId: job._id };
  }
}

module.exports = new CookOrchestratorService(); 