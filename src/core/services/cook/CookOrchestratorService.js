const { getCachedClient } = require('../db/utils/queue');
// Legacy CookJobStore removed – generate ephemeral jobIds instead of writing to cook_jobs
// const CookJobStore = require('./CookJobStore');
const TraitEngine = require('./TraitEngine');
const { v4: uuidv4 } = require('uuid');
const internalApiClient = require('../../../utils/internalApiClient');
const { createLogger } = require('../../../utils/logger');

// Local dev toggle: enable immediate submit after enqueue (avoids watcher dependency)
const IMMEDIATE_SUBMIT = true;
const ENABLE_VERBOSE_SUBMIT_LOGS = false;

// Helper: submit either a tool execute or spell cast based on spellId
async function submitPiece({ spellId, submission }) {
  if (spellId) {
    // Build spell cast payload from submission
    const { inputs, user, metadata } = submission;
    return internalApiClient.post('/internal/v1/data/spells/cast', {
      slug: spellId,
      context: {
        masterAccountId: user.masterAccountId || user.userId || user.id,
        platform: 'cook',
        parameterOverrides: inputs,
        ...metadata,
      },
    });
  }
  // Tool path
  return internalApiClient.post('/internal/v1/data/execute', submission);
}

class CookOrchestratorService {
  constructor() {
    this._initPromise = null;
    this.events = null; // Mongo collection
    this.outputsCol = null; // Mongo collection for generation_outputs
    this.runningByCollection = new Map(); // key: `${collectionId}:${userId}` → { running:Set(jobId), nextIndex:number, total:number, maxConcurrent:number, generatedCount:number, ... }
    this.logger = createLogger('CookOrchestrator');
  }

