#!/usr/bin/env node

/**
 * Summarize cull state for one or more collections.
 *
 * Usage:
 *   ./run-with-env.sh node scripts/investigate/reviewCullAudit.js <collectionId>[,<collectionId>...]
 */

const { getCachedClient } = require('../../src/core/services/db/utils/queue');

function parseIds(args) {
  const joined = args.join(',');
  return joined
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function fmt(num) {
  return typeof num === 'number' ? num : 0;
}

async function auditCollection(db, collectionId) {
  const generationOutputs = db.collection('generationOutputs');
  const baseMatch = [
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
    }
  ];
  const match = { $and: baseMatch };

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$metadata.cullStatus',
        count: { $sum: 1 }
      }
    }
  ];

  const totals = await generationOutputs.countDocuments(match);
  const grouped = await generationOutputs.aggregate(pipeline).toArray();
  const counts = grouped.reduce((acc, entry) => {
    const key = (entry._id || 'pending').toLowerCase();
    acc[key] = entry.count;
    return acc;
  }, {});

  const excludedCount = await generationOutputs.countDocuments({
    $and: [...baseMatch, {
      $or: [
        { 'metadata.exportExcluded': true },
        { exportExcluded: true }
      ]
    }]
  });

  const pending = totals - fmt(counts.keep) - fmt(counts.excluded);

  console.log(`\n=== Cull Audit: ${collectionId} ===`);
  console.log(`Accepted pieces: ${totals}`);
  console.log(`  Kept: ${fmt(counts.keep || counts.kept)}`);
  console.log(`  Excluded: ${fmt(counts.excluded)}`);
  console.log(`  Pending: ${pending < 0 ? 0 : pending}`);
  console.log(`  exportExcluded=true: ${excludedCount}`);
}

async function main() {
  const ids = parseIds(process.argv.slice(2));
  if (!ids.length) {
    console.error('Usage: node scripts/investigate/reviewCullAudit.js <collectionId>[,<collectionId>...]');
    process.exit(1);
  }
  const client = await getCachedClient();
  const dbName = process.env.MONGO_DB_NAME || 'station';
  const db = client.db(dbName);
  for (const id of ids) {
    await auditCollection(db, id);
  }
}

main().catch(err => {
  console.error('reviewCullAudit failed:', err);
  process.exit(1);
});
