const { createLogger } = require('../../../utils/logger');
const internalApiClient = require('../../../utils/internalApiClient');
const CookJobStore = require('./CookJobStore');

const ENABLE_QUEUE_METRICS = false;

let started = false;
let changeHandle = null;
let metricsTimer = null;
let generationExecutionService = null;

function init(service) {
  generationExecutionService = service;
}

async function ensure() {
  if (started) return;
  started = true;
  const logger = createLogger('CookEmbeddedWorker');
  try {
    logger.debug('[EmbeddedWorker] Starting cook job watcher in-process…');
    // Periodic metrics for debugging polling behavior
    const metricsMs = Number(process.env.COOK_QUEUE_METRICS_MS) || 5000;
    if (ENABLE_QUEUE_METRICS) {
      metricsTimer = setInterval(async () => {
        try {
          const dbg = await CookJobStore.getQueueDebug();
          logger.debug(`[EmbeddedWorker] Queue counts q:${dbg.counts.queued} r:${dbg.counts.running} d:${dbg.counts.done} f:${dbg.counts.failed}`);
          if (dbg.next) {
            logger.debug ? logger.debug(`[EmbeddedWorker] Next candidate ${dbg.next._id} coll:${dbg.next.collectionId} user:${dbg.next.userId}`) : null;
          }
        } catch (_) {}
      }, metricsMs);
    }

    changeHandle = await CookJobStore.watchQueued(async (job) => {
      try {
        // Mark running for safety in case watch delivered a queued doc
        await CookJobStore.markRunning(job._id);
        const { spellIdOrToolId, userContext, collectionId, userId, traitTree = [], paramOverrides = {}, totalSupply = 1 } = job;
        const payload = {
          toolId: spellIdOrToolId,
          inputs: userContext || {},
          user: { masterAccountId: userId, platform: 'cook-embedded' },
          metadata: {
            source: 'cook',
            collectionId,
            jobId: String(job._id),
            toolId: spellIdOrToolId,
            traitTree,
            paramOverrides,
            totalSupply
          }
        };
        logger.debug(`[EmbeddedWorker] Submitting job ${job._id} for collection ${collectionId} (tool ${spellIdOrToolId})`);
        let status;
        if (generationExecutionService) {
          const result = await generationExecutionService.execute(payload);
          status = result?.body?.status || 'ok';
        } else {
          const resp = await internalApiClient.post('/internal/v1/data/execute', payload);
          status = resp?.status || resp?.data?.status || 'ok';
        }
        logger.debug(`[EmbeddedWorker] Submit result for job ${job._id}: ${status}`);
      } catch (err) {
        logger.error(`[EmbeddedWorker] Failed to submit job ${job._id}: ${err.message}`);
        try { await CookJobStore.markFailed(job._id, err.message); } catch(e){}
      }
    });
    logger.debug('[EmbeddedWorker] Watcher active.');
  } catch (err) {
    started = false;
    changeHandle = null;
    if (metricsTimer) { try { clearInterval(metricsTimer); } catch (_) {} metricsTimer = null; }
    const logger = createLogger('CookEmbeddedWorker');
    logger.error('[EmbeddedWorker] Failed to start watcher', err);
  }
}

module.exports = { ensure, init }; 