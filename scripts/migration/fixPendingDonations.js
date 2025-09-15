// Script to mark TOKEN_DONATION entries stuck in PENDING_CONFIRMATION as CONFIRMED
// Usage: node scripts/migration/fixPendingDonations.js [--dry]
// Requires: MONGODB_URI (mongodb connection string) and MONGO_DB_NAME (db name) in env.

const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGO_PASS || 'mongodb://localhost:27017';
  const dbName = process.env.MONGO_DB_NAME || 'station';
  const dryRun = process.argv.includes('--dry');

  console.log(`[fixPendingDonations] Connecting to ${uri}/${dbName} ...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const ledger = db.collection('credit_ledger');

  const filter = {
    deposit_type: 'TOKEN_DONATION',
    status: 'PENDING_CONFIRMATION',
  };
  const pendingCount = await ledger.countDocuments(filter);
  console.log(`[fixPendingDonations] Found ${pendingCount} donation entries pending confirmation.`);
  if (pendingCount === 0) {
    await client.close();
    return console.log('[fixPendingDonations] Nothing to do.');
  }

  if (dryRun) {
    console.log('[fixPendingDonations] --dry flag set, no documents will be modified.');
    await client.close();
    return;
  }

  const result = await ledger.updateMany(filter, {
    $set: {
      status: 'CONFIRMED',
      updatedAt: new Date(),
    },
  });
  console.log(`[fixPendingDonations] Updated ${result.modifiedCount} entries to CONFIRMED.`);
  await client.close();
})();

