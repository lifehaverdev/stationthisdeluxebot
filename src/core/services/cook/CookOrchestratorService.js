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

    // Ensure we have a castId so downstream websocket packets can be routed.
    let castId;
    let retries = 3;
    while (retries > 0 && !castId) {
      try {
        const res = await internalApiClient.post(
          '/internal/v1/data/spells/casts',
          { spellId, initiatorAccountId: user.masterAccountId || user.userId || user.id },
          { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } }
        );
        castId = res.data?._id?.toString() || res.data?.id;
        if (castId) break; // Success
      } catch (err) {
        retries--;
        if (retries === 0) {
          // CRITICAL: Fail fast instead of using invalid fallback
          throw new Error(`Failed to create cast record after 3 retries: ${err.message}`);
        }
        // Wait before retry with exponential backoff
        await new Promise(r => setTimeout(r, 1000 * (4 - retries)));
      }
    }
    
    if (!castId) {
      throw new Error('Failed to create cast record: No castId returned after retries');
    }

    const cleanMeta = { ...metadata };
    delete cleanMeta.castId; // ensure no stale or duplicate castId

    return internalApiClient.post('/internal/v1/data/spells/cast', {
      slug: spellId,
      context: {
        masterAccountId: user.masterAccountId || user.userId || user.id,
        platform: 'cook',
        parameterOverrides: inputs,
        cookId: metadata.cookId, // preserve cookId if present
        castId,
        ...cleanMeta,
      },
    });
  }
  // Tool path
  return internalApiClient.post('/internal/v1/data/execute', submission);
}

class CookOrchestratorService {
  constructor() {
    this._initPromise = null;
    this.outputsCol = null; // Mongo collection for generation_outputs
    this.cooksCol = null; // Mongo collection for cooks (replaces deprecated cook_events)
    this.runningByCollection = new Map(); // key: `${collectionId}:${userId}` → { running:Set(jobId), nextIndex:number, total:number, maxConcurrent:number, generatedCount:number, ... }
    this.locks = new Map(); // key -> Promise (mutex chain) for concurrency control
    this.processedJobIds = new Set(); // Track processed jobIds for idempotency
    this.processedJobIdsCleanup = new Map(); // key -> setTimeout handle for cleanup
    this.logger = createLogger('CookOrchestrator');
    this.webSocketService = null; // WebSocket service for real-time updates
  }

  /**
   * Set the WebSocket service for emitting real-time cook status updates
   * @param {object} webSocketService - The WebSocket service instance
   */
  setWebSocketService(webSocketService) {
    this.webSocketService = webSocketService;
    this.logger.info('[CookOrchestrator] WebSocket service configured');
  }

  async _init() {
    if (this.outputsCol && this.cooksCol) return;
    if (!this._initPromise) {
      this._initPromise = getCachedClient().then((client) => {
        const DB_NAME = process.env.MONGO_DB_NAME || 'noema';
        // ✅ Use cooks collection instead of deprecated cook_events
        this.cooksCol = client.db(DB_NAME).collection('cooks');
        this.outputsCol = client.db(DB_NAME).collection('generationOutputs');
        return Promise.all([
          // ✅ Index on cook document fields for efficient event queries
          this.cooksCol.createIndex({ collectionId: 1, initiatorAccountId: 1, startedAt: -1 }),
          this.outputsCol.createIndex({ 'metadata.collectionId': 1, masterAccountId: 1 })
        ]);
      });
    }
    await this._initPromise;
  }

