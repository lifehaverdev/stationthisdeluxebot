#!/usr/bin/env node
/**
 * VastAI Training Worker
 *
 * Processes GPU training jobs via VastAI remote instances (one at a time).
 * Follows the cookWorker.js pattern for consistency.
 *
 * Flow:
 * 1. Poll TrainingDB for QUEUED jobs
 * 2. Claim job (atomic status transition)
 * 3. Process via TrainingJobProcessor (provisions VastAI, trains, uploads)
 * 4. Repeat
 *
 * Key protections:
 * - Prepaid model (charge upfront)
 * - Two-tier timeouts (soft alert, hard terminate)
 * - Stall detection with grace period
 * - Instance termination with retry
 * - Alerts to ops and user
 *
 * Different from trainingWorker.js which uses local Docker execution.
 */

const { initializeDatabase } = require('../../src/core/initDB');
const { createLogger } = require('../../src/utils/logger');
const TrainingDB = require('../../src/core/services/db/trainingDb');
const DatasetDB = require('../../src/core/services/db/datasetDb');
const GenerationOutputsDB = require('../../src/core/services/db/generationOutputsDb');
const PointsService = require('../../src/core/services/points');
const CreditLedgerDB = require('../../src/core/services/db/alchemy/creditLedgerDb');
const VastAIService = require('../../src/core/services/vastai/VastAIService');
const VastAIClient = require('../../src/core/services/vastai/VastAIClient');
const InstanceSweeper = require('../../src/core/services/vastai/InstanceSweeper');
const TrainingJobProcessor = require('../../src/core/services/training/TrainingJobProcessor');
const { refreshPublicLoraCache } = require('../../src/api/internal/loras/loraTriggerMapApi');

const logger = createLogger('VastAITrainingWorker');

// Poll interval when no jobs (30 seconds)
const POLL_INTERVAL_MS = 30 * 1000;

// Cooldown after processing a job (5 seconds)
const POST_JOB_COOLDOWN_MS = 5 * 1000;

// Environment filter - only process jobs tagged with matching environment
// Set TRAINING_ENVIRONMENT=development in local dev, production in prod
const WORKER_ENVIRONMENT = process.env.TRAINING_ENVIRONMENT || 'production';

// Worker state
let isRunning = true;
let isPaused = false;
let currentJobId = null;
let instanceSweeper = null;

/**
 * Alert ops via Telegram
 */
async function alertOps(message, data = {}) {
  const chatId = process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!chatId) {
    logger.warn('[VastAIWorker] No ops chat ID configured, logging alert:', message, data);
    return;
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.warn('[VastAIWorker] No Telegram bot token, cannot send alert');
      return;
    }

    const text = `🖥️ *VastAI Training Alert*\n\n${message}\n\n\`\`\`\n${JSON.stringify(data, null, 2)}\n\`\`\``;

    const fetch = (await import('node-fetch')).default;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    logger.error('[VastAIWorker] Failed to send ops alert:', err.message);
  }
}

/**
 * Alert user (placeholder - wire to your notification system)
 */
async function alertUser(userId, severity, message) {
  // TODO: Wire to TrainingNotifier or your notification system
  logger.info(`[VastAIWorker] User alert (${severity}): ${message} [user: ${userId}]`);
}

/**
 * Main worker loop
 */
