// Utility script: deleteGenerationOutputsForCollection.js
// Removes all generationOutputs documents tagged with a specific collectionId.
// Usage:
//   run-with-env.sh node scripts/migration/deleteGenerationOutputsForCollection.js <collectionId>
// Requires env vars:
//   MONGO_URI        – Mongo connection string (default: mongodb://localhost:27017)
//   MONGO_DB_NAME    – DB name (default: station)

const { MongoClient } = require('mongodb');

(async () => {
  const collectionId = process.argv[2];
  if (!collectionId) {
    console.error('Usage: node deleteGenerationOutputsForCollection.js <collectionId>');
    process.exit(1);
  }

  const uri = process.env.MONGO_PASS || 'mongodb://localhost:27017';
  const dbName = 'noema' || process.env.MONGO_DB_NAME || 'station';

  const client = new MongoClient(uri, { useUnifiedTopology: true });

  try {
    await client.connect();
    const col = client.db(dbName).collection('generationOutputs');
    const result = await col.deleteMany({ 'metadata.collectionId': collectionId });
    console.log(`[cleanup] Deleted ${result.deletedCount} generationOutputs for collectionId ${collectionId}`);
  } catch (err) {
    console.error('[cleanup] Error:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
