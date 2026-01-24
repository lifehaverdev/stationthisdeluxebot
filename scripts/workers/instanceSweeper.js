#!/usr/bin/env node
/**
 * VastAI Instance Sweeper
 *
 * Safety net that runs every 15 minutes to catch orphaned instances.
 * Separate from the worker so it runs even if worker crashes.
 *
 * Finds and cleans up:
 * 1. Orphan instances - Jobs marked done but instance still running
 * 2. Stuck jobs - Jobs in active state with no update in 2+ hours
 *
 * Run via cron or pm2 scheduler:
 *   (every 15 min) node /path/to/instanceSweeper.js
 *   or
 *   pm2 start instanceSweeper.js --cron "every 15 minutes"
 */

const { initializeDatabase } = require('../../src/core/initDB');
const { createLogger } = require('../../src/utils/logger');
const TrainingDB = require('../../src/core/services/db/trainingDb');
const VastAIService = require('../../src/core/services/vastai/VastAIService');

const logger = createLogger('InstanceSweeper');

// Stale threshold for stuck jobs (2 hours)
const STUCK_JOB_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// Termination retry settings
const MAX_TERMINATION_ATTEMPTS = 5;
const TERMINATION_BACKOFF = [5, 15, 30, 60, 120]; // seconds

/**
 * Alert ops via Telegram
 */
async function alertOps(message, data = {}) {
  const chatId = process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!chatId) {
    logger.warn('[Sweeper] No ops chat ID configured, logging alert:', message, data);
    return;
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.warn('[Sweeper] No Telegram bot token, cannot send alert');
      return;
    }

    const severity = data.severity || 'warning';
    const emoji = severity === 'critical' ? '🚨' : '⚠️';
    const text = `${emoji} *Instance Sweeper Alert*\n\n${message}\n\n\`\`\`\n${JSON.stringify(data, null, 2)}\n\`\`\``;

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
    logger.error('[Sweeper] Failed to send ops alert:', err.message);
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Terminate instance with retry
 */
async function terminateWithRetry(vastaiService, trainingDb, instanceId, jobId) {
  for (let attempt = 1; attempt <= MAX_TERMINATION_ATTEMPTS; attempt++) {
    try {
      logger.info(`[Sweeper] Terminating instance ${instanceId} (attempt ${attempt})`);
      await vastaiService.terminateInstance(instanceId);
      await trainingDb.markInstanceTerminated(jobId, attempt);
      logger.info(`[Sweeper] Instance ${instanceId} terminated successfully`);
      return true;

    } catch (err) {
      logger.error(`[Sweeper] Termination attempt ${attempt} failed: ${err.message}`);
      await trainingDb.incrementTerminationAttempts(jobId);

      if (attempt === MAX_TERMINATION_ATTEMPTS) {
        await alertOps('CRITICAL: Instance termination failed after all retries', {
          severity: 'critical',
          instanceId,
          jobId: jobId.toString(),
          attempts: MAX_TERMINATION_ATTEMPTS,
          error: err.message,
        });
        return false;
      }

      await sleep(TERMINATION_BACKOFF[attempt - 1] * 1000);
    }
  }

  return false;
}

/**
 * Check if instance is actually running via VastAI API
 */
async function isInstanceRunning(vastaiService, instanceId) {
  try {
    const instance = await vastaiService.getInstance(instanceId);
    // VastAI status can be 'running', 'exited', 'created', etc.
    return instance && (instance.actual_status === 'running' || instance.cur_state === 'running');
  } catch (err) {
    // If we can't get the instance, assume it's not running
    logger.warn(`[Sweeper] Could not check instance ${instanceId}: ${err.message}`);
    return false;
  }
}

/**
 * Sweep for orphan instances
 * Jobs that are COMPLETED or FAILED but instance still running
 */