  async appendEvent(type, payload) {
    await this._init();
    
    // ✅ Store event on cook document instead of deprecated cook_events collection
    const { cookId, collectionId, userId } = payload;
    if (cookId && this.cooksCol) {
      try {
        const { ObjectId } = require('mongodb');
        const eventDoc = {
          type,
          ...payload,
          ts: new Date(),
        };
        // Remove cookId from event payload to avoid duplication
        delete eventDoc.cookId;
        
        await this.cooksCol.updateOne(
          { _id: new ObjectId(cookId) },
          { 
            $push: { events: eventDoc },
            $set: { updatedAt: new Date() }
          }
        );
        this.logger.debug(`[CookOrchestrator] Appended event ${type} to cook ${cookId}`);
      } catch (err) {
        this.logger.warn(`[CookOrchestrator] Failed to append event to cook document:`, err.message);
        // Fallback: log the error but continue
      }
    } else if (!cookId) {
      this.logger.warn(`[CookOrchestrator] appendEvent called without cookId for type ${type}`);
    }
    
    // ✅ Emit WebSocket events for key cook status changes
    if (this.webSocketService && payload.collectionId && payload.userId) {
      try {
        await this._emitCookStatusUpdate(type, payload);
      } catch (err) {
        this.logger.warn(`[CookOrchestrator] Failed to emit WebSocket event for ${type}:`, err.message);
      }
    }
  }

  /**
   * Emit WebSocket event for cook status updates
   * @private
   */
  async _emitCookStatusUpdate(eventType, payload) {
    const { collectionId, userId } = payload;
    const key = this._getKey(collectionId, userId);
    const state = this.runningByCollection.get(key);
    
    // Get current cook status
    let status = 'paused';
    let generationCount = 0;
    let targetSupply = 0;
    let queued = 0;
    let running = 0;
    
    // Handle different event types
    if (eventType === 'CookStarted') {
      status = 'running';
      targetSupply = payload.totalSupply || 0;
      generationCount = await this._getProducedCount(collectionId, userId);
      if (state) {
        running = state.running.size;
      }
    } else if (eventType === 'CookCompleted') {
      status = 'completed';
      targetSupply = payload.totalSupply || 0;
      generationCount = await this._getProducedCount(collectionId, userId);
      if (state) {
        running = state.running.size;
      }
    } else if (eventType === 'PieceGenerated' || eventType === 'PieceFailed') {
      // For PieceGenerated/PieceFailed, get current state
      if (state) {
        running = state.running.size;
        targetSupply = state.total || 0;
        // Get actual produced count from database (updated after piece generation)
        generationCount = await this._getProducedCount(collectionId, userId);
        
        if (running > 0) {
          status = 'running';
        } else if (targetSupply > 0 && generationCount >= targetSupply) {
          status = 'completed';
        } else {
          status = 'paused';
        }
      } else {
        // State doesn't exist, but piece was generated - cook might have completed
        targetSupply = payload.totalSupply || 0;
        generationCount = await this._getProducedCount(collectionId, userId);
        if (targetSupply > 0 && generationCount >= targetSupply) {
          status = 'completed';
        }
      }
    } else if (state) {
      // For other events, use current state
      running = state.running.size;
      targetSupply = state.total || 0;
      generationCount = await this._getProducedCount(collectionId, userId);
      
      if (running > 0) {
        status = 'running';
      } else if (targetSupply > 0 && generationCount >= targetSupply) {
        status = 'completed';
      } else {
        status = 'paused';
      }
    }
    
    // Emit WebSocket event
    this.webSocketService.sendToUser(String(userId), {
      type: 'cookStatusUpdate',
      payload: {
        collectionId,
        userId,
        generationCount,
        targetSupply,
        status,
        queued,
        running,
        eventType, // Include the original event type for debugging
      }
    });
    
    this.logger.debug(`[CookOrchestrator] Emitted cookStatusUpdate for ${collectionId}: status=${status}, generationCount=${generationCount}/${targetSupply}, running=${running}, eventType=${eventType}`);
  }

  _getKey(collectionId, userId) {
    return `${collectionId}:${userId}`;
  }

