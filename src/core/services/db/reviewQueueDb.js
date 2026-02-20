const { BaseDB, ObjectId } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

class ReviewQueueDB extends BaseDB {
  constructor(logger) {
    super('collection_reviews');
    if (!logger) {
      // eslint-disable-next-line no-console
      console.warn('[ReviewQueueDB] Logger instance was not provided. Falling back to console.');
      this.logger = console;
    } else {
      this.logger = logger;
    }
  }

  async ensureIndexes() {
    try {
      const client = await getCachedClient();
      const collection = client.db(this.dbName).collection(this.collectionName);
      // Drop old single-field index if it exists (one-time migration)
      try {
        await collection.dropIndex('generation_unique');
        this.logger.debug('[ReviewQueueDB] Dropped old generation_unique index');
      } catch (dropErr) {
        // Index may not exist, that's fine
        if (dropErr.code !== 27) { // 27 = IndexNotFound
          this.logger.debug('[ReviewQueueDB] generation_unique index not found or already removed');
        }
      }
      await collection.createIndexes([
        {
          key: { generationId: 1, mode: 1 },
          unique: true,
          name: 'generation_mode_unique'
        },
        {
          key: { collectionId: 1, status: 1, requestTimestamp: 1 },
          name: 'collection_status_ts'
        },
        {
          key: { assignedTo: 1, status: 1, assignedAt: 1 },
          name: 'reviewer_status'
        }
      ]);
      this.logger.debug('[ReviewQueueDB] Indexes ensured.');
    } catch (err) {
      this.logger.error('[ReviewQueueDB] Failed to ensure indexes', err);
    }
  }

  async enqueueOrUpdate(entry = {}) {
    if (!entry.generationId) {
      throw new Error('generationId is required to enqueue review');
    }
    const generationId = typeof entry.generationId === 'string' && ObjectId.isValid(entry.generationId)
      ? new ObjectId(entry.generationId)
      : entry.generationId;
    const masterAccountId = entry.masterAccountId && ObjectId.isValid(entry.masterAccountId)
      ? new ObjectId(entry.masterAccountId)
      : entry.masterAccountId;

    const update = {
      $setOnInsert: {
        createdAt: new Date(),
        status: 'pending',
        retryCount: 0,
        mode: entry.mode === 'cull' ? 'cull' : 'review'
      },
      $set: {
        generationId,
        collectionId: entry.collectionId,
        masterAccountId: masterAccountId || null,
        requestTimestamp: entry.requestTimestamp ? new Date(entry.requestTimestamp) : new Date(),
        metadata: entry.metadata || {},
      },
      $unset: {
        assignedTo: '',
        assignedAt: '',
        decisionReason: '',
        reviewedAt: ''
      }
    };
    return this.updateOne({ generationId, mode: entry.mode === 'cull' ? 'cull' : 'review' }, update, { upsert: true });
  }

  async claimNextBatch({ collectionId, limit = 10, reviewerId, lockWindowMs = 5 * 60 * 1000, mode = 'review' }) {
    if (!collectionId) throw new Error('collectionId is required');
    const claimed = [];
    const reviewerObjectId = reviewerId && ObjectId.isValid(reviewerId) ? new ObjectId(reviewerId) : reviewerId;
    const now = new Date();
    const lockExpiration = new Date(Date.now() - lockWindowMs);
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);
    const query = {
      collectionId,
      mode: mode === 'cull' ? 'cull' : 'review',
      $or: [
        { status: 'pending' },
        { status: 'in_progress', assignedAt: { $lte: lockExpiration } }
      ]
    };

    while (claimed.length < limit) {
      const doc = await collection.findOneAndUpdate(
        query,
        {
          $set: {
            status: 'in_progress',
            assignedTo: reviewerObjectId || null,
            assignedAt: now
          },
          $inc: { retryCount: 1 }
        },
        {
          sort: { requestTimestamp: 1, _id: 1 },
          returnDocument: 'after'
        }
      );
      if (!doc) {
        break;
      }
      claimed.push(doc);
    }
    return claimed;
  }

  async commitDecisions(decisions = [], { reviewerId } = {}) {
    if (!Array.isArray(decisions) || !decisions.length) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const reviewerObjectId = reviewerId && ObjectId.isValid(reviewerId) ? new ObjectId(reviewerId) : reviewerId;
    const reviewedAt = new Date();
    const ops = decisions
      .filter(decision => decision.queueId && decision.outcome)
      .map(decision => {
        const filter = { _id: new ObjectId(decision.queueId) };
        if (reviewerObjectId) {
          filter.$or = [
            { assignedTo: reviewerObjectId },
            { assignedTo: null },
            { assignedTo: { $exists: false } }
          ];
        }
        return {
          updateOne: {
            filter,
            update: {
              $set: {
                status: decision.outcome,
                reviewedAt,
                decisionReason: decision.reason || null
              },
              $unset: {
                assignedAt: '',
                assignedTo: ''
              }
            }
          }
        };
      });

    if (!ops.length) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);
    const result = await collection.bulkWrite(ops, { ordered: false });
    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async releaseAssignments(queueIds = [], { reviewerId } = {}) {
    if (!Array.isArray(queueIds) || !queueIds.length) return 0;
    const ids = queueIds.map(id => new ObjectId(id));
    const filter = { _id: { $in: ids }, status: 'in_progress' };
    if (reviewerId && ObjectId.isValid(reviewerId)) {
      filter.assignedTo = new ObjectId(reviewerId);
    }
    const update = {
      $set: { status: 'pending' },
      $unset: { assignedTo: '', assignedAt: '' }
    };
    const result = await this.updateMany(filter, update);
    return result.modifiedCount || 0;
  }

  async getStats(collectionId) {
    const pipeline = [];
    if (collectionId) {
      pipeline.push({ $match: { collectionId } });
    }
    pipeline.push({
      $group: {
        _id: { collectionId: '$collectionId', status: '$status' },
        count: { $sum: 1 }
      }
    });
    return this.aggregate(pipeline);
  }
}

module.exports = ReviewQueueDB;
