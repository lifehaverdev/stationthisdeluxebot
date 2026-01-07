#!/usr/bin/env node

/**
 * Bulk review-reset utility.
 *
 * By default it loads every collectionId from the collections table and
 * applies the same reset logic used by the app's "Restart Review" button:
 *   • clears review/cull/export flags on generationOutputs
 *   • deletes existing collection_reviews entries
 *   • rebuilds the queue from scratch
 *
 * Usage:
 *   ./run-with-env.sh node scripts/maintenance/resetAllCollectionsReviews.js
 *
 * Options:
 *   --dry-run           Only list which collections would be processed.
 *   --include=id1,id2   Restrict to specific collectionIds.
 */

const { getCachedClient } = require('../../src/core/services/db/utils/queue');
const { resetCollectionReviews } = require('../../src/core/services/review/reviewResetService');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    include: null
  };
  args.forEach(arg => {
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg.startsWith('--include=')) {
      const list = arg.split('=')[1];
      opts.include = list
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
    }
  });
  return opts;
}

async function loadCollectionIds({ include } = {}) {
  if (Array.isArray(include) && include.length) {
    return include;
  }
  const client = await getCachedClient();
  const dbName = process.env.MONGO_DB_NAME || 'station';
  const db = client.db(dbName);
  const docs = await db.collection('collections').find({}, {
    projection: { collectionId: 1, name: 1 }
  }).toArray();
  return docs
    .map(doc => doc.collectionId)
    .filter(Boolean);
}

async function main() {
  const options = parseArgs();
  const collectionIds = await loadCollectionIds(options);
  if (!collectionIds.length) {
    console.log('No collections found to reset.');
    return;
  }

  console.log(`Discovered ${collectionIds.length} collection(s) to process.`);
  if (options.dryRun) {
    collectionIds.forEach(id => console.log(` - ${id}`));
    console.log('Dry run complete – no changes made.');
    return;
  }

  for (const collectionId of collectionIds) {
    try {
      console.log(`\n[reset-all] Resetting ${collectionId}…`);
      const result = await resetCollectionReviews({ collectionId });
      console.log(`[reset-all] Done (${collectionId}):`, result);
    } catch (err) {
      console.error(`[reset-all] Failed (${collectionId}):`, err.message || err);
    }
  }
  console.log('\nCompleted bulk reset.');
}

main().catch(err => {
  console.error('resetAllCollectionsReviews failed:', err);
  process.exit(1);
});