  /**
   * Acquire lock for a specific collection+user key
   * Uses promise chain pattern to serialize operations per key
   * Returns a function to release the lock
   */
  async _acquireLock(key) {
    this.logger.info(`[CookOrchestrator] _acquireLock called for key: ${key}`);
    // Get or create lock promise chain for this key
    if (!this.locks.has(key)) {
      this.locks.set(key, Promise.resolve());
      this.logger.info(`[CookOrchestrator] Created new lock chain for key: ${key}`);
    }
    
    // Add ourselves to the chain - wait for previous operations
    const previousLock = this.locks.get(key);
    let releaseLock;
    const lockPromise = new Promise(resolve => {
      releaseLock = resolve; // Store release function
    });
    
    // Chain our lock after the previous one
    const ourLock = previousLock.then(() => {
      this.logger.info(`[CookOrchestrator] Lock acquired for key: ${key}, waiting for release...`);
      return lockPromise;
    });
    
    // Update chain with our lock
    this.locks.set(key, ourLock);
    
    // Wait for our turn (for previous operations to complete)
    await previousLock;
    this.logger.info(`[CookOrchestrator] Previous lock released, we now have the lock for key: ${key}`);
    
    // Return release function
    return () => {
      this.logger.info(`[CookOrchestrator] Releasing lock for key: ${key}`);
      releaseLock(); // Release lock, allowing next operation
    };
  }

  async _getProducedCount(collectionId, userId) {
    await this._init();
    const { ObjectId } = require('mongodb');
    
    // ✅ VALIDATION: Verify ObjectId format before conversion
    if (!ObjectId.isValid(userId)) {
      this.logger.warn(`[CookOrchestrator] Invalid userId format: ${userId}`);
      return 0;
    }
    
    // ✅ COUNT ONLY SUCCESSFUL GENERATIONS: Exclude failed, rejected, and spell_step deliveries
    // ✅ Use same query structure as /active endpoint for consistency
    return this.outputsCol.countDocuments({
      $and: [
        {
          $or: [
            { 'metadata.collectionId': collectionId },
            { collectionId } // legacy flat field
          ]
        },
        { masterAccountId: new ObjectId(userId) },
        { status: 'completed' }, // Only count completed generations
        { deliveryStrategy: { $ne: 'spell_step' } },
        {
          $or: [
          { 'metadata.reviewOutcome': { $exists: false } },
          { 'metadata.reviewOutcome': { $ne: 'rejected' } },
          ]
        },
        {
          $or: [
          { reviewOutcome: { $exists: false } },
          { reviewOutcome: { $ne: 'rejected' } },
          ]
        }
      ],
    });
  }

