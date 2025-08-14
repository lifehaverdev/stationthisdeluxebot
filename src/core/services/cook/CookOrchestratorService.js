const { getCachedClient } = require('../db/utils/queue');
const CookJobStore = require('./CookJobStore');
const TraitEngine = require('./TraitEngine');
const { v4: uuidv4 } = require('uuid');
const internalApiClient = require('../../../utils/internalApiClient');
const { createLogger } = require('../../../utils/logger');

// Local dev toggle: enable immediate submit after enqueue (avoids watcher dependency)
const IMMEDIATE_SUBMIT = true;
const ENABLE_VERBOSE_SUBMIT_LOGS = false;

class CookOrchestratorService {
  constructor() {
    this._initPromise = null;
    this.events = null; // Mongo collection
    this.runningByCollection = new Map(); // key: `${collectionId}:${userId}` → { running:Set(jobId), nextIndex:number, total:number, maxConcurrent:number, generatedCount:number, ... }
    this.logger = createLogger('CookOrchestrator');
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

  _getKey(collectionId, userId) {
    return `${collectionId}:${userId}`;
  }

  /**
   * Start cook with immediate submission of the first piece and orchestration-managed scheduling.
   */
  async startCook({ collectionId, userId, spellId, toolId, traitTypes = [], paramsTemplate = {}, traitTree = [], paramOverrides = {}, totalSupply = 1 }) {
    await this._init();
    if (!spellId && !toolId) throw new Error('spellId or toolId required');

    const supply = Number.isFinite(totalSupply) && totalSupply > 0 ? Math.floor(totalSupply) : 1;
    const key = this._getKey(collectionId, userId);
    if (!this.runningByCollection.has(key)) {
      this.runningByCollection.set(key, { running: new Set(), nextIndex: 0, total: supply, maxConcurrent: 3, generatedCount: 0, toolId: toolId || null, spellId: spellId || null, traitTree, paramOverrides, traitTypes, paramsTemplate });
    }
    const state = this.runningByCollection.get(key);
    state.total = supply; // update if changed

    await this.appendEvent('CookStarted', { collectionId, userId, totalSupply: supply });

    // Submit first piece immediately if within supply
    if (state.nextIndex < state.total && (state.generatedCount + state.running.size) < state.total) {
      const enq = await this._enqueuePiece({ collectionId, userId, index: state.nextIndex, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate });
      const enqueuedJobId = enq.jobId;
      state.running.add(String(enqueuedJobId));
      state.nextIndex += 1;
      await this.appendEvent('PieceQueued', { collectionId, userId, jobId: enqueuedJobId, pieceIndex: 0 });

      if (IMMEDIATE_SUBMIT) {
        try {
          // Build submission payload directly without waiting for any watcher
          const submission = enq.submission;
          if (ENABLE_VERBOSE_SUBMIT_LOGS) this.logger.info(`[CookOrchestrator] Immediate submit for job ${enqueuedJobId} (tool ${submission.toolId})`);
          const resp = await internalApiClient.post('/internal/v1/data/execute', submission);
          this.logger.info(`[Cook] Submitted piece. job=${enqueuedJobId} resp=${resp?.status || 'ok'}`);
        } catch (e) {
          this.logger.error(`[CookOrchestrator] Immediate submit failed: ${e.message}`);
        }
      }

      return { queued: 1 }; 
    }

    return { queued: 0 };
  }

  /**
   * Prepare the next piece: select traits deterministically by index, resolve params, and persist an audit job.
   * Returns { jobId, submission } where submission is the payload for the unified execute endpoint.
   */
  async _enqueuePiece({ collectionId, userId, index, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate }) {
    let selectedTraits;
    let finalParams;

    if (Array.isArray(traitTree) && traitTree.length) {
      const selection = TraitEngine.selectFromTraitTree(traitTree, { deterministicIndex: index });
      selectedTraits = selection;
      finalParams = TraitEngine.applyTraitsToParams(paramOverrides || {}, selection);
    } else {
      const generated = TraitEngine.generateTraitSelection(traitTypes);
      selectedTraits = generated.selectedTraits;
      const baseTemplate = Object.keys(paramOverrides||{}).length ? paramOverrides : paramsTemplate;
      finalParams = TraitEngine.applyTraitsToParams(baseTemplate, selectedTraits);
    }

    // Build unified submission payload with provenance
    const spellIdOrToolId = spellId || toolId;
    const pieceIndex = index;
    const submission = {
      toolId: spellIdOrToolId,
      inputs: finalParams || {},
      user: { masterAccountId: userId, platform: 'cook-orchestrator' },
      metadata: {
        source: 'cook',
        collectionId,
        pieceIndex,
        toolId: spellIdOrToolId,
        selectedTraits,
        paramSnapshot: finalParams || {},
      }
    };

    // Keep cook_jobs as an audit trail only; not used for scheduling anymore
    const job = await CookJobStore.enqueue({
      spellIdOrToolId,
      userContext: finalParams,
      collectionId,
      userId,
      traitTree,
      paramOverrides,
      pieceIndex,
    });

    // Link job id for legacy references
    submission.metadata.jobId = String(job._id);

    return { jobId: job._id, submission };
  }

  /**
   * Called when a piece completes. Schedules the next submissions immediately (up to max concurrency) without any worker.
   */
  async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
    const key = this._getKey(collectionId, userId);
    const state = this.runningByCollection.get(key);
    if (!state) return;
    state.running.delete(String(finishedJobId));
    if (success) state.generatedCount = (state.generatedCount || 0) + 1;

    // If done with supply and nothing running, emit completed
    if (state.generatedCount >= state.total && state.running.size === 0) {
      await this.appendEvent('CookCompleted', { collectionId, userId });
      this.runningByCollection.delete(key);
      return;
    }

    // Fill available slots up to maxConcurrent, without exceeding supply
    let queued = 0;
    while (
      state.running.size < state.maxConcurrent &&
      state.nextIndex < state.total &&
      (state.generatedCount + state.running.size) < state.total
    ) {
      const idx = state.nextIndex;
      const enq = await this._enqueuePiece({
        collectionId,
        userId,
        index: idx,
        toolId: state.toolId,
        spellId: state.spellId,
        traitTree: state.traitTree,
        paramOverrides: state.paramOverrides,
        traitTypes: state.traitTypes,
        paramsTemplate: state.paramsTemplate,
      });
      state.running.add(String(enq.jobId));
      state.nextIndex += 1;
      queued += 1;
      await this.appendEvent('PieceQueued', { collectionId, userId, jobId: enq.jobId, pieceIndex: idx });

      // Immediate submit for newly queued pieces
      try {
        const resp = await internalApiClient.post('/internal/v1/data/execute', enq.submission);
        this.logger.info(`[Cook] Submitted piece. job=${enq.jobId} resp=${resp?.status || 'ok'}`);
      } catch (e) {
        this.logger.error(`[CookOrchestrator] submit failed for job ${enq.jobId}: ${e.message}`);
      }
    }
    return { queued };
  }
}

module.exports = new CookOrchestratorService(); 