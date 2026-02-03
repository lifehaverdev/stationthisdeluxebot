/**
 * examineLegacyGalleryStudio.js
 *
 * Examines the schema of legacy gallery and studio records for migration planning.
 *
 * Usage:
 *   scripts/run-with-env.sh node scripts/migration/examineLegacyGalleryStudio.js <collectionId>
 */

const { MongoClient } = require('mongodb');

const collectionId = process.argv[2];
if (!collectionId) {
  console.error('Usage: scripts/run-with-env.sh node scripts/migration/examineLegacyGalleryStudio.js <collectionId>');
  process.exit(1);
}

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const galleryCol = legacyDb.collection('gallery');
  const studioCol = legacyDb.collection('studio');

  console.log('\n=== GALLERY RECORD ===\n');

  // Handle both numeric and string collectionId
  let galleryDoc = await galleryCol.findOne({ collectionId: parseInt(collectionId) });
  if (!galleryDoc) {
    galleryDoc = await galleryCol.findOne({ collectionId: collectionId });
  }

  if (galleryDoc) {
    console.log(JSON.stringify(galleryDoc, null, 2));
  } else {
    console.log('Gallery record not found');
  }

  console.log('\n=== STUDIO RECORDS (Sample) ===\n');

  // Get a few sample studio records
  let studioSamples = await studioCol.find({ collectionId: parseInt(collectionId) }).limit(3).toArray();
  if (studioSamples.length === 0) {
    studioSamples = await studioCol.find({ collectionId: collectionId }).limit(3).toArray();
  }

  if (studioSamples.length > 0) {
    for (const doc of studioSamples) {
      console.log(JSON.stringify(doc, null, 2));
      console.log('\n---\n');
    }

    // Get status distribution
    const statusAgg = await studioCol.aggregate([
      { $match: { collectionId: parseInt(collectionId) || collectionId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    console.log('\nStatus distribution:', statusAgg);
  } else {
    console.log('No studio records found');
  }

  await client.close();
})();
