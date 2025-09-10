const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------------------------
// CLI options (very lightweight parsing – no extra deps)
// --dry-run          -> only prints stats and sample rows, still writes JSON
// --out <file_path>  -> output file path (default reports/legacy_users_to_migrate.json)
// -----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
let outPath = path.join(__dirname, '../../../reports/legacy_users_to_migrate.json');
const outIdx = argv.indexOf('--out');
if (outIdx !== -1 && argv[outIdx + 1]) {
  outPath = path.resolve(argv[outIdx + 1]);
}

// -----------------------------------------------------------------------------
// ENV – expect these to be exported by run-with-env.sh
// -----------------------------------------------------------------------------
const dbName = 'stationthisbot' || process.env.BOT_NAME || 'station';
const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('[legacy_user_extractor] Error: MONGO_PASS or MONGODB_URI not set.');
  process.exit(1);
}

(async function main() {
  const client = new MongoClient(mongoUri);
  try {
    console.log(`[legacy_user_extractor] Connecting to Mongo… (${mongoUri})`);
    await client.connect();
    const db = client.db(dbName);

    const pipeline = [
      { $match: { wallet: { $exists: true, $ne: null } } },
      { $lookup: {
          from: 'users_economy',
          localField: 'userId',
          foreignField: 'userId',
          as: 'economy',
        } },
      { $unwind: '$economy' },
      { $unwind: { path: '$wallets', preserveNullAndEmptyArrays: true } },
      { $match: { 'economy.exp': { $gt: 0 }, 'wallets.type': 'CONNECTED_ETH', 'wallets.address': { $regex: /^0x/i } } },
      { $project: { _id: 0, userId: 1, wallet: '$wallets.address', exp: '$economy.exp' } },
      { $group: { _id: '$userId', wallet: { $first: '$wallet' }, exp: { $first: '$exp' } } },
      { $project: { userId: '$_id', wallet: 1, exp: 1, _id: 0 } },
    ];

    console.log('[legacy_user_extractor] Running aggregation…');
    const cursor = db.collection('users_core').aggregate(pipeline, { allowDiskUse: true });

    const users = [];
    for await (const doc of cursor) {
      users.push({
        userId: doc.userId,
        wallet: doc.wallet,
        exp: doc.exp,
        hasWallet: true,
        migrationTarget: true,
        usdCredit: parseFloat((doc.exp * 0.000337).toFixed(6)),
      });
    }

    // Calculate totals
    const totalExp = users.reduce((sum, u) => sum + (u.exp || 0), 0);
    const totalUsd = parseFloat((totalExp * 0.000337).toFixed(2));
    console.log(`[legacy_user_extractor] Aggregate exp across filtered users: ${totalExp.toLocaleString()} -> USD ≈ $${totalUsd.toLocaleString()}`);

    // Compute overall exp across entire users_economy collection for comparison
    const overallDoc = await db.collection('users_economy').aggregate([
      { $group: { _id: null, totalExp: { $sum: '$exp' } } }
    ]).next();
    const overallExp = overallDoc?.totalExp || 0;
    const overallUsd = parseFloat((overallExp * 0.000337).toFixed(2));
    console.log(`[legacy_user_extractor] TOTAL exp across all users_economy: ${overallExp.toLocaleString()} -> USD ≈ $${overallUsd.toLocaleString()}`);

    // Write output JSON
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(users, null, 2));
    // Also write a simple list of userIds
    const idListPath = outPath.replace(/\.json$/, '_ids.txt');
    fs.writeFileSync(idListPath, users.map(u => u.userId).join('\n'));
    console.log(`[legacy_user_extractor] ID list written to ${idListPath}`);
    console.log(`[legacy_user_extractor] Migration target count: ${users.length}`);
    console.log(`[legacy_user_extractor] JSON written to ${outPath}`);

    // Dry-run summary & sample
    if (dryRun) {
      console.log('[legacy_user_extractor] --dry-run flag detected; no database writes – summary only');
      const sample = users.slice(0, 5);
      console.log('Sample:', sample);
    }

    console.log('[legacy_user_extractor] Completed.');
  } catch (err) {
    console.error('[legacy_user_extractor] Error:', err);
  } finally {
    await client.close();
  }
})();
