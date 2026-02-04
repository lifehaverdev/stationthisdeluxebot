/**
 * dumpGalleryConfig.js - Dump complete gallery config
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const galleryCol = legacyDb.collection('gallery');

  const collectionId = 9351423251993;

  console.log('\n=== COMPLETE RAW GALLERY DOCUMENT ===\n');

  const doc = await galleryCol.findOne({ collectionId });

  // Print everything except the huge traitTypes array
  const { config, ...rest } = doc;
  const { traitTypes, ...configRest } = config || {};

  console.log('=== Top-level fields ===');
  console.log(JSON.stringify(rest, null, 2));

  console.log('\n=== Config (excluding traitTypes) ===');
  console.log(JSON.stringify(configRest, null, 2));

  console.log('\n=== Trait Types Summary ===');
  if (traitTypes) {
    for (const tt of traitTypes) {
      console.log(`  ${tt.title}: ${tt.traits?.length || 0} traits`);
    }
  }

  // Check if there are any other fields we might be missing
  console.log('\n=== All top-level keys in document ===');
  console.log(Object.keys(doc));

  console.log('\n=== All keys in config ===');
  console.log(Object.keys(config || {}));

  await client.close();
})();
