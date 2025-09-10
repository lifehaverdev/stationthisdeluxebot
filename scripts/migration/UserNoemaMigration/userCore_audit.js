const { MongoClient } = require('mongodb');

// Quick audit of Noema userCore collection – counts, duplicate telegram IDs, duplicate wallets.
// Usage: ./run-with-env.sh node scripts/migration/UserNoemaMigration/userCore_audit.js

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
const NOEMA_DB = 'noema';
if (!mongoUri) {
  console.error('[userCore_audit] MONGO_PASS or MONGODB_URI not set');
  process.exit(1);
}

(async function () {
  const client = new MongoClient(mongoUri);
  try {
    console.log('[userCore_audit] Connecting to Mongo…');
    await client.connect();
    const db = client.db(NOEMA_DB);
    const col = db.collection('userCore');

    const total = await col.countDocuments();
    console.log(`[userCore_audit] Total documents: ${total}`);

    // Count docs with telegram identity
    const withTg = await col.countDocuments({ 'platformIdentities.telegram': { $exists: true } });
    console.log(`[userCore_audit] With telegram identity: ${withTg}`);

    // Duplicate telegram IDs
    const dupTelegram = await col.aggregate([
      { $match: { 'platformIdentities.telegram': { $exists: true } } },
      { $group: { _id: '$platformIdentities.telegram', count: { $sum: 1 }, samples: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $project: { telegram: '$_id', count: 1, samples: { $slice: ['$samples', 5] } } },
    ]).toArray();
    console.log(`[userCore_audit] Duplicate telegram IDs: ${dupTelegram.length}`);
    if (dupTelegram.length) {
      console.log('Samples:', dupTelegram.slice(0, 10));
    }

    // Duplicate wallet addresses (case-insensitive)
    const dupWallets = await col.aggregate([
      { $unwind: '$wallets' },
      { $project: { addr: { $toLower: '$wallets.address' } } },
      { $group: { _id: '$addr', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ]).toArray();
    console.log(`[userCore_audit] Duplicate wallet addresses: ${dupWallets.length}`);
    if (dupWallets.length) {
      console.log('Sample duplicates:', dupWallets);
    }

    console.log('[userCore_audit] Done.');
  } catch (err) {
    console.error('[userCore_audit] Error:', err);
  } finally {
    await client.close();
  }
})();