async function sweepOrphanInstances(trainingDb, vastaiService) {
  logger.info('[Sweeper] Checking for orphan instances...');

  const orphanCandidates = await trainingDb.findOrphanCandidates();
  logger.info(`[Sweeper] Found ${orphanCandidates.length} orphan candidates`);

  let cleanedCount = 0;

  for (const job of orphanCandidates) {
    const instanceId = job.vastaiInstanceId;
    const jobId = job._id;

    // Verify instance is actually running
    const running = await isInstanceRunning(vastaiService, instanceId);

    if (running) {
      logger.warn(`[Sweeper] ORPHAN DETECTED: Job ${jobId} is ${job.status} but instance ${instanceId} is still running`);

      await alertOps('Orphan instance detected', {
        severity: 'critical',
        jobId: jobId.toString(),
        instanceId,
        jobStatus: job.status,
        completedAt: job.completedAt,
      });

      // Terminate the instance
      const terminated = await terminateWithRetry(vastaiService, trainingDb, instanceId, jobId);

      if (terminated) {
        cleanedCount++;
      }
    } else {
      // Instance not running, just mark it as terminated
      logger.info(`[Sweeper] Instance ${instanceId} for job ${jobId} is already stopped, marking terminated`);
      await trainingDb.markInstanceTerminated(jobId, 0);
    }
  }

  logger.info(`[Sweeper] Orphan sweep complete. Cleaned: ${cleanedCount}`);
  return cleanedCount;
}

/**
 * Sweep for stuck jobs
 * Jobs in active state with no update for too long
 */
async function sweepStuckJobs(trainingDb, vastaiService) {
  logger.info('[Sweeper] Checking for stuck jobs...');

  const stuckJobs = await trainingDb.findStuckJobs(STUCK_JOB_THRESHOLD_MS);
  logger.info(`[Sweeper] Found ${stuckJobs.length} stuck jobs`);

  let cleanedCount = 0;

  for (const job of stuckJobs) {
    const jobId = job._id;
    const instanceId = job.vastaiInstanceId;
    const lastUpdate = job.updatedAt;
    const staleDuration = Date.now() - new Date(lastUpdate).getTime();
    const staleHours = (staleDuration / (1000 * 60 * 60)).toFixed(1);

    logger.warn(`[Sweeper] STUCK JOB: ${jobId} in ${job.status} state, stale for ${staleHours} hours`);

    await alertOps('Stuck job detected', {
      severity: 'warning',
      jobId: jobId.toString(),
      status: job.status,
      instanceId,
      lastUpdate: lastUpdate.toISOString(),
      staleHours,
    });

    // If there's an instance, try to terminate it
    if (instanceId) {
      const running = await isInstanceRunning(vastaiService, instanceId);

      if (running) {
        logger.info(`[Sweeper] Terminating instance ${instanceId} for stuck job ${jobId}`);
        await terminateWithRetry(vastaiService, trainingDb, instanceId, jobId);
      }
    }

    // Mark job as failed
    await trainingDb.markFailed(jobId, 'stuck_sweeper_cleanup', {
      failureReason: `Job stuck in ${job.status} for ${staleHours} hours, cleaned up by sweeper`,
    });

    cleanedCount++;
  }

  logger.info(`[Sweeper] Stuck job sweep complete. Cleaned: ${cleanedCount}`);
  return cleanedCount;
}

/**
 * Main sweep function
 */
async function runSweep() {
  logger.info('[Sweeper] Starting sweep...');
  const startTime = Date.now();

  try {
    // Initialize database
    await initializeDatabase();

    // Initialize services
    const trainingDb = new TrainingDB(logger);
    const vastaiService = new VastAIService({
      logger,
      apiKey: process.env.VASTAI_API_KEY,
    });

    // Run sweeps
    const orphansCleaned = await sweepOrphanInstances(trainingDb, vastaiService);
    const stuckCleaned = await sweepStuckJobs(trainingDb, vastaiService);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[Sweeper] Sweep complete in ${duration}s. Orphans: ${orphansCleaned}, Stuck: ${stuckCleaned}`);

    // Alert if anything was cleaned
    if (orphansCleaned > 0 || stuckCleaned > 0) {
      await alertOps('Sweeper cleanup summary', {
        severity: 'warning',
        orphansCleaned,
        stuckCleaned,
        durationSeconds: parseFloat(duration),
      });
    }

    return { orphansCleaned, stuckCleaned };

  } catch (err) {
    logger.error('[Sweeper] Sweep failed:', err);
    await alertOps('Sweeper failed', {
      severity: 'critical',
      error: err.message,
      stack: err.stack?.slice(0, 500),
    });
    throw err;
  }
}

/**
 * Main entry point
 */
(async () => {
  try {
    await runSweep();
    process.exit(0);
  } catch (err) {
    logger.error('[Sweeper] Fatal error:', err);
    process.exit(1);
  }
})();

// Export for testing
module.exports = {
  runSweep,
  sweepOrphanInstances,
  sweepStuckJobs,
};
