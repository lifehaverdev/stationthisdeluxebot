#!/usr/bin/env node

/**
 * Resets review state for one or more collections by clearing generation outcomes
 * and rebuilding the review queue from scratch.
 *
 * Usage:
 *   node scripts/maintenance/resetCollectionReviews.js <collectionId>[,<collectionId>...] [moreIds...]
 *
 * Example:
 *   ./run-with-env.sh node scripts/maintenance/resetCollectionReviews.js ff66b537-c99e-4e18-805f-33ff1afa7ced
 */

const { resetCollectionReviews } = require('../../src/core/services/review/reviewResetService');

async function main() {
  const rawArgs = process.argv.slice(2);
  const ids = rawArgs
    .join(',')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (!ids.length) {
    console.error('Usage: node scripts/maintenance/resetCollectionReviews.js <collectionId>[,<collectionId>...]');
    process.exit(1);
  }

  for (const collectionId of ids) {
    try {
      console.log(`\n[reset] Processing collection ${collectionId}…`);
      const result = await resetCollectionReviews({ collectionId });
      console.log(`[reset] Completed ${collectionId}:`, result);
    } catch (err) {
      console.error(`[reset] Failed for ${collectionId}:`, err.message || err);
    }
  }
}

main().then(() => {
  console.log('\nAll done.');
  process.exit(0);
}).catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