async function runWorkerLoop(trainingDb, processor) {
  logger.info('═'.repeat(60));
  logger.info(`[VastAIWorker] STARTING WORKER`);
  logger.info(`[VastAIWorker] Environment filter: ${WORKER_ENVIRONMENT}`);
  logger.info(`[VastAIWorker] Only jobs with environment="${WORKER_ENVIRONMENT}" will be picked up`);
  logger.info('═'.repeat(60));
  let pollCount = 0;

  while (isRunning) {
    try {
      // Check if paused
      if (isPaused) {
        logger.debug('[VastAIWorker] Paused, waiting...');
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      pollCount++;
      // Log every 10 polls (5 minutes) to show we're alive
      if (pollCount % 10 === 0) {
        logger.info(`[VastAIWorker] Still polling for ${WORKER_ENVIRONMENT} jobs... (poll #${pollCount})`);
      }

      // Fetch next queued job matching our environment
      const job = await trainingDb.fetchNextQueued(WORKER_ENVIRONMENT);

      if (!job) {
        // No jobs, wait and poll again
        logger.debug('[VastAIWorker] No queued jobs found, waiting...');
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      logger.info(`[VastAIWorker] Found queued job: ${job._id} (${job.modelName}) env=${job.environment || 'UNSET'} retryCount=${job.retryCount || 0}`);

      // Attempt to claim the job (atomic)
      const claimedJob = await trainingDb.claimJob(job._id);

      if (!claimedJob) {
        // Another worker claimed it (shouldn't happen with single worker, but safe)
        logger.warn(`[VastAIWorker] Job ${job._id} already claimed, skipping`);
        continue;
      }

      currentJobId = job._id.toString();
      logger.info(`[VastAIWorker] Claimed job ${currentJobId}, processing...`);

      // Process the job
      const result = await processor.process(claimedJob);

      if (result.success) {
        logger.info(`[VastAIWorker] Job ${currentJobId} completed successfully`);
      } else {
        logger.error(`[VastAIWorker] Job ${currentJobId} failed: ${result.error}`);
      }

      currentJobId = null;

      // Brief cooldown before next job
      await sleep(POST_JOB_COOLDOWN_MS);

    } catch (err) {
      logger.error('[VastAIWorker] Error in worker loop:', err);
      await alertOps('Worker loop error', { error: err.message, stack: err.stack?.slice(0, 500) });

      // Wait before retrying
      await sleep(POLL_INTERVAL_MS);
    }
  }

  logger.info('[VastAIWorker] Worker loop stopped');
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Graceful shutdown handler
 */
function setupShutdownHandlers() {
  const shutdown = async (signal) => {
    logger.info(`[VastAIWorker] Received ${signal}, shutting down gracefully...`);
    isRunning = false;

    // Stop the instance sweeper
    if (instanceSweeper) {
      instanceSweeper.stop();
      logger.info('[VastAIWorker] Instance sweeper stopped');
    }

    if (currentJobId) {
      logger.warn(`[VastAIWorker] Job ${currentJobId} is in progress, waiting for completion...`);
      // The worker loop will finish the current job before exiting
      // Give it up to 10 minutes to finish (training can take a while)
      const maxWait = 10 * 60 * 1000;
      const startWait = Date.now();

      while (currentJobId && (Date.now() - startWait) < maxWait) {
        await sleep(5000);
      }

      if (currentJobId) {
        logger.error(`[VastAIWorker] Timeout waiting for job ${currentJobId}, forcing exit`);
        await alertOps('Worker forced shutdown', { jobId: currentJobId });
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Worker status endpoint (for deploy.sh integration)
 */
function getWorkerStatus() {
  return {
    status: isPaused ? 'paused' : (currentJobId ? 'busy' : 'idle'),
    activeJobId: currentJobId,
    isPaused,
    isRunning,
  };
}

/**
 * Pause/resume controls (for deploy.sh integration)
 */
function pauseWorker(reason = 'manual') {
  logger.info(`[VastAIWorker] Pausing worker: ${reason}`);
  isPaused = true;
}

function resumeWorker() {
  logger.info('[VastAIWorker] Resuming worker');
  isPaused = false;
}

// Export controls for external use
module.exports = {
  getWorkerStatus,
  pauseWorker,
  resumeWorker,
};

/**
 * Main entry point
 */
(async () => {
  try {
    logger.info('[VastAIWorker] Initializing...');

    // Initialize database
    await initializeDatabase();
    logger.info('[VastAIWorker] Database initialized');

    // Initialize services
    const trainingDb = new TrainingDB(logger);
    const datasetDb = new DatasetDB(logger);
    const generationOutputsDb = new GenerationOutputsDB(logger);
    const creditLedgerDb = new CreditLedgerDB(logger);

    const pointsService = new PointsService({
      creditLedgerDb,
    });

    const vastaiService = new VastAIService({
      logger,
      apiKey: process.env.VASTAI_API_KEY,
    });

    // Initialize VastAI client for sweeper
    const vastaiClient = new VastAIClient({
      apiKey: process.env.VASTAI_API_KEY,
      apiBaseUrl: 'https://console.vast.ai/api/v0',
      logger,
    });

    // Initialize instance sweeper (orphan cleanup)
    instanceSweeper = new InstanceSweeper({
      vastAIClient: vastaiClient,
      trainingDb,
      logger,
      sweepIntervalMs: 5 * 60 * 1000,  // Check every 5 minutes
      maxRuntimeMs: 4 * 60 * 60 * 1000, // 4 hour max runtime
      stuckThresholdMs: 2 * 60 * 60 * 1000, // 2 hours without update = stuck
      alertCallback: (type, data) => {
        alertOps(`Instance Sweeper: ${type}`, data);
      },
    });

    // Start the sweeper
    instanceSweeper.start();
    logger.info('[VastAIWorker] Instance sweeper started (5 min interval, 4h max runtime)');

    // Refresh the public LoRA trigger map cache after training completes
    const refreshLoraCache = async () => {
      logger.info('[VastAIWorker] Refreshing public LoRA trigger map cache...');
      await refreshPublicLoraCache();
      logger.info('[VastAIWorker] LoRA trigger map cache refreshed');
    };

    // Initialize processor
    const processor = new TrainingJobProcessor({
      logger,
      trainingDb,
      datasetDb,
      generationOutputsDb,
      pointsService,
      vastaiService,
      refreshLoraCache,
      alertOps,
      alertUser,
    });

    // Setup graceful shutdown
    setupShutdownHandlers();

    logger.info('[VastAIWorker] Worker initialized, starting loop...');

    // Start the worker loop
    await runWorkerLoop(trainingDb, processor);

  } catch (err) {
    logger.error('[VastAIWorker] Failed to start:', err);
    await alertOps('VastAI Worker failed to start', { error: err.message });
    process.exit(1);
  }
})();
