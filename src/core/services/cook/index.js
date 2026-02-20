// ✅ DEPRECATED COMPONENTS REMOVED:
// - CookJobStore (deprecated - replaced by CookOrchestratorService in-memory state)
// - CookEmbeddedWorker (deprecated - auto-start disabled, no longer needed)

const TraitEngine = require('./TraitEngine');
const CookOrchestratorService = require('./CookOrchestratorService');
const CookProjectionUpdater = require('./CookProjectionUpdater');
const CollectionExportService = require('./CollectionExportService');
const { createLogger } = require('../../../utils/logger');
const { getCachedClient } = require('../db/utils/queue');

async function initializeCookServices(logger = console, options = {}) {
  const log = logger.child ? logger.child({ service: 'Cook' }) : logger;
  try {
    const _t = Date.now();
    log.info('[CookServices] Starting projection rebuild...');
    await CookProjectionUpdater.rebuild();
    log.info(`[CookServices] Projection rebuild done in ${Date.now() - _t}ms`);
    await CookProjectionUpdater.watch();
    log.info('[CookServices] Projection rebuilt & watcher started');
    await resumeActiveCooksOnStartup({
      log,
      cookCollectionsDb: options.cookCollectionsDb,
      cooksDb: options.cooksDb,
    });
  } catch (err) {
    log.error('[CookServices] initialization error', err);
  }
}

async function resumeActiveCooksOnStartup({ log, cookCollectionsDb, cooksDb }) {
  if (!cookCollectionsDb || !cooksDb) {
    log.debug('[CookServices] Skipping auto-resume – cook DB handles not available');
    return;
  }
  try {
    const client = await getCachedClient();
    const dbName = process.env.MONGO_DB_NAME || 'station';
    const db = client.db(dbName);
    const statusCol = db.collection('cook_status');

    const cursor = statusCol.find({ state: 'cooking', autoResumeLock: { $exists: false } });
    let examined = 0;
    let resumed = 0;
    for await (const status of cursor) {
      const statusId = status._id;
      const lockToken = `autoResume:${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      const claim = await statusCol.findOneAndUpdate(
        { _id: statusId, state: 'cooking', autoResumeLock: { $exists: false } },
        { $set: { autoResumeLock: lockToken, autoResumeLockedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (!claim.value) continue; // Already claimed/resolved elsewhere

      const key = claim.value.key || {};
      const collectionId = key.collectionId;
      const rawUserId = key.userId;
      const generationCount = claim.value.generationCount || 0;

      if (!collectionId || !rawUserId) {
        await statusCol.updateOne({ _id: statusId, autoResumeLock: lockToken }, { $unset: { autoResumeLock: '', autoResumeLockedAt: '' } });
        continue;
      }

      const userId = String(rawUserId);
      const collectionIdStr = String(collectionId);
      examined += 1;

      try {
        const collection = await cookCollectionsDb.findById(collectionIdStr);
        if (!collection) {
          log.warn(`[CookServices] Auto-resume skipped – collection ${collectionIdStr} not found`);
          continue;
        }

        const totalSupply = Number(collection.totalSupply || collection.config?.totalSupply || 0);
        if (!totalSupply) {
          log.warn(`[CookServices] Auto-resume skipped – collection ${collectionIdStr} has no totalSupply`);
          continue;
        }
        if (generationCount >= totalSupply) {
          log.debug(`[CookServices] Auto-resume skipped – ${collectionIdStr} already met supply`);
          continue;
        }

        const toolId = collection.toolId || collection.config?.toolId || null;
        const spellId = toolId ? null : (collection.spellId || collection.config?.spellId || null);
        if (!toolId && !spellId) {
          log.warn(`[CookServices] Auto-resume skipped – collection ${collectionIdStr} missing generator`);
          continue;
        }

        const traitTree = collection.config?.traitTree || [];
        const paramOverrides = collection.config?.paramOverrides || {};

        let cookDoc;
        try {
          cookDoc = await cooksDb.createCook({
            collectionId: collectionIdStr,
            initiatorAccountId: userId,
            targetSupply: totalSupply,
          });
        } catch (dbErr) {
          log.warn(`[CookServices] Auto-resume skipped – unable to create cook for ${collectionIdStr}: ${dbErr.message}`);
          continue;
        }

        await CookOrchestratorService.startCook({
          collectionId: collectionIdStr,
          userId,
          cookId: cookDoc._id,
          spellId,
          toolId,
          traitTypes: [],
          paramsTemplate: {},
          traitTree,
          paramOverrides,
          totalSupply,
        });

        resumed += 1;
        log.info(`[CookServices] Auto-resumed cook for collection ${collectionIdStr} (user ${userId})`);
      } catch (resumeErr) {
        log.error(`[CookServices] Auto-resume error for collection ${collectionIdStr}:`, resumeErr);
      } finally {
        await statusCol.updateOne(
          { _id: statusId, autoResumeLock: lockToken },
          { $unset: { autoResumeLock: '', autoResumeLockedAt: '' } }
        );
      }
    }

    if (!examined) {
      log.info('[CookServices] No running cooks detected for auto-resume');
    } else {
      log.info(`[CookServices] Auto-resume inspected ${examined} cooks, successfully resumed ${resumed}`);
    }
  } catch (err) {
    log.error('[CookServices] Auto-resume scan failed:', err);
  }
}

module.exports = {
  TraitEngine,
  CookOrchestratorService,
  CookProjectionUpdater,
  CollectionExportService,
  initializeCookServices,
}; 
