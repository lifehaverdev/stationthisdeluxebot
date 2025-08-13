#!/usr/bin/env node
/**
 * Cook Worker – Processes cook_jobs and executes tools/spells via internal API.
 */

const { initializeDatabase } = require('../../src/core/initDB');
const { CookJobStore } = require('../../src/core/services/cook');
const { createLogger } = require('../../src/utils/logger');
const internalApiClient = require('../../src/utils/internalApiClient');
const ComfyUIService = require('../../src/core/services/comfydeploy/comfyui');
const { processRunPayload } = require('../../src/core/services/comfydeploy/webhookProcessor');

const logger = createLogger('CookWorker');

async function executeJob(job) {
  try {
    await CookJobStore.markRunning(job._id);

    const { spellIdOrToolId, userContext, collectionId, userId, traitTree = [], paramOverrides = {}, totalSupply = 1 } = job;

    // Build execute payload and include cook metadata for downstream processing
    const payload = {
      toolId: spellIdOrToolId,
      inputs: userContext || {},
      user: { masterAccountId: userId, platform: 'cook-worker' },
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

    logger.info(`[CookWorker] Executing job ${job._id} with tool ${spellIdOrToolId}`);

    const res = await internalApiClient.post('/internal/v1/data/execute', payload);

    logger.info(`[CookWorker] Execute submitted for job ${job._id}`);

    // Optional local sweep: if enabled and response contains a runId, poll and process until completion
    if (process.env.WEBHOOKLESS_SWEEP === 'true') {
      try {
        const runId = res.data?.runId || res.data?.metadata?.run_id || res.data?.generationId; // best-effort extraction
        if (runId) {
          logger.info(`[CookWorker] Sweep enabled. Polling run ${runId} for job ${job._id}`);
          const comfy = new ComfyUIService({ logger });
          let done = false;
          while (!done) {
            const run = await comfy.getRun(runId, { queue_position: false });
            await processRunPayload(run, { internalApiClient, logger, webSocketService: null });
            if (run?.event_type === 'completed' || run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled') {
              done = true;
            } else {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }
      } catch (e) {
        logger.warn(`[CookWorker] Sweep polling error: ${e.message}`);
      }
    }
  } catch (err) {
    logger.error(`[CookWorker] Job ${job._id} failed to submit: ${err.message}`);
    await CookJobStore.markFailed(job._id, err.message);
  }
}

(async () => {
  try {
    await initializeDatabase();
    logger.info('DB initialised. Starting CookJobStore watcher…');

    await CookJobStore.watchQueued(async (job) => {
      logger.info(`Detected new cook job ${job._id} for collection ${job.collectionId}`);
      executeJob(job);
    });

    logger.info('Cook Worker is running.');
  } catch (err) {
    logger.error('Cook Worker failed to start', err);
    process.exit(1);
  }
})(); 