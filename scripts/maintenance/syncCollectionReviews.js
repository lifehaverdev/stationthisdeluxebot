#!/usr/bin/env node

/**
 * Reconcile generationOutputs and collection_reviews without resetting review history.
 *
 * For each specified collection, the script:
 *   • updates generation docs whose queue status already has an accepted/rejected decision
 *   • removes queue rows whose doc already carries the same decision (to avoid duplicate work)
 *   • ensures undecided generations have pending queue entries
 *
 * Usage:
 *   ./run-with-env.sh node scripts/maintenance/syncCollectionReviews.js <collectionId>[,<collectionId>...] [moreIds...]
 *   ./run-with-env.sh node scripts/maintenance/syncCollectionReviews.js --all (scans every collection)
 */

const { ObjectId } = require('mongodb');
const { getCachedClient } = require('../../src/core/services/db/utils/queue');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { include: [], dryRun: false };
  if (!args.length) return opts;
  if (args.includes('--all')) {
    opts.all = true;
  }
  if (args.includes('--dry-run')) {
    opts.dryRun = true;
  }
  const joined = args.filter(arg => !arg.startsWith('--')).join(',');
  opts.include = joined
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  return opts;
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

function buildOutcomeClause(values = []) {
  const regexes = values.map(v => new RegExp(`^${v}$`, 'i'));
  return {
    $or: [
      { 'metadata.reviewOutcome': { $in: regexes } },
      { reviewOutcome: { $in: regexes } }
    ]
  };
}

function normalizeOutcome(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

async function loadCollectionIds(opts, db) {
  if (opts.all || !opts.include.length) {
    const docs = await db.collection('collections').find({}, { projection: { collectionId: 1 } }).toArray();
    return docs.map(doc => doc.collectionId).filter(Boolean);
  }
  return opts.include;
}

async function syncCollection(db, collectionId, { dryRun = false } = {}) {
  const generationOutputs = db.collection('generationOutputs');
  const reviewQueue = db.collection('collection_reviews');

  const baseMatch = buildBaseClauses(collectionId);
  const acceptedClause = buildOutcomeClause(['accepted', 'approved']);
  const rejectedClause = buildOutcomeClause(['rejected']);

  const acceptedMatch = { $and: [...baseMatch, acceptedClause] };
  const rejectedMatch = { $and: [...baseMatch, rejectedClause] };
  const undecidedMatch = { $and: [...baseMatch, { $nor: [acceptedClause, rejectedClause] }] };

  const [queueEntries, undecidedDocs] = await Promise.all([
    reviewQueue.find({ collectionId }).toArray(),
    generationOutputs.find(undecidedMatch, {
      projection: {
        _id: 1,
        masterAccountId: 1,
        requestTimestamp: 1,
        createdAt: 1,
        metadata: 1,
        deliveryStrategy: 1
      }
    }).toArray()
  ]);

  let syncedAccepted = 0;
  let syncedRejected = 0;
  let removedQueue = 0;
  const now = new Date();

  for (const entry of queueEntries) {
    const generationId = entry.generationId && ObjectId.isValid(entry.generationId)
      ? new ObjectId(entry.generationId)
      : entry.generationId;
    const queueOutcome = normalizeOutcome(entry.status);
    if (queueOutcome === 'accepted' || queueOutcome === 'approved') {
      if (!dryRun) {
        await generationOutputs.updateOne({ _id: generationId }, {
          $set: {
            'metadata.reviewOutcome': 'accepted',
            reviewOutcome: 'accepted'
          }
        });
      }
      syncedAccepted++;
    } else if (queueOutcome === 'rejected') {
      if (!dryRun) {
        await generationOutputs.updateOne({ _id: generationId }, {
          $set: {
            'metadata.reviewOutcome': 'rejected',
            reviewOutcome: 'rejected'
          }
        });
      }
      syncedRejected++;
    }
    if (queueOutcome === 'accepted' || queueOutcome === 'approved' || queueOutcome === 'rejected') {
      if (!dryRun) {
        await reviewQueue.deleteOne({ _id: entry._id });
      }
      removedQueue++;
    }
  }

  const pendingEntries = new Set(
    queueEntries
      .filter(entry => ['pending', 'in_progress'].includes(normalizeOutcome(entry.status)))
      .map(entry => (entry.generationId || '').toString())
  );

  let inserted = 0;
  const newRows = [];
  for (const doc of undecidedDocs) {
    const genId = doc._id.toString();
    if (pendingEntries.has(genId)) continue;
    newRows.push({
      generationId: doc._id,
      collectionId,
      masterAccountId: doc.masterAccountId,
      status: 'pending',
      retryCount: 0,
      requestTimestamp: doc.requestTimestamp || doc.createdAt || now,
      createdAt: now,
      metadata: doc.metadata || {}
    });
    if (!dryRun && newRows.length >= 500) {
      await reviewQueue.insertMany(newRows, { ordered: false });
      inserted += newRows.length;
      newRows.length = 0;
    } else if (dryRun && newRows.length >= 500) {
      inserted += newRows.length;
      newRows.length = 0;
    }
  }
  if (newRows.length) {
    if (!dryRun) {
      await reviewQueue.insertMany(newRows, { ordered: false });
      inserted += newRows.length;
    } else {
      inserted += newRows.length;
    }
  }

  return {
    collectionId,
    syncedAccepted,
    syncedRejected,
    removedQueue,
    enqueuedPending: inserted
  };
}

async function main() {
  const args = parseArgs();
  const client = await getCachedClient();
  const dbName = process.env.MONGO_DB_NAME || 'station';
  const db = client.db(dbName);

  const collectionIds = await loadCollectionIds(args, db);
  if (!collectionIds.length) {
    console.log('No collections to process.');
    return;
  }
  console.log(`Synchronizing ${collectionIds.length} collection(s)…`);
  const results = [];
  for (const id of collectionIds) {
    try {
      const result = await syncCollection(db, id, { dryRun: args.dryRun });
      console.log(result);
      results.push(result);
    } catch (err) {
      console.error(`Failed to sync ${id}:`, err.message || err);
    }
  }
  console.log('\nSummary:', results);
}

main().catch(err => {
  console.error('syncCollectionReviews failed:', err);
  process.exit(1);
});