  /**
   * Start cook with immediate submission of the first piece and orchestration-managed scheduling.
   */
  async startCook({ collectionId, userId, cookId, spellId, toolId, traitTypes = [], paramsTemplate = {}, traitTree = [], paramOverrides = {}, totalSupply = 1 }) {
    this.logger.info(`[CookOrchestrator] startCook called for collection ${collectionId}, userId: ${userId}, cookId: ${cookId}, spellId: ${spellId}, toolId: ${toolId}, totalSupply: ${totalSupply}`);
    try {
      this.logger.info(`[CookOrchestrator] Calling _init()...`);
    await this._init();
      this.logger.info(`[CookOrchestrator] _init completed`);
      
      if (!spellId && !toolId) {
        this.logger.error(`[CookOrchestrator] startCook failed: spellId or toolId required. spellId: ${spellId}, toolId: ${toolId}`);
        throw new Error('spellId or toolId required');
      }

    const supply = Number.isFinite(totalSupply) && totalSupply > 0 ? Math.floor(totalSupply) : 1;
    const key = this._getKey(collectionId, userId);
      this.logger.info(`[CookOrchestrator] Acquiring lock for key: ${key}`);
      
      // Acquire lock to prevent race conditions
      const releaseLock = await this._acquireLock(key);
      this.logger.info(`[CookOrchestrator] Lock acquired, getting produced count...`);
      
      try {
    const producedSoFar = await this._getProducedCount(collectionId, userId);
    this.logger.info(`[Cook DEBUG] collection ${collectionId} supply=${supply} producedSoFar=${producedSoFar}`);
        
        // Check if state exists, create or update atomically
        const existingState = this.runningByCollection.get(key);
        const shouldResetState = !existingState || (existingState.running && existingState.running.size === 0);
        if (shouldResetState) {
          this.runningByCollection.set(key, { 
            running: new Set(), 
            nextIndex: producedSoFar, 
            generatedCount: producedSoFar, 
            total: supply, 
            maxConcurrent: 3, 
            toolId: toolId || null, 
            cookId, 
            spellId: spellId || null, 
            traitTree, 
            paramOverrides, 
            traitTypes, 
            paramsTemplate 
          });
        } else {
          existingState.total = supply;
          existingState.generatedCount = producedSoFar;
          if (producedSoFar < existingState.nextIndex) {
            existingState.nextIndex = producedSoFar;
          }
        }
        
    const state = this.runningByCollection.get(key);
    this.logger.info(`[Cook DEBUG] State on start`, { nextIndex: state.nextIndex, runningSize: state.running.size, total: state.total });
    state.nextIndex = Math.max(state.nextIndex, producedSoFar);
    state.total = supply; // update if changed

        await this.appendEvent('CookStarted', { collectionId, userId, cookId: state.cookId, totalSupply: supply });

    if (producedSoFar >= state.total) {
      this.logger.info(`[CookOrchestrator] Supply already met for collection ${collectionId}. Nothing to do.`);
          await this.appendEvent('CookCompleted', { collectionId, userId, cookId: state.cookId });
      this.runningByCollection.delete(key);
      return { queued: 0 };
    }

    // Submit first piece immediately if within supply
        // Use _getProducedCount() for accurate count instead of state.generatedCount
        const currentProduced = await this._getProducedCount(collectionId, userId);
        if (state.nextIndex < state.total && (currentProduced + state.running.size) < state.total) {
        const enq = await this._enqueuePiece({ collectionId, userId, cookId, index: state.nextIndex, toolId, spellId, traitTree, paramOverrides, traitTypes, paramsTemplate });
      const enqueuedJobId = enq.jobId;

      if (IMMEDIATE_SUBMIT) {
        try {
          // Build submission payload directly without waiting for any watcher
          const submission = enq.submission;
          if (ENABLE_VERBOSE_SUBMIT_LOGS) this.logger.info(`[CookOrchestrator] Immediate submit for job ${enqueuedJobId} (tool ${submission.toolId})`);
          const resp = await submitPiece({ spellId: spellId, submission });
          this.logger.info(`[Cook] Submitted piece. job=${enqueuedJobId} resp=${resp?.status || 'ok'}`);
              
              state.running.add(String(enqueuedJobId));
              state.nextIndex += 1;
        } catch (e) {
          this.logger.error(`[CookOrchestrator] Immediate submit failed: ${e.message}`);
              throw e; // Re-throw to allow caller to handle
        }
          } else {
            state.running.add(String(enqueuedJobId));
            state.nextIndex += 1;
      }

          await this.appendEvent('PieceQueued', { collectionId, userId, cookId, jobId: enqueuedJobId, pieceIndex: state.nextIndex - 1 });

      return { queued: 1 }; 
    }

    return { queued: 0 };
      } catch (innerErr) {
        this.logger.error(`[CookOrchestrator] Error inside startCook (after lock acquired):`, innerErr);
        throw innerErr;
      } finally {
        releaseLock(); // Always release lock, even on error
        this.logger.info(`[CookOrchestrator] Lock released for key: ${key}`);
      }
    } catch (err) {
      this.logger.error(`[CookOrchestrator] startCook error for collection ${collectionId}:`, err);
      this.logger.error(`[CookOrchestrator] startCook error stack:`, err.stack);
      throw err;
    }
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
      user: { masterAccountId: userId, platform: 'cook' },
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
    
    // ✅ IDEMPOTENCY CHECK: Prevent duplicate processing
    const jobKey = `${key}:${finishedJobId}`;
    if (this.processedJobIds.has(jobKey)) {
      this.logger.debug(`[CookOrchestrator] scheduleNext already processed for jobId ${finishedJobId}, skipping`);
      return;
    }
    
    // Mark as processed
    this.processedJobIds.add(jobKey);
    
    // Cleanup after 1 hour (safety measure to prevent memory leak)
    if (this.processedJobIdsCleanup.has(jobKey)) {
      clearTimeout(this.processedJobIdsCleanup.get(jobKey));
    }
    const timeout = setTimeout(() => {
      this.processedJobIds.delete(jobKey);
      this.processedJobIdsCleanup.delete(jobKey);
    }, 60 * 60 * 1000); // 1 hour
    this.processedJobIdsCleanup.set(jobKey, timeout);
    
    // ✅ ERROR HANDLING: Log failures but continue cook
    if (!success) {
      this.logger.warn(`[CookOrchestrator] Generation failed for jobId ${finishedJobId} (collection ${collectionId}), but cook will continue`);
      await this.appendEvent('PieceFailed', { collectionId, userId, cookId: state.cookId, jobId: finishedJobId });
    }
    
    // Acquire lock to prevent race conditions
    const releaseLock = await this._acquireLock(key);
    
    try {
    const state = this.runningByCollection.get(key);
      if (!state) {
        return;
      }
      
    state.running.delete(String(finishedJobId));

    // --- Update the parent cook document with the completed generation ---
    // ✅ Only update cook document for successful generations
    if (success && state.cookId && finishedJobId) {
      try {
        // Ensure collections are initialised
        await this._init();

        // Look up the generation record that finished.
        const generation = await this.outputsCol.findOne({ 'metadata.jobId': String(finishedJobId) }, { projection: { _id: 1, costUsd: 1, status: 1 } });

        if (!generation) {
          this.logger.warn(`[CookOrchestrator] Generation for jobId ${finishedJobId} not found – parent cook will not be updated.`);
        } else if (generation.status !== 'completed') {
          // ✅ Don't update cook document for failed generations
          this.logger.info(`[CookOrchestrator] Generation ${generation._id} has status '${generation.status}', skipping cook update`);
        } else {
          const costDelta = typeof generation.costUsd === 'number' ? generation.costUsd : 0;

          // Update the cook document via internal API.
          try {
          await internalApiClient.put(`/internal/v1/data/cook/cooks/${state.cookId}`, {
            generationId: generation._id.toString(),
            costDeltaUsd: costDelta,
          });
          this.logger.info(`[CookOrchestrator] Updated cook ${state.cookId} with generation ${generation._id} (costUsd=${costDelta}).`);
          } catch (apiErr) {
            // ✅ Handle 404 gracefully - cook may have been deleted or doesn't exist
            if (apiErr.response?.status === 404) {
              this.logger.warn(`[CookOrchestrator] Cook ${state.cookId} not found (404) - may have been deleted, continuing gracefully`);
            } else {
              throw apiErr; // Re-throw non-404 errors
            }
          }
        }
      } catch (err) {
        // ✅ Handle 404 gracefully for cook updates
        if (err.response?.status === 404) {
          this.logger.warn(`[CookOrchestrator] Cook ${state.cookId} not found (404) - may have been deleted, continuing gracefully`);
        } else {
        this.logger.error(`[CookOrchestrator] Failed to update cook ${state.cookId}: ${err.message}`);
        }
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
      // Fetch produced count once before loop (not inside loop) for consistency
      const producedNow = await this._getProducedCount(collectionId, userId);
      let queued = 0;
      
      while (
        state.running.size < state.maxConcurrent &&
        state.nextIndex < state.total &&
        (producedNow + state.running.size) < state.total
      ) {
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
        
      await this.appendEvent('PieceQueued', { collectionId, userId, cookId: state.cookId, jobId: enq.jobId, pieceIndex: idx });

      // Immediate submit for newly queued pieces
      try {
        const resp = await submitPiece({ spellId: state.spellId, submission: enq.submission });
        this.logger.info(`[Cook] Submitted piece. job=${enq.jobId} resp=${resp?.status || 'ok'}`);
          
          // ✅ FIX: Only add to running set AFTER successful submit
          state.running.add(String(enq.jobId));
          state.nextIndex = idx + 1; // Atomic update
          queued += 1;
          this.logger.info('[Cook DEBUG] queued job', { jobId: enq.jobId, pieceIndex: idx });
      } catch (e) {
        this.logger.error(`[CookOrchestrator] submit failed for job ${enq.jobId}: ${e.message}`);
          // Don't add to running set or increment nextIndex if submit failed
          // Break to avoid infinite loop of failed submissions
          break;
        }
      }
      
      return { queued };
    } finally {
      releaseLock(); // Always release lock, even on error
    }
  }
}

module.exports = new CookOrchestratorService(); 
