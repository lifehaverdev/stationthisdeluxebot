const { MongoClient } = require('mongodb');

// Deletes all userCore documents that do NOT have telegram == '5472638766'.
// Usage:
//   DRY RUN (default): ./run-with-env.sh node scripts/migration/UserNoemaMigration/userCore_cleanup.js
//   Execute:          ./run-with-env.sh node scripts/migration/UserNoemaMigration/userCore_cleanup.js --execute

const EXECUTE = process.argv.includes('--execute');
const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
const NOEMA_DB = 'noema';
if (!mongoUri) {
  console.error('MONGO_PASS or MONGODB_URI not set');
  process.exit(1);
}

(async function () {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const col = client.db(NOEMA_DB).collection('userCore');

    const filter = {
      $or: [
        { 'platformIdentities.telegram': { $exists: false } },
        { 'platformIdentities.telegram': { $ne: '5472638766' } },
      ],
    };

    const count = await col.countDocuments(filter);
    console.log(`[userCore_cleanup] Documents that would be removed: ${count}`);

    if (count && EXECUTE) {
      const res = await col.deleteMany(filter);
      console.log(`[userCore_cleanup] Deleted ${res.deletedCount} documents.`);
    } else if (!EXECUTE) {
      console.log('[userCore_cleanup] DRY RUN – pass --execute to delete.');
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  } finally {
    await client.close();
  }
})();
