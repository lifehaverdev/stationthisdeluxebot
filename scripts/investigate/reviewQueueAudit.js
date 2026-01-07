#!/usr/bin/env node

/**
 * Investigates review coverage for one or more collections.
 * Usage:
 *   node scripts/investigate/reviewQueueAudit.js <collectionId>[,<collectionId>...] [--limit=10] [--stale=10]
 *
 * Environment:
 *   Uses the same Mongo connection helpers as the rest of the app (MONGO_URL, etc).
 */

const { ObjectId } = require('mongodb');
const { getCachedClient } = require('../../src/core/services/db/utils/queue');

const args = process.argv.slice(2);
const options = {
  sampleLimit: 10,
  staleMinutes: 15
};
const collectionInputs = [];

args.forEach(arg => {
  if (arg.startsWith('--limit=')) {
    const value = parseInt(arg.split('=')[1], 10);
    if (!Number.isNaN(value) && value > 0) {
      options.sampleLimit = value;
    }
  } else if (arg.startsWith('--stale=')) {
    const value = parseInt(arg.split('=')[1], 10);
    if (!Number.isNaN(value) && value > 0) {
      options.staleMinutes = value;
    }
  } else if (arg.trim()) {
    collectionInputs.push(arg.trim());
  }
});

const collectionIds = collectionInputs
  .join(',')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!collectionIds.length) {
  console.error('Usage: node scripts/investigate/reviewQueueAudit.js <collectionId>[,<collectionId>...] [--limit=10] [--stale=10]');
  process.exit(1);
}

function buildOutcomeClause(values = []) {
  const regexes = values.map(v => new RegExp(`^${v}$`, 'i'));
  return {
    $or: [
      { 'metadata.reviewOutcome': { $in: regexes } },
      { reviewOutcome: { $in: regexes } }
    ]
  };
}

function buildBaseClauses(collectionId) {
  return [
    {
      $or: [
        { 'metadata.collectionId': collectionId },
        { collectionId }
      ]
    },
    { status: 'completed' },
    { deliveryStrategy: { $ne: 'spell_step' } }
  ];
}

function fmtDate(value) {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString();
}

async function inspectCollection(db, collectionId, opts) {
  const generationOutputs = db.collection('generationOutputs');
  const reviewQueue = db.collection('collection_reviews');

  const baseClauses = buildBaseClauses(collectionId);
  const baseMatch = { $and: baseClauses };
  const acceptedClause = buildOutcomeClause(['accepted', 'approved']);
  const rejectedClause = buildOutcomeClause(['rejected']);

  const acceptedMatch = { $and: [...baseClauses, acceptedClause] };
  const rejectedMatch = { $and: [...baseClauses, rejectedClause] };
  const unreviewedMatch = { $and: [...baseClauses, { $nor: [acceptedClause, rejectedClause] }] };

  const [totalCompleted, acceptedCount, rejectedCount] = await Promise.all([
    generationOutputs.countDocuments(baseMatch),
    generationOutputs.countDocuments(acceptedMatch),
    generationOutputs.countDocuments(rejectedMatch)
  ]);
  const pendingCount = Math.max(0, totalCompleted - acceptedCount - rejectedCount);

  const queueEntries = await reviewQueue.find({ collectionId }).toArray();
  const queueByStatus = queueEntries.reduce((acc, entry) => {
    const status = (entry.status || 'unknown').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const now = Date.now();
  const staleThresholdMs = opts.staleMinutes * 60 * 1000;
  const staleAssignments = queueEntries
    .filter(entry => entry.status === 'in_progress' && entry.assignedAt)
    .filter(entry => now - new Date(entry.assignedAt).getTime() > staleThresholdMs);

  const notQueuedFacet = await generationOutputs.aggregate([
    { $match: unreviewedMatch },
    {
      $lookup: {
        from: 'collection_reviews',
        localField: '_id',
        foreignField: 'generationId',
        as: 'queueEntries'
      }
    },
    { $match: { queueEntries: { $eq: [] } } },
    {
      $facet: {
        count: [{ $count: 'value' }],
        samples: [
          { $sort: { requestTimestamp: 1 } },
          { $limit: opts.sampleLimit },
          {
            $project: {
              _id: 1,
              requestTimestamp: 1,
              createdAt: 1,
              'metadata.reviewOutcome': 1
            }
          }
        ]
      }
    }
  ]).toArray();
  const notQueuedCount = notQueuedFacet[0]?.count?.[0]?.value || 0;
  const samples = notQueuedFacet[0]?.samples || [];

  console.log(`\n=== Collection ${collectionId} ===`);
  console.log(`Completed pieces: ${totalCompleted}`);
  console.log(`  Accepted/Approved: ${acceptedCount}`);
  console.log(`  Rejected: ${rejectedCount}`);
  console.log(`  Pending review: ${pendingCount}`);
  console.log(`Review queue entries: ${queueEntries.length}`);
  Object.entries(queueByStatus)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`);
    });
  if (staleAssignments.length) {
    console.log(`  Stale in-progress (> ${opts.staleMinutes}m): ${staleAssignments.length}`);
    staleAssignments.slice(0, opts.sampleLimit).forEach(entry => {
      console.log(`    • ${entry.generationId} locked since ${fmtDate(entry.assignedAt)}`);
    });
  }
  console.log(`Unreviewed pieces not in queue: ${notQueuedCount}`);
  if (samples.length) {
    console.log(`  Sample missing pieces (showing up to ${opts.sampleLimit}):`);
    samples.forEach(doc => {
      const ts = fmtDate(doc.requestTimestamp || doc.createdAt);
      console.log(`    - ${doc._id} requested ${ts}`);
    });
  } else {
    console.log('  No obvious unqueued pieces found.');
  }
}

(async () => {
  try {
    const client = await getCachedClient();
    const dbName = process.env.MONGO_DB_NAME || 'station';
    const db = client.db(dbName);
    for (const collectionId of collectionIds) {
      await inspectCollection(db, collectionId, options);
    }
    process.exit(0);
  } catch (err) {
    console.error('Review queue audit failed:', err);
    process.exit(1);
  }
})();