  async _init() {
    if (this.events) return;
    if (!this._initPromise) {
      this._initPromise = getCachedClient().then((client) => {
        const DB_NAME = process.env.MONGO_DB_NAME || 'noema';
        this.events = client.db(DB_NAME).collection('cook_events');
        this.outputsCol = client.db(DB_NAME).collection('generationOutputs');
        return Promise.all([
          this.events.createIndex({ collectionId: 1, userId: 1, ts: 1 }),
          this.outputsCol.createIndex({ 'metadata.collectionId': 1, masterAccountId: 1 })
        ]);
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

  async _getProducedCount(collectionId, userId) {
    await this._init();
    const { ObjectId } = require('mongodb');
    return this.outputsCol.countDocuments({
      'metadata.collectionId': collectionId,
      masterAccountId: new ObjectId(userId),
      $and: [
        { $or: [
          { 'metadata.reviewOutcome': { $exists: false } },
          { 'metadata.reviewOutcome': { $ne: 'rejected' } },
        ]},
        { $or: [
          { reviewOutcome: { $exists: false } },
          { reviewOutcome: { $ne: 'rejected' } },
        ]},
        { deliveryStrategy: { $ne: 'spell_step' } },
      ],
    });
  }

  /**
   * Start cook with immediate submission of the first piece and orchestration-managed scheduling.
   */
  async startCook({ collectionId, userId, cookId, spellId, toolId, traitTypes = [], paramsTemplate = {}, traitTree = [], paramOverrides = {}, totalSupply = 1 }) {
    await this._init();
    if (!spellId && !toolId) throw new Error('spellId or toolId required');

    const supply = Number.isFinite(totalSupply) && totalSupply > 0 ? Math.floor(totalSupply) : 1;
    const key = this._getKey(collectionId, userId);
    const producedSoFar = await this._getProducedCount(collectionId, userId);
    this.logger.info(`[Cook DEBUG] collection ${collectionId} supply=${supply} producedSoFar=${producedSoFar}`);
    if (!this.runningByCollection.has(key)) {
      this.runningByCollection.set(key, { running: new Set(), nextIndex: producedSoFar, generatedCount: producedSoFar, total: supply, maxConcurrent: 3, toolId: toolId || null, cookId, spellId: spellId || null, traitTree, paramOverrides, traitTypes, paramsTemplate });
    }
    const state = this.runningByCollection.get(key);
    this.logger.info(`[Cook DEBUG] State on start`, { nextIndex: state.nextIndex, runningSize: state.running.size, total: state.total });
    state.nextIndex = Math.max(state.nextIndex, producedSoFar);
    state.total = supply; // update if changed

    await this.appendEvent('CookStarted', { collectionId, userId, totalSupply: supply });

    if (producedSoFar >= state.total) {
      this.logger.info(`[CookOrchestrator] Supply already met for collection ${collectionId}. Nothing to do.`);
      await this.appendEvent('CookCompleted', { collectionId, userId });
      this.runningByCollection.delete(key);
      return { queued: 0 };
    }

    // Submit first piece immediately if within supply
    if (state.nextIndex < state.total && (state.generatedCount + state.running.size) < state.total) {
      const enq = await this._enqueuePiece({ collectionId, userId, cookId, index: state.nextIndex, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate });
      const enqueuedJobId = enq.jobId;
      state.running.add(String(enqueuedJobId));
      state.generatedCount = producedSoFar; // keep count in sync
      state.nextIndex += 1;
      await this.appendEvent('PieceQueued', { collectionId, userId, cookId, jobId: enqueuedJobId, pieceIndex: 0 });

      if (IMMEDIATE_SUBMIT) {
        try {
          // Build submission payload directly without waiting for any watcher
          const submission = enq.submission;
          if (ENABLE_VERBOSE_SUBMIT_LOGS) this.logger.info(`[CookOrchestrator] Immediate submit for job ${enqueuedJobId} (tool ${submission.toolId})`);
          const resp = await submitPiece({ spellId: spellId, submission });
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
  async _enqueuePiece({ collectionId, userId, cookId, index, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate }) {
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
      user: { masterAccountId: userId, platform: 'none' },
      metadata: {
        source: 'cook',
        collectionId,
        cookId,
        pieceIndex,
        toolId: spellIdOrToolId,
        selectedTraits,
        paramSnapshot: finalParams || {},
      }
    };

    // Deterministic per-piece key: cookId:index
    const pieceKey = `${cookId || 'nocook'}:${index}`;
    submission.metadata.jobId = pieceKey; // keep field name for compatibility

    return { jobId: pieceKey, submission };
  }

  /**
   * Called when a piece completes. Schedules the next submissions immediately (up to max concurrency) without any worker.
   */
  async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
    const key = this._getKey(collectionId, userId);
    const state = this.runningByCollection.get(key);
    if (!state) return;
    state.running.delete(String(finishedJobId));

    // --- Update the parent cook document with the completed generation ---
    if (state.cookId && finishedJobId) {
      try {
        // Ensure collections are initialised
        await this._init();

        // Look up the generation record that finished.
        const generation = await this.outputsCol.findOne({ 'metadata.jobId': String(finishedJobId) }, { projection: { _id: 1, costUsd: 1 } });

        if (!generation) {
          this.logger.warn(`[CookOrchestrator] Generation for jobId ${finishedJobId} not found – parent cook will not be updated.`);
        } else {
          const costDelta = typeof generation.costUsd === 'number' ? generation.costUsd : 0;

          // Update the cook document via internal API.
          await internalApiClient.put(`/internal/v1/data/cook/cooks/${state.cookId}`, {
            generationId: generation._id.toString(),
            costDeltaUsd: costDelta,
          });

          this.logger.info(`[CookOrchestrator] Updated cook ${state.cookId} with generation ${generation._id} (costUsd=${costDelta}).`);
        }
      } catch (err) {
        this.logger.error(`[CookOrchestrator] Failed to update cook ${state.cookId}: ${err.message}`);
      }
    }

    // If done with supply and nothing running, emit completed
    const producedAfter = await this._getProducedCount(collectionId, userId);
    if (producedAfter >= state.total && state.running.size === 0) {
      await this.appendEvent('CookCompleted', { collectionId, userId, cookId: state.cookId });
      // Final update to cook document
      if (state.cookId) {
          try {
              await internalApiClient.put(`/internal/v1/data/cook/cooks/${state.cookId}`, { status: 'completed' });
          } catch(err) {
              this.logger.error(`[CookOrchestrator] Failed to finalize cook ${state.cookId}:`, err.message);
          }
      }
      this.runningByCollection.delete(key);
      return;
    }

    // Fill available slots up to maxConcurrent, without exceeding supply
    let queued = 0;
    while (
      state.running.size < state.maxConcurrent &&
      state.nextIndex < state.total
    ) {
      const producedNow = await this._getProducedCount(collectionId, userId);
      if (producedNow + state.running.size >= state.total) break;
      const idx = state.nextIndex;
      const enq = await this._enqueuePiece({
        collectionId,
        userId,
        cookId: state.cookId,
        index: idx,
        toolId: state.toolId,
        spellId: state.spellId,
        traitTree: state.traitTree,
        paramOverrides: state.paramOverrides,
        traitTypes: state.traitTypes,
        paramsTemplate: state.paramsTemplate,
      });
      state.running.add(String(enq.jobId));
      this.logger.info('[Cook DEBUG] queued job', { jobId: enq.jobId, pieceIndex: idx });
      state.nextIndex += 1;
      state.generatedCount = producedNow; // update count
      queued += 1;
      await this.appendEvent('PieceQueued', { collectionId, userId, cookId: state.cookId, jobId: enq.jobId, pieceIndex: idx });

      // Immediate submit for newly queued pieces
      try {
        const resp = await submitPiece({ spellId: state.spellId, submission: enq.submission });
        this.logger.info(`[Cook] Submitted piece. job=${enq.jobId} resp=${resp?.status || 'ok'}`);
      } catch (e) {
        this.logger.error(`[CookOrchestrator] submit failed for job ${enq.jobId}: ${e.message}`);
      }
    }
    return { queued };
  }
}

module.exports = new CookOrchestratorService(); 