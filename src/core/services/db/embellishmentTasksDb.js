// src/core/services/db/embellishmentTasksDb.js
const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class EmbellishmentTasksDB
 *
 * Tracks embellishment tasks (caption generation, control image generation, etc.)
 * Separates transient task state from dataset documents for cleaner architecture.
 *
 * SCHEMA:
 * {
 *   _id: ObjectId,
 *   datasetId: ObjectId,              // FK to datasets
 *   ownerAccountId: ObjectId,         // Who initiated
 *
 *   // Task definition
 *   type: string,                     // 'caption' | 'control_image' | 'video' | 'audio' | ...
 *   spellSlug: string,
 *   parameterOverrides: Object,       // User-provided params
 *
 *   // Progress tracking
 *   status: string,                   // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
 *   totalItems: number,
 *   completedItems: number,
 *   failedItems: number,
 *
 *   // Per-item tracking
 *   items: [{
 *     index: number,                  // Image index in dataset
 *     castId: ObjectId,               // FK to casts (when cast starts)
 *     generationOutputId: ObjectId,   // FK to generationOutputs (when complete)
 *     status: string,                 // 'pending' | 'processing' | 'completed' | 'failed'
 *     retryCount: number,
 *     error: string,
 *     completedAt: Date
 *   }],
 *
 *   // Timestamps
 *   createdAt: Date,
 *   startedAt: Date,
 *   completedAt: Date,
 *
 *   // Result reference
 *   embellishmentId: ObjectId         // FK to dataset.embellishments[]._id (once complete)
 * }
 */
class EmbellishmentTasksDB extends BaseDB {
  constructor(logger) {
    super('embellishmentTasks');
    this.logger = logger || console;
  }

  /**
   * Create a new embellishment task
   */
  async createTask(data) {
    const now = new Date();

    if (!data.datasetId || !data.ownerAccountId || !data.type || !data.spellSlug) {
      throw new Error('datasetId, ownerAccountId, type, and spellSlug are required');
    }

    const payload = {
      datasetId: new ObjectId(data.datasetId),
      ownerAccountId: new ObjectId(data.ownerAccountId),
      type: data.type,
      spellSlug: data.spellSlug,
      parameterOverrides: data.parameterOverrides || {},
      status: 'pending',
      totalItems: data.totalItems || 0,
      completedItems: 0,
      failedItems: 0,
      items: data.items || [],
      createdAt: now,
      startedAt: null,
      completedAt: null,
      embellishmentId: null,
    };

    const result = await this.insertOne(payload);
    return result.insertedId ? { _id: result.insertedId, ...payload } : null;
  }

  /**
   * Find task by ID
   */
  async findById(taskId) {
    return this.findOne({ _id: new ObjectId(taskId) });
  }

  /**
   * Find running tasks for a dataset
   */
  async findRunningTasksForDataset(datasetId) {
    return this.findMany({
      datasetId: new ObjectId(datasetId),
      status: 'running'
    });
  }

  /**
   * Find all tasks for a user
   */
  async findTasksByOwner(ownerAccountId, options = {}) {
    const filter = { ownerAccountId: new ObjectId(ownerAccountId) };
    if (options.status) {
      filter.status = options.status;
    }
    return this.findMany(filter, { sort: { createdAt: -1 }, ...options });
  }

  /**
   * Update task status
   */
  async setStatus(taskId, status, extra = {}) {
    const update = {
      status,
      ...extra,
    };

    if (status === 'running' && !extra.startedAt) {
      update.startedAt = new Date();
    }
    if ((status === 'completed' || status === 'failed' || status === 'cancelled') && !extra.completedAt) {
      update.completedAt = new Date();
    }

    return this.updateOne(
      { _id: new ObjectId(taskId) },
      { $set: update }
    );
  }

  /**
   * Atomically set status only if current status matches expected
   * Returns true if update succeeded, false if status didn't match
   */
  async setStatusIfMatch(taskId, expectedStatus, newStatus, extra = {}) {
    const update = {
      status: newStatus,
      ...extra,
    };

    if (newStatus === 'running') {
      update.startedAt = new Date();
    }
    if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
      update.completedAt = new Date();
    }

    const result = await this.updateOne(
      { _id: new ObjectId(taskId), status: expectedStatus },
      { $set: update }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Update a specific item in the task
   */
  async updateItem(taskId, itemIndex, itemUpdate) {
    const setFields = {};
    for (const [key, value] of Object.entries(itemUpdate)) {
      setFields[`items.${itemIndex}.${key}`] = value;
    }

    return this.updateOne(
      { _id: new ObjectId(taskId) },
      { $set: setFields }
    );
  }

  /**
   * Mark an item as completed and increment completedItems counter
   */
  async completeItem(taskId, itemIndex, generationOutputId) {
    return this.updateOne(
      { _id: new ObjectId(taskId) },
      {
        $set: {
          [`items.${itemIndex}.status`]: 'completed',
          [`items.${itemIndex}.generationOutputId`]: new ObjectId(generationOutputId),
          [`items.${itemIndex}.completedAt`]: new Date(),
        },
        $inc: { completedItems: 1 }
      }
    );
  }

  /**
   * Mark an item as failed and increment failedItems counter
   */
  async failItem(taskId, itemIndex, error) {
    return this.updateOne(
      { _id: new ObjectId(taskId) },
      {
        $set: {
          [`items.${itemIndex}.status`]: 'failed',
          [`items.${itemIndex}.error`]: error,
        },
        $inc: {
          failedItems: 1,
          [`items.${itemIndex}.retryCount`]: 1
        }
      }
    );
  }

  /**
   * Get next pending items for processing (up to limit)
   */
  async getNextPendingItems(taskId, limit = 2) {
    const task = await this.findById(taskId);
    if (!task) return [];

    return task.items
      .filter(item => item.status === 'pending')
      .slice(0, limit);
  }

  /**
   * Set the embellishment reference once task completes
   */
  async setEmbellishmentId(taskId, embellishmentId) {
    return this.updateOne(
      { _id: new ObjectId(taskId) },
      { $set: { embellishmentId: new ObjectId(embellishmentId) } }
    );
  }

  /**
   * Find task by castId (for routing spell completions)
   */
  async findTaskByCastId(castId) {
    return this.findOne({
      'items.castId': new ObjectId(castId),
      status: 'running'
    });
  }
}

module.exports = EmbellishmentTasksDB;
