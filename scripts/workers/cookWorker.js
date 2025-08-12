#!/usr/bin/env node
/**
 * Cook Worker – Phase 0 skeleton
 * Listens for new cook_jobs (status: queued) and logs detection.
 * Later iterations will invoke ExecutionClient.
 */

const { initializeDatabase } = require('../../src/core/initDB');
const { CookJobStore } = require('../../src/core/services/cook');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('CookWorker');

(async () => {
  try {
    await initializeDatabase();
    logger.info('DB initialised. Starting CookJobStore watcher…');

    await CookJobStore.watchQueued(async (job) => {
      logger.info(`Detected new cook job ${job._id} for collection ${job.collectionId}`);
      // For Phase-0 we do nothing beyond acknowledgement.
    });

    logger.info('Cook Worker is running.');
  } catch (err) {
    logger.error('Cook Worker failed to start', err);
    process.exit(1);
  }
})(); 