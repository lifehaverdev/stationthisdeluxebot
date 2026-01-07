#!/usr/bin/env node

/**
 * Enqueue cull-mode review queue entries for accepted pieces that lack cullStatus.
 *
 * Usage:
 *   ./run-with-env.sh node scripts/maintenance/enqueueCullQueue.js <collectionId>[,<collectionId>...] [moreIds...]
 *   ./run-with-env.sh node scripts/maintenance/enqueueCullQueue.js --all
 *
 * Options:
 *   --dry-run    Print what would be enqueued without writing to DB
 */

const { ObjectId } = require('mongodb');
const { getCachedClient } = require('../../src/core/services/db/utils/queue');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { include: [], dryRun: false, all: false };
  args.forEach(arg => {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--all') opts.all = true;
    else if (arg.trim()) opts.include.push(...arg.split(',').map(id => id.trim()).filter(Boolean));
  });
  return opts;
}

async function loadCollectionIds(db, opts) {
  if (opts.all || !opts.include.length) {
    const docs = await db.collection('collections').find({}, { projection: { collectionId: 1 } }).toArray();
    return docs.map(doc => doc.collectionId).filter(Boolean);
  }
  return opts.include;
}

function buildCullMatch(collectionId) {
  return {
    $and: [
      {
        $or: [
          { 'metadata.collectionId': collectionId },
          { collectionId }
        ]
      },
      { status: 'completed' },
      { deliveryStrategy: { $ne: 'spell_step' } },
      {
        $or: [
          { 'metadata.reviewOutcome': { $in: ['accepted', 'approved'] } },
          { reviewOutcome: { $in: ['accepted', 'approved'] } }
        ]
      },
      {
        $or: [
          { 'metadata.cullStatus': { $exists: false } },
          { 'metadata.cullStatus': { $in: ['', null, 'pending'] } },
          { cullStatus: { $exists: false } },
          { cullStatus: { $in: ['', null, 'pending'] } }
        ]
      }
    ]
  };
}

async function enqueueCullEntries(db, collectionId, { dryRun = false } = {}) {
  const generationOutputs = db.collection('generationOutputs');
  const reviewQueue = db.collection('collection_reviews');
  const match = buildCullMatch(collectionId);
  const cursor = generationOutputs.find(match, {
    projection: {
      _id: 1,
      masterAccountId: 1,
      requestTimestamp: 1,
      createdAt: 1,
      metadata: 1,
      deliveryStrategy: 1
    }
  });
  let enqueued = 0;
  const batch = [];
  const now = new Date();
  const flush = async () => {
    if (!batch.length || dryRun) return;
    await reviewQueue.insertMany(batch, { ordered: false });
    batch.length = 0;
  };

  for await (const doc of cursor) {
    const payload = {
      generationId: doc._id,
      collectionId,
      mode: 'cull',
      masterAccountId: doc.masterAccountId,
      status: 'pending',
      retryCount: 0,
      requestTimestamp: doc.requestTimestamp || doc.createdAt || now,
      createdAt: now,
      metadata: doc.metadata || {}
    };
    batch.push(payload);
    enqueued++;
    if (batch.length >= 500) {
      await flush();
    }
  }
  await flush();
  return enqueued;
}

async function main() {
  const opts = parseArgs();
  const client = await getCachedClient();
  const dbName = process.env.MONGO_DB_NAME || 'station';
  const db = client.db(dbName);
  const collectionIds = await loadCollectionIds(db, opts);
  if (!collectionIds.length) {
    console.log('No collections found.');
    return;
  }
  console.log(`Enqueueing cull entries for ${collectionIds.length} collection(s)…`);
  for (const collectionId of collectionIds) {
    try {
      const count = await enqueueCullEntries(db, collectionId, { dryRun: opts.dryRun });
      console.log(`${collectionId}: ${opts.dryRun ? 'would enqueue' : 'enqueued'} ${count}`);
    } catch (err) {
      console.error(`${collectionId}: failed ->`, err.message || err);
    }
  }
  console.log('Done.');
}

main().catch(err => {
  console.error('enqueueCullQueue failed:', err);
  process.exit(1);
});
