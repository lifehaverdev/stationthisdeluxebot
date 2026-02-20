const { BaseDB, ObjectId } = require('../BaseDB');
const { PRIORITY } = require('../utils/queue');
const { getCachedClient } = require('../utils/queue');

const COLLECTION_NAME = 'webhook_event_queue';

// Event statuses
const EVENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead' // Permanently failed after max retries
};

// Configuration
const MAX_RETRY_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes - if event is "processing" longer than this, it's stuck
const RETRY_DELAY_BASE_MS = 5000; // 5 seconds base, exponential backoff

/**
 * WebhookEventQueueDb
 *
 * A simple MongoDB-backed job queue for webhook events.
 * Provides atomic claim operations to prevent double-processing.
 */
class WebhookEventQueueDb extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
  }

  /**
   * Enqueues a webhook event for processing.
   * This should be called immediately when a webhook is received.
   * @param {string} eventType - Type of event (e.g., 'credit_webhook', 'withdrawal_webhook')
   * @param {object} payload - The raw webhook payload
   * @param {object} metadata - Optional metadata (source IP, headers, etc.)
   * @returns {Promise<{insertedId: ObjectId}>}
   */
  async enqueue(eventType, payload, metadata = {}) {
    const event = {
      event_type: eventType,
      payload: payload,
      metadata: metadata,
      status: EVENT_STATUS.PENDING,
      attempts: 0,
      max_attempts: MAX_RETRY_ATTEMPTS,
      created_at: new Date(),
      updated_at: new Date(),
      next_retry_at: new Date(), // Can be processed immediately
      claimed_at: null,
      completed_at: null,
      last_error: null,
      processing_history: []
    };

    const result = await this.insertOne(event, false, PRIORITY.CRITICAL);
    this.logger.debug(`[WebhookEventQueueDb] Enqueued event ${result.insertedId} of type ${eventType}`);
    return result;
  }

  /**
   * Atomically claims the next pending event for processing.
   * Uses findOneAndUpdate to prevent race conditions.
   * @param {string} workerId - Identifier for the worker claiming the event
   * @returns {Promise<object|null>} The claimed event, or null if none available
   */
  async claimNext(workerId) {
    const now = new Date();

    // Find and claim a pending event that's ready for processing
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);

    const result = await collection.findOneAndUpdate(
      {
        status: EVENT_STATUS.PENDING,
        next_retry_at: { $lte: now }
      },
      {
        $set: {
          status: EVENT_STATUS.PROCESSING,
          claimed_at: now,
          updated_at: now,
          claimed_by: workerId
        },
        $inc: { attempts: 1 },
        $push: {
          processing_history: {
            action: 'claimed',
            worker_id: workerId,
            timestamp: now
          }
        }
      },
      {
        returnDocument: 'after',
        sort: { created_at: 1 } // Process oldest first (FIFO)
      }
    );

    if (result) {
      this.logger.debug(`[WebhookEventQueueDb] Worker ${workerId} claimed event ${result._id} (attempt ${result.attempts})`);
    }

    return result;
  }

  /**
   * Marks an event as successfully completed.
   * @param {ObjectId|string} eventId - The event ID
   * @param {object} result - Optional result data to store
   * @returns {Promise<object>}
   */
  async markCompleted(eventId, result = {}) {
    const id = typeof eventId === 'string' ? new ObjectId(eventId) : eventId;
    const now = new Date();

    const updateResult = await this.updateOne(
      { _id: id },
      {
        $set: {
          status: EVENT_STATUS.COMPLETED,
          completed_at: now,
          updated_at: now,
          result: result
        },
        $push: {
          processing_history: {
            action: 'completed',
            timestamp: now,
            result_summary: result.message || 'Success'
          }
        }
      }
    );

    this.logger.debug(`[WebhookEventQueueDb] Event ${eventId} marked as completed`);
    return updateResult;
  }

  /**
   * Marks an event as failed. Will be retried if attempts < max_attempts.
   * @param {ObjectId|string} eventId - The event ID
   * @param {string} error - The error message
   * @param {boolean} permanent - If true, mark as DEAD (no more retries)
   * @returns {Promise<object>}
   */
  async markFailed(eventId, error, permanent = false) {
    const id = typeof eventId === 'string' ? new ObjectId(eventId) : eventId;
    const now = new Date();

    // Get current event to check attempts
    const event = await this.findOne({ _id: id });
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    const attemptsExhausted = event.attempts >= event.max_attempts;
    const shouldDie = permanent || attemptsExhausted;

    // Calculate exponential backoff for retry
    const backoffMs = RETRY_DELAY_BASE_MS * Math.pow(2, event.attempts - 1);
    const nextRetryAt = new Date(now.getTime() + backoffMs);

    const newStatus = shouldDie ? EVENT_STATUS.DEAD : EVENT_STATUS.PENDING;

    const updateResult = await this.updateOne(
      { _id: id },
      {
        $set: {
          status: newStatus,
          updated_at: now,
          last_error: error,
          next_retry_at: shouldDie ? null : nextRetryAt,
          claimed_at: null,
          claimed_by: null
        },
        $push: {
          processing_history: {
            action: shouldDie ? 'dead' : 'failed',
            timestamp: now,
            error: error,
            next_retry_at: shouldDie ? null : nextRetryAt
          }
        }
      }
    );

    if (shouldDie) {
      this.logger.error(`[WebhookEventQueueDb] Event ${eventId} marked as DEAD after ${event.attempts} attempts: ${error}`);
    } else {
      this.logger.warn(`[WebhookEventQueueDb] Event ${eventId} failed (attempt ${event.attempts}), will retry at ${nextRetryAt.toISOString()}: ${error}`);
    }

    return updateResult;
  }

  /**
   * Finds events that have been stuck in "processing" status for too long.
   * These are likely from crashed workers.
   * @returns {Promise<Array>}
   */
  async findStuckEvents() {
    const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);

    return this.findMany({
      status: EVENT_STATUS.PROCESSING,
      claimed_at: { $lt: cutoff }
    });
  }

  /**
   * Requeues stuck events back to pending status.
   * Should be called periodically to recover from worker crashes.
   * @returns {Promise<{requeued: number}>}
   */
  async requeueStuckEvents() {
    const stuckEvents = await this.findStuckEvents();

    if (stuckEvents.length === 0) {
      return { requeued: 0 };
    }

    this.logger.warn(`[WebhookEventQueueDb] Found ${stuckEvents.length} stuck events, requeuing...`);

    let requeued = 0;
    for (const event of stuckEvents) {
      try {
        await this.markFailed(event._id, 'Worker timeout - event was stuck in processing state');
        requeued++;
      } catch (error) {
        this.logger.error(`[WebhookEventQueueDb] Failed to requeue stuck event ${event._id}:`, error);
      }
    }

    this.logger.debug(`[WebhookEventQueueDb] Requeued ${requeued} stuck events`);
    return { requeued };
  }

  /**
   * Gets queue statistics for monitoring.
   * @returns {Promise<object>}
   */
  async getQueueStats() {
    const stats = await this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
      total: 0
    };

    for (const stat of stats) {
      result[stat._id] = stat.count;
      result.total += stat.count;
    }

    return result;
  }

  /**
   * Cleans up old completed events to prevent unbounded growth.
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 7 days)
   * @returns {Promise<{deleted: number}>}
   */
  async cleanupOldEvents(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs);

    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);

    const result = await collection.deleteMany({
      status: { $in: [EVENT_STATUS.COMPLETED, EVENT_STATUS.DEAD] },
      updated_at: { $lt: cutoff }
    });

    if (result.deletedCount > 0) {
      this.logger.debug(`[WebhookEventQueueDb] Cleaned up ${result.deletedCount} old events`);
    }

    return { deleted: result.deletedCount };
  }
}

module.exports = {
  WebhookEventQueueDb,
  EVENT_STATUS,
  MAX_RETRY_ATTEMPTS,
  PROCESSING_TIMEOUT_MS
};
