const { getCachedClient } = require('../db/utils/queue');
const { createLogger } = require('../../../utils/logger');
const { ObjectId } = require('mongodb');

const logger = createLogger('CookProjection');

class CookProjectionUpdater {
  constructor() {
    this._initPromise = null;
    this.cooksCol = null; // ✅ Use cooks collection instead of deprecated cook_events
    this.statusCol = null;
    this.changeStream = null;
  }

  async _init() {
    if (this.cooksCol && this.statusCol) return;
    if (!this._initPromise) {
      this._initPromise = getCachedClient().then(async (client) => {
        const dbName = process.env.MONGO_DB_NAME || 'station';
        const db = client.db(dbName);
        this.cooksCol = db.collection('cooks'); // ✅ Watch cook documents instead of cook_events
        this.statusCol = db.collection('cook_status');
        await this.statusCol.createIndex({ 'key.collectionId': 1, 'key.userId': 1 }, { unique: true });
      });
    }
    await this._initPromise;
  }

  /**
   * Rebuild status projection by processing events from all cook documents.
   * Uses in-memory reduction + bulkWrite to avoid thousands of sequential DB round-trips.
   */
  async rebuild() {
    await this._init();
    const _t = Date.now();
    logger.info('[CookProjection] Rebuilding status projection from cook documents…');
    await this.statusCol.deleteMany({});

    // Phase 1: Read all cooks and reduce events in-memory
    const statusMap = new Map(); // "collectionId:userId" -> status object
    const cursor = this.cooksCol.find({});
    let cookCount = 0;
    let eventCount = 0;
    for await (const cook of cursor) {
      cookCount++;
      if (cook.events && Array.isArray(cook.events) && cook.events.length > 0) {
        eventCount += cook.events.length;
        for (const evt of cook.events) {
          const mapKey = `${evt.collectionId}:${evt.userId}`;
          if (!statusMap.has(mapKey)) {
            statusMap.set(mapKey, {
              key: { collectionId: evt.collectionId, userId: evt.userId },
              state: 'idle',
              generationCount: 0,
              queued: 0,
              approved: 0,
              rejected: 0,
            });
          }
          this._reduce(statusMap.get(mapKey), evt);
        }
      }
    }

    // Phase 2: Bulk-insert all computed statuses in one shot
    if (statusMap.size > 0) {
      const docs = [];
      for (const status of statusMap.values()) {
        status.updatedAt = new Date();
        docs.push(status);
      }
      await this.statusCol.insertMany(docs, { ordered: false });
    }

    logger.info(`[CookProjection] Rebuild complete: ${cookCount} cooks, ${eventCount} events, ${statusMap.size} statuses in ${Date.now() - _t}ms`);
  }

  /**
   * Start watching cook documents for changes and apply events in real-time.
   */
  async watch() {
    await this._init();
    if (this.changeStream) return; // already watching
    try {
      // ✅ Watch all cook document updates - check if events array was modified
      this.changeStream = this.cooksCol.watch(
        [{ $match: { operationType: { $in: ['insert', 'update'] } } }],
        { fullDocument: 'updateLookup' }
      );
      
      // Track processed event timestamps to avoid duplicates
      const processedEvents = new Map(); // cookId -> Set of event timestamps
      
      this.changeStream.on('change', async (change) => {
        try {
          const cook = change.fullDocument;
          if (!cook || !cook.events || !Array.isArray(cook.events) || cook.events.length === 0) {
            return;
          }
          
          const cookId = String(cook._id);
          if (!processedEvents.has(cookId)) {
            processedEvents.set(cookId, new Set());
          }
          const processed = processedEvents.get(cookId);
          
          // Process only new events (those we haven't seen before)
          for (const evt of cook.events) {
            const eventKey = `${evt.type}-${evt.ts?.getTime() || evt.ts}`;
            if (!processed.has(eventKey)) {
              await this._applyEvent(evt, true);
              processed.add(eventKey);
            }
          }
          
          // Cleanup old processed events to prevent memory leak (keep last 1000 per cook)
          if (processed.size > 1000) {
            const sorted = Array.from(processed).sort().slice(-500);
            processed.clear();
            sorted.forEach(k => processed.add(k));
          }
        } catch (err) {
          logger.error('[CookProjection] applyEvent error:', err);
        }
      });
      
      this.changeStream.on('error', (err) => {
        logger.error('[CookProjection] Change stream error:', err.message);
        logger.warn('[CookProjection] Disabling live updates; will rely on polling.');
        this.changeStream = null;
      });
      
      logger.debug('[CookProjection] Change stream watching cook documents');
    } catch (err) {
      logger.warn('[CookProjection] Change streams not supported – falling back to polling every 30s');
      setInterval(async () => {
        try {
          // ✅ Poll cook documents for new events
          const cooks = await this.cooksCol.find({ 'events.0': { $exists: true } }).toArray();
          for (const cook of cooks) {
            if (cook.events && cook.events.length > 0) {
              // Process all events
              for (const evt of cook.events) {
                await this._applyEvent(evt, true);
              }
            }
          }
        } catch(e) {
          logger.error('[CookProjection] Polling projection error:', e);
        }
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
      case 'CookStopped':
        status.state = 'stopped';
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
    
    // ✅ First try to get from projection (faster)
    let status = await this.statusCol.findOne({ key: { collectionId, userId } }, { projection: { _id: 0 } });
    
    // ✅ If not found, derive directly from cook documents (more accurate)
    if (!status) {
      // Find the most recent active cook for this collection+user
      const userIdObj = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
      const latestCook = await this.cooksCol.findOne(
        { collectionId, initiatorAccountId: userIdObj },
        { sort: { startedAt: -1 } }
      );
      
      if (latestCook) {
        // Derive status from cook document
        status = {
          key: { collectionId, userId },
          state: latestCook.status || 'idle',
          generationCount: latestCook.generatedCount || 0,
          queued: 0, // ✅ No queued jobs - orchestrator handles scheduling directly
          approved: 0,
          rejected: 0,
          updatedAt: latestCook.updatedAt || latestCook.startedAt,
        };
        
        // Process events from this cook to get more accurate counts
        if (latestCook.events && Array.isArray(latestCook.events)) {
          for (const evt of latestCook.events) {
            status = this._reduce(status, evt);
          }
        }
      } else {
        // No cook found, return default status
        status = {
          key: { collectionId, userId },
          state: 'idle',
          generationCount: 0,
          queued: 0,
          approved: 0,
          rejected: 0,
          updatedAt: new Date(),
        };
      }
    }
    
    return status;
  }
}

module.exports = new CookProjectionUpdater(); 
