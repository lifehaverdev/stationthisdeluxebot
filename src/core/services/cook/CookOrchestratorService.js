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
   * Start cook with one initial job. Scheduler ramps to max 3 concurrent.
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

    // Enqueue first job only if within supply
    if (state.nextIndex < state.total && (state.generatedCount + state.running.size) < state.total) {
      const enq = await this._enqueuePiece({ collectionId, userId, index: state.nextIndex, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate });
      const enqueuedJobId = enq.jobId;
      state.running.add(String(enqueuedJobId));
      state.nextIndex += 1;
      await this.appendEvent('PieceQueued', { collectionId, userId, jobId: enqueuedJobId, pieceIndex: 0 });

      // Immediate submit in dev to bypass watcher reliance
      if (IMMEDIATE_SUBMIT) {
        try {
          // Prefer to claim the exact job we just enqueued
          let claimed = await CookJobStore.claimById(enqueuedJobId);
          if (!claimed) {
            // If someone already marked it running (race), read it back
            const maybeRunning = await CookJobStore.getById(enqueuedJobId);
            if (maybeRunning && maybeRunning.status === 'running') {
              claimed = maybeRunning;
            }
          }
          if (!claimed) {
            // Final fallback: claim any next queued
            claimed = await CookJobStore.claimNextQueued();
          }

          if (claimed) {
            const { spellIdOrToolId, userContext } = claimed;
            const payload = {
              toolId: spellIdOrToolId,
              inputs: userContext || {},
              user: { masterAccountId: userId, platform: 'cook-orchestrator-immediate' },
              metadata: {
                source: 'cook',
                collectionId,
                jobId: String(claimed._id),
                toolId: spellIdOrToolId,
                traitTree,
                paramOverrides,
                totalSupply: supply,
              },
            };
            if (ENABLE_VERBOSE_SUBMIT_LOGS) this.logger.info(`[CookOrchestrator] Immediate submit for job ${claimed._id} (tool ${spellIdOrToolId})`);
            const resp = await internalApiClient.post('/internal/v1/data/execute', payload);
            this.logger.info(`[Cook] Submitted piece. job=${claimed._id} resp=${resp?.status || 'ok'}`);
          } else {
            if (ENABLE_VERBOSE_SUBMIT_LOGS) this.logger.warn('[CookOrchestrator] Immediate submit enabled but no job could be claimed or found');
          }
        } catch (e) {
          this.logger.error(`[CookOrchestrator] Immediate submit failed: ${e.message}`);
        }
      }

      return { queued: 1 }; 
    }

    return { queued: 0 };
  }

  async _enqueuePiece({ collectionId, userId, index, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate }) {
    let finalParams;
    if (Array.isArray(traitTree) && traitTree.length) {
      const selection = TraitEngine.selectFromTraitTree(traitTree, { deterministicIndex: index });
      finalParams = TraitEngine.applyTraitsToParams(paramOverrides || {}, selection);
    } else {
      const { selectedTraits } = TraitEngine.generateTraitSelection(traitTypes);
      const baseTemplate = Object.keys(paramOverrides||{}).length ? paramOverrides : paramsTemplate;
      finalParams = TraitEngine.applyTraitsToParams(baseTemplate, selectedTraits);
    }

    const job = await CookJobStore.enqueue({
      spellIdOrToolId: spellId || toolId,
      userContext: finalParams,
      collectionId,
      userId,
      traitTree,
      paramOverrides,
      totalSupply: undefined, // not needed per-job
      pieceIndex: index,
    });
    return { jobId: job._id };
  }

  /**
   * Called by webhook processor when a job completes or fails.
   * Schedules next piece if below max concurrency and supply not exhausted.
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
    }
    return { queued };
  }
}

module.exports = new CookOrchestratorService(); 