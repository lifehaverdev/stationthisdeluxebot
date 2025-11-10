// #!/usr/bin/env node
// Collection export with trait tree and zip for legacy *stationthisbot* MongoDB.
// Uses:
//   - `gallery` collection   → master collection doc (config.masterPrompt, traitTypes)
//   - `studio` collection    → generation records / pieces
// Dedicated to legacy data only; Noema database not supported.
// Usage: node exportCollectionWithTree.js <collectionId> [totalSupply (optional)] [--out /output/path (optional)]

const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
// (Removed archiver; zipping handled manually)
const exportCollection = require('../archive/deluxebot/db/operations/exportCollection');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node exportCollectionWithTree.js <collectionId> [totalSupply] [--out /output/path]');
    process.exit(1);
  }

  const collectionId = parseInt(args[0]);
  let totalSupply = args[1] && !args[1].startsWith('--') ? parseInt(args[1]) : null;
  const outFlagIndex = args.findIndex(a => a === '--out');
  const outputPath = outFlagIndex !== -1 ? args[outFlagIndex + 1] : null;
  if (outputPath) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Connect to legacy DB
  const mongoUri = process.env.MONGO_PASS;
  if (!mongoUri) {
    console.error('MONGO_PASS env var is required');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  // Explicitly use the legacy stationthisbot DB regardless of default in URI
  const db = client.db('stationthisbot');
  const gallery = db.collection('gallery');

  const collection = await gallery.findOne({ collectionId });
  if (!collection) {
    console.error(`Collection ${collectionId} not found`);
    process.exit(1);
  }

  // If totalSupply not provided, count approved pieces
  if (!totalSupply) {
    const studioCol = db.collection('studio');
    totalSupply = await studioCol.countDocuments({ collectionId, status: { $in: ['approved'] } });
    console.log(`Derived totalSupply=${totalSupply} from approved pieces`);
  }

  const exportResult = await exportCollection(collectionId, totalSupply, outputPath);
  if (!exportResult.success) {
    console.error('Export images/metadata failed');
    process.exit(1);
  }

  // Build trait_tree.json
  const tree = {
    collectionId,
    masterPrompt: collection.config.masterPrompt,
    traits: Object.fromEntries(collection.config.traitTypes.map(tt => [tt.title, tt.traits.map(t => t.name)]))
  };
  fs.writeFileSync(path.join(exportResult.exportPath, 'trait_tree.json'), JSON.stringify(tree, null, 2));

  console.log(`Export complete. Files available at ${exportResult.exportPath}`);
  await client.close();
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
