const { v4: uuidv4 } = require('uuid');
const { EVENT_STATUS, PROCESSING_TIMEOUT_MS } = require('../../db/alchemy/webhookEventQueueDb');

// Worker configuration
const STUCK_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check for stuck events every 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup old events every hour
const SHUTDOWN_TIMEOUT_MS = 30 * 1000; // Wait up to 30 seconds for graceful shutdown

/**
 * CreditWorker
 *
 * An event-driven worker that processes webhook events from the MongoDB queue.
 *
 * Design: Hybrid event-driven with queue backup
 * - Normal flow: Webhook → enqueue → immediately trigger processNext()
 * - Restart flow: Drain pending events on startup → go idle
 * - Stuck recovery: Periodic check every 5 minutes
 *
 * NO continuous polling - the queue is for persistence during restarts,
 * not for decoupling via polling.
 */
class CreditWorker {
  constructor(webhookEventQueueDb, eventWebhookProcessor, logger) {
    this.webhookEventQueueDb = webhookEventQueueDb;
    this.eventWebhookProcessor = eventWebhookProcessor;
    this.logger = logger || console;

    // Generate a unique worker ID for this instance
    this.workerId = `worker-${uuidv4().slice(0, 8)}`;

    // State
    this.isRunning = false;
    this.isProcessing = false;
    this.currentEventId = null;

    // Intervals (no poll interval - event-driven)
    this.stuckCheckInterval = null;
    this.cleanupInterval = null;

    // Statistics
    this.stats = {
      processed: 0,
      failed: 0,
      startedAt: null,
      lastProcessedAt: null
    };

    this.logger.debug(`[CreditWorker] Initialized with worker ID: ${this.workerId}`);
  }

  /**
   * Starts the worker.
   * Drains any pending events from previous run, then goes idle.
   * No continuous polling - use triggerProcessing() after enqueueing.
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn(`[CreditWorker] Worker ${this.workerId} is already running`);
      return;
    }

    this.isRunning = true;
    this.stats.startedAt = new Date();

    this.logger.info(`[CreditWorker] Starting worker ${this.workerId} (event-driven mode, no polling)`);

    // Start stuck event recovery (periodic)
    this.stuckCheckInterval = setInterval(() => this.recoverStuckEvents(), STUCK_CHECK_INTERVAL_MS);

    // Start cleanup of old events (periodic)
    this.cleanupInterval = setInterval(() => this.cleanupOldEvents(), CLEANUP_INTERVAL_MS);

    // Drain any pending events from queue (from previous run / restart)
    this.logger.info(`[CreditWorker] Draining pending events from queue...`);
    const drained = await this.drainQueue();
    this.logger.info(`[CreditWorker] Drained ${drained} pending events from queue.`);

    // Run initial stuck recovery
    await this.recoverStuckEvents();

    this.logger.info(`[CreditWorker] Worker ${this.workerId} started successfully (idle, waiting for triggers)`);
  }

  /**
   * Drains all pending events from the queue.
   * Called on startup to process any events that accumulated during restart.
   * @returns {Promise<number>} Number of events processed
   */
  async drainQueue() {
    let processed = 0;

    while (this.isRunning) {
      const hadWork = await this.processNext();
      if (!hadWork) {
        break; // No more pending events
      }
      processed++;
    }

    return processed;
  }

  /**
   * Triggers processing of the next pending event.
   * Call this immediately after enqueueing an event for instant processing.
   * Safe to call multiple times - will process sequentially.
   * @returns {Promise<boolean>} True if an event was processed, false if queue empty
   */
  async triggerProcessing() {
    if (!this.isRunning) {
      this.logger.warn(`[CreditWorker] Cannot trigger processing - worker not running`);
      return false;
    }
    return this.processNext();
  }

  /**
   * Processes the next pending event from the queue.
   * @returns {Promise<boolean>} True if an event was processed, false if queue empty
   * @private
   */
  async processNext() {
    if (this.isProcessing) {
      // Already processing - will be called again after current event completes
      return false;
    }

    try {
      const event = await this.webhookEventQueueDb.claimNext(this.workerId);

      if (!event) {
        return false; // No events available
      }

      await this.processEvent(event);
      return true;
    } catch (error) {
      this.logger.error(`[CreditWorker] Error during processNext:`, error);
      return false;
    }
  }

