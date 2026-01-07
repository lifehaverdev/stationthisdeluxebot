const { ObjectId } = require('mongodb');
const { getCachedClient } = require('../db/utils/queue');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('ReviewResetService');

function normalizeOwnerMatch(userId) {
    if (!userId) return null;
    const matches = [];
    if (ObjectId.isValid(userId)) {
        matches.push({ masterAccountId: new ObjectId(userId) });
    }
    matches.push({ masterAccountId: userId });
    return { $or: matches };
}

function normalizeMasterAccountId(value) {
    if (!value) return null;
    if (value instanceof ObjectId) return value;
    if (ObjectId.isValid(value)) {
        try {
            return new ObjectId(value);
        } catch (_) {
            return value;
        }
    }
    return value;
}

function buildMetadata(doc) {
    const meta = doc.metadata && typeof doc.metadata === 'object'
        ? { ...doc.metadata }
        : {};
    if (doc.deliveryStrategy && !meta.deliveryStrategy) {
        meta.deliveryStrategy = doc.deliveryStrategy;
    }
    return meta;
}

async function resetCollectionReviews({ collectionId, userId = null } = {}) {
    if (!collectionId) {
        throw new Error('collectionId is required');
    }
    const client = await getCachedClient();
    const dbName = process.env.MONGO_DB_NAME || 'station';
    const db = client.db(dbName);
    const generationOutputs = db.collection('generationOutputs');
    const reviewQueue = db.collection('collection_reviews');

    const baseMatch = [
        {
            $or: [
                { 'metadata.collectionId': collectionId },
                { collectionId }
            ]
        },
        { status: 'completed' },
        { deliveryStrategy: { $ne: 'spell_step' } }
    ];
    const ownerMatch = normalizeOwnerMatch(userId);
    if (ownerMatch) {
        baseMatch.push(ownerMatch);
    }
    const matchFilter = { $and: baseMatch };

    const unsetFields = {
        'metadata.reviewOutcome': '',
        reviewOutcome: '',
        'metadata.cullStatus': '',
        cullStatus: '',
        'metadata.cullReviewedAt': '',
        'metadata.exportExcluded': '',
        exportExcluded: ''
    };

    const updateResult = await generationOutputs.updateMany(matchFilter, { $unset: unsetFields });
    const deleteResult = await reviewQueue.deleteMany({ collectionId });

    const cursor = generationOutputs.find(matchFilter, {
        projection: {
            _id: 1,
            masterAccountId: 1,
            requestTimestamp: 1,
            createdAt: 1,
            metadata: 1,
            deliveryStrategy: 1
        }
    });

    const batch = [];
    const now = new Date();
    let inserted = 0;
    const flushBatch = async () => {
        if (!batch.length) return;
        await reviewQueue.insertMany(batch, { ordered: false });
        inserted += batch.length;
        batch.length = 0;
    };

    for await (const doc of cursor) {
        const requestTimestamp = doc.requestTimestamp || doc.createdAt || now;
        batch.push({
            generationId: doc._id,
            collectionId,
            masterAccountId: normalizeMasterAccountId(doc.masterAccountId),
            status: 'pending',
            retryCount: 0,
            requestTimestamp,
            createdAt: now,
            metadata: buildMetadata(doc)
        });
        if (batch.length >= 500) {
            await flushBatch();
        }
    }
    await flushBatch();

    logger.info(
        `[ReviewResetService] Collection ${collectionId}: cleared ${updateResult.modifiedCount} outputs, removed ${deleteResult.deletedCount} queue rows, enqueued ${inserted}`
    );

    return {
        resetCount: updateResult.modifiedCount,
        removedQueueCount: deleteResult.deletedCount,
        enqueuedCount: inserted
    };
}

module.exports = {
    resetCollectionReviews
};
