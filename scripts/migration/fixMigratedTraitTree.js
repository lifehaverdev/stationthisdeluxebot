/**
 * fixMigratedTraitTree.js
 *
 * Fixes migrated collections by converting legacy traitTree structure:
 * - Converts 'title' → 'name' for trait categories
 * - Converts 'prompt' → 'value' for traits (keeping prompt as fallback)
 *
 * Usage:
 *   scripts/run-with-env.sh node scripts/migration/fixMigratedTraitTree.js <noema_collectionId> [--dry-run]
 *   scripts/run-with-env.sh node scripts/migration/fixMigratedTraitTree.js --all [--dry-run]
 */

const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fixAll = args.includes('--all');
const collectionId = args.find(a => !a.startsWith('--'));

if (!collectionId && !fixAll) {
  console.error('Usage: scripts/run-with-env.sh node scripts/migration/fixMigratedTraitTree.js <noema_collectionId> [--dry-run]');
  console.error('       scripts/run-with-env.sh node scripts/migration/fixMigratedTraitTree.js --all [--dry-run]');
  process.exit(1);
}

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const noemaDb = client.db('noema');
  const collectionsCol = noemaDb.collection('collections');

  console.log(`\n========================================`);
  console.log(`Fix Migrated TraitTree Structure`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`========================================\n`);

  // Find collections to fix
  let query = {};
  if (collectionId) {
    query.collectionId = collectionId;
  } else {
    // Fix all migrated collections (those with legacyCollectionId)
    query['metadata.migrationSource'] = 'stationthisbot_gallery';
  }

  const collections = await collectionsCol.find(query).toArray();
  console.log(`Found ${collections.length} collection(s) to check\n`);

  let fixedCount = 0;

  for (const coll of collections) {
    console.log(`--- Checking: ${coll.name} (${coll.collectionId}) ---`);

    const traitTree = coll.config?.traitTree || [];
    let needsFix = false;
    const fixedTree = [];

    for (const category of traitTree) {
      // Check if this category needs fixing
      const hasTitle = category.title !== undefined;
      const hasName = category.name !== undefined;

      if (hasTitle && !hasName) {
        needsFix = true;
      }

      // Build fixed category
      const fixedCategory = {
        // Use name if exists, otherwise convert from title
        name: category.name || category.title,
        mode: category.mode || 'manual',
      };

      // Copy generator if exists (for generated mode)
      if (category.generator) {
        fixedCategory.generator = category.generator;
      }

      // Fix traits array
      if (Array.isArray(category.traits)) {
        fixedCategory.traits = category.traits.map(trait => {
          // Check if trait needs fixing (has prompt but no value)
          const hasPrompt = trait.prompt !== undefined;
          const hasValue = trait.value !== undefined;

          if (hasPrompt && !hasValue) {
            needsFix = true;
          }

          return {
            name: trait.name,
            // Use value if exists, otherwise use prompt
            value: trait.value !== undefined ? trait.value : trait.prompt,
            // Keep prompt as metadata for reference
            prompt: trait.prompt,
            rarity: trait.rarity,
          };
        });
      }

      fixedTree.push(fixedCategory);
    }

    if (!needsFix) {
      console.log(`  ✓ Already in correct format`);
      continue;
    }

    console.log(`  ✗ Needs fixing:`);
    console.log(`    - Categories with 'title' instead of 'name': ${traitTree.filter(c => c.title && !c.name).length}`);
    console.log(`    - Traits with 'prompt' instead of 'value': ${traitTree.reduce((sum, c) => sum + (c.traits?.filter(t => t.prompt && !t.value).length || 0), 0)}`);

    // Show before/after for first category
    if (traitTree[0]) {
      console.log(`\n    Before (first category):`);
      console.log(`      title: ${traitTree[0].title}`);
      console.log(`      name: ${traitTree[0].name}`);
      console.log(`      first trait: ${JSON.stringify(traitTree[0].traits?.[0])}`);

      console.log(`\n    After (first category):`);
      console.log(`      name: ${fixedTree[0].name}`);
      console.log(`      first trait: ${JSON.stringify(fixedTree[0].traits?.[0])}`);
    }

    if (!dryRun) {
      await collectionsCol.updateOne(
        { collectionId: coll.collectionId },
        {
          $set: {
            'config.traitTree': fixedTree,
            updatedAt: new Date(),
          }
        }
      );
      console.log(`\n    ✓ Fixed!`);
    } else {
      console.log(`\n    [DRY RUN] Would fix`);
    }

    fixedCount++;
  }

  console.log(`\n========================================`);
  console.log(`SUMMARY`);
  console.log(`========================================`);
  console.log(`Collections checked: ${collections.length}`);
  console.log(`Collections fixed: ${fixedCount}`);
  if (dryRun && fixedCount > 0) {
    console.log(`\nRun without --dry-run to apply fixes`);
  }
  console.log(`========================================\n`);

  await client.close();
})();
