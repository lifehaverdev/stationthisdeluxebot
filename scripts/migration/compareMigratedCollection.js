/**
 * compareMigratedCollection.js
 *
 * Compares a migrated collection in noema with its original in stationthisbot
 * to identify any discrepancies.
 *
 * Usage:
 *   scripts/run-with-env.sh node scripts/migration/compareMigratedCollection.js <noema_collectionId>
 */

const { MongoClient } = require('mongodb');

const noemaCollectionId = process.argv[2];
if (!noemaCollectionId) {
  console.error('Usage: scripts/run-with-env.sh node scripts/migration/compareMigratedCollection.js <noema_collectionId>');
  process.exit(1);
}

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const noemaDb = client.db('noema');

  const galleryCol = legacyDb.collection('gallery');
  const collectionsCol = noemaDb.collection('collections');

  // Find the noema collection
  const noemaCollection = await collectionsCol.findOne({ collectionId: noemaCollectionId });
  if (!noemaCollection) {
    console.error('Collection not found in noema:', noemaCollectionId);
    process.exit(1);
  }

  console.log('\n=== NOEMA COLLECTION ===\n');
  console.log('collectionId:', noemaCollection.collectionId);
  console.log('name:', noemaCollection.name);
  console.log('description:', noemaCollection.description);
  console.log('userId:', noemaCollection.userId);
  console.log('\nconfig keys:', Object.keys(noemaCollection.config || {}));
  console.log('\nconfig.masterPrompt:', noemaCollection.config?.masterPrompt?.substring(0, 200) + '...');
  console.log('\nconfig.traitTree length:', noemaCollection.config?.traitTree?.length || 0);

  if (noemaCollection.config?.traitTree) {
    console.log('\nTrait categories in noema:');
    for (const cat of noemaCollection.config.traitTree) {
      console.log(`  - ${cat.title}: ${cat.traits?.length || 0} traits`);
      if (cat.traits?.length > 0) {
        console.log(`    First trait: ${JSON.stringify(cat.traits[0])}`);
      }
    }
  }

  // Find legacy collection by legacyCollectionId in metadata
  const legacyCollectionId = noemaCollection.config?.legacyCollectionId || noemaCollection.metadata?.legacyCollectionId;
  console.log('\n\nLegacy collection ID:', legacyCollectionId);

  if (legacyCollectionId) {
    // Handle both numeric and string
    let legacyCollection = await galleryCol.findOne({ collectionId: parseInt(legacyCollectionId) });
    if (!legacyCollection) {
      legacyCollection = await galleryCol.findOne({ collectionId: legacyCollectionId });
    }

    if (legacyCollection) {
      console.log('\n=== LEGACY GALLERY COLLECTION ===\n');
      console.log('collectionId:', legacyCollection.collectionId);
      console.log('name:', legacyCollection.name);
      console.log('description:', legacyCollection.description);
      console.log('userId:', legacyCollection.userId);
      console.log('totalSupply:', legacyCollection.totalSupply);
      console.log('chain:', legacyCollection.chain);

      console.log('\nconfig keys:', Object.keys(legacyCollection.config || {}));
      console.log('\nconfig.masterPrompt:', legacyCollection.config?.masterPrompt?.substring(0, 200) + '...');
      console.log('\nconfig.workflow:', legacyCollection.config?.workflow);
      console.log('\nconfig.traitTypes length:', legacyCollection.config?.traitTypes?.length || 0);

      if (legacyCollection.config?.traitTypes) {
        console.log('\nTrait categories in legacy:');
        for (const cat of legacyCollection.config.traitTypes) {
          console.log(`  - ${cat.title}: ${cat.traits?.length || 0} traits`);
          if (cat.traits?.length > 0) {
            console.log(`    First trait: ${JSON.stringify(cat.traits[0])}`);
          }
        }
      }

      // Compare
      console.log('\n\n=== COMPARISON ===\n');

      const noemaPrompt = noemaCollection.config?.masterPrompt || '';
      const legacyPrompt = legacyCollection.config?.masterPrompt || '';
      console.log('Master prompt match:', noemaPrompt === legacyPrompt ? 'YES' : 'NO');
      if (noemaPrompt !== legacyPrompt) {
        console.log('  Noema length:', noemaPrompt.length);
        console.log('  Legacy length:', legacyPrompt.length);
      }

      const noemaTraitCount = noemaCollection.config?.traitTree?.length || 0;
      const legacyTraitCount = legacyCollection.config?.traitTypes?.length || 0;
      console.log('Trait category count match:', noemaTraitCount === legacyTraitCount ? 'YES' : 'NO');
      console.log(`  Noema: ${noemaTraitCount}, Legacy: ${legacyTraitCount}`);

      // Check each trait category
      if (noemaCollection.config?.traitTree && legacyCollection.config?.traitTypes) {
        console.log('\nTrait category comparison:');
        for (let i = 0; i < Math.max(noemaTraitCount, legacyTraitCount); i++) {
          const noemaCat = noemaCollection.config.traitTree[i];
          const legacyCat = legacyCollection.config.traitTypes[i];

          const noemaTitle = noemaCat?.title || 'MISSING';
          const legacyTitle = legacyCat?.title || 'MISSING';
          const noemaTraits = noemaCat?.traits?.length || 0;
          const legacyTraits = legacyCat?.traits?.length || 0;

          const match = noemaTitle === legacyTitle && noemaTraits === legacyTraits;
          console.log(`  [${i}] ${match ? '✓' : '✗'} noema="${noemaTitle}" (${noemaTraits}) vs legacy="${legacyTitle}" (${legacyTraits})`);
        }
      }

      // Check for other config fields that might be needed
      console.log('\n\nOther legacy config fields that might be needed:');
      for (const key of Object.keys(legacyCollection.config || {})) {
        if (key !== 'masterPrompt' && key !== 'traitTypes') {
          console.log(`  ${key}:`, JSON.stringify(legacyCollection.config[key]).substring(0, 100));
        }
      }

      // Print full legacy config for reference
      console.log('\n\n=== FULL LEGACY CONFIG (for reference) ===\n');
      console.log(JSON.stringify(legacyCollection.config, null, 2));

    } else {
      console.log('Legacy collection not found');
    }
  }

  await client.close();
})();