  /**
   * Stops the worker gracefully.
   * Waits for current processing to complete.
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.logger.info(`[CreditWorker] Stopping worker ${this.workerId}...`);
    this.isRunning = false;

    // Clear intervals
    if (this.stuckCheckInterval) {
      clearInterval(this.stuckCheckInterval);
      this.stuckCheckInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Wait for current processing to complete
    if (this.isProcessing) {
      this.logger.info(`[CreditWorker] Waiting for current event to finish processing...`);
      const startWait = Date.now();

      while (this.isProcessing && Date.now() - startWait < SHUTDOWN_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.isProcessing) {
        this.logger.warn(`[CreditWorker] Shutdown timeout reached, current event ${this.currentEventId} may be orphaned`);
      }
    }

    this.logger.info(`[CreditWorker] Worker ${this.workerId} stopped. Stats: ${JSON.stringify(this.stats)}`);
  }

  /**
   * Processes a single event.
   * @param {object} event - The event document from the queue
   * @private
   */
  async processEvent(event) {
    this.isProcessing = true;
    this.currentEventId = event._id;

    const startTime = Date.now();
    this.logger.info(`[CreditWorker] Processing event ${event._id} (type: ${event.event_type}, attempt: ${event.attempts})`);

    try {
      // Route to appropriate processor based on event type
      let result;

      switch (event.event_type) {
        case 'credit_webhook':
          result = await this.eventWebhookProcessor.processWebhook(event.payload);
          break;

        case 'withdrawal_webhook':
          // If you have a separate withdrawal processor, add it here
          result = await this.eventWebhookProcessor.processWebhook(event.payload);
          break;

        default:
          throw new Error(`Unknown event type: ${event.event_type}`);
      }

      // Check if processing was successful
      if (result && result.success === false) {
        throw new Error(result.message || 'Processing returned failure status');
      }

      // Mark as completed
      await this.webhookEventQueueDb.markCompleted(event._id, {
        message: result?.message || 'Processed successfully',
        detail: result?.detail,
        duration_ms: Date.now() - startTime
      });

      this.stats.processed++;
      this.stats.lastProcessedAt = new Date();

      this.logger.info(`[CreditWorker] Event ${event._id} processed successfully in ${Date.now() - startTime}ms`);

    } catch (error) {
      this.stats.failed++;

      this.logger.error(`[CreditWorker] Event ${event._id} failed:`, error.message);

      // Mark as failed (will be retried based on attempt count)
      try {
        await this.webhookEventQueueDb.markFailed(event._id, error.message);
      } catch (markError) {
        this.logger.error(`[CreditWorker] Failed to mark event ${event._id} as failed:`, markError);
      }
    } finally {
      this.isProcessing = false;
      this.currentEventId = null;
    }
  }

  /**
   * Recovers events stuck in processing state.
   * @private
   */
  async recoverStuckEvents() {
    try {
      const result = await this.webhookEventQueueDb.requeueStuckEvents();
      if (result.requeued > 0) {
        this.logger.info(`[CreditWorker] Recovered ${result.requeued} stuck events`);
      }
    } catch (error) {
      this.logger.error(`[CreditWorker] Error recovering stuck events:`, error);
    }
  }

  /**
   * Cleans up old completed/dead events.
   * @private
   */
  async cleanupOldEvents() {
    try {
      const result = await this.webhookEventQueueDb.cleanupOldEvents();
      if (result.deleted > 0) {
        this.logger.info(`[CreditWorker] Cleaned up ${result.deleted} old events`);
      }
    } catch (error) {
      this.logger.error(`[CreditWorker] Error cleaning up old events:`, error);
    }
  }

  /**
   * Gets worker statistics.
   * @returns {object}
   */
  getStats() {
    return {
      ...this.stats,
      workerId: this.workerId,
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      currentEventId: this.currentEventId,
      uptime: this.stats.startedAt ? Date.now() - this.stats.startedAt.getTime() : 0
    };
  }

  /**
   * Gets queue statistics.
   * @returns {Promise<object>}
   */
  async getQueueStats() {
    return this.webhookEventQueueDb.getQueueStats();
  }
}

module.exports = CreditWorker;
