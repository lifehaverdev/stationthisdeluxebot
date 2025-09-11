/*
 * migrateUsersToNoema.js
 *
 * Reads reports/legacy_users_to_migrate.json and migrates each user to Noema DB via internal API endpoints.
 *
 * Usage:
 *   ./run-with-env.sh node scripts/migration/UserNoemaMigration/migrateUsersToNoema.js --dry-run [--limit 10]
 *
 * Env:
 *   INTERNAL_API_URL   Base URL for internal API (default http://localhost:3000)
 *   INTERNAL_API_KEY   Shared secret for authentication (adds `x-api-key` header) – optional.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, Decimal128 } = require('mongodb');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx !== -1 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : undefined;

const dataPath = path.resolve('reports/legacy_users_to_migrate.json');
if (!fs.existsSync(dataPath)) {
  console.error(`[migrateUsers] Cannot find ${dataPath}. Run legacy_user_extractor.js first.`);
  process.exit(1);
}

const targets = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const users = limit ? targets.slice(0, limit) : targets;

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
const NOEMA_DB = 'noema';

(async function run() {
  console.log(`[migrateUsers] Starting migration for ${users.length} users (${dryRun ? 'DRY RUN' : 'LIVE'})`);

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(NOEMA_DB);
  const userCoreCol = db.collection('userCore');
  const ledgerCol = db.collection('credit_ledger');
  const economyCol = db.collection('userEconomy');

  let success = 0;
  for (const user of users) {
    const points = Math.floor(user.exp / 10); // 10% of exp
    const masterBody = {
      platformIdentities: { telegram: user.userId.toString() },
      wallets: [{
        address: user.wallet,
        type: 'CONNECTED_ETH',
        isPrimary: true,
        verified: true,
        addedAt: new Date(),
      }],
    };
    const ledgerBody = {
      master_account_id: '<placeholder>', // replaced during live run
      status: 'CONFIRMED',
      type: 'MIGRATION_BONUS',
      description: 'Legacy exp credit (10% of original)',
      points_credited: points,
      points_remaining: points,
      related_items: { original_exp: user.exp },
      source: 'legacy_migration_2025-09-05',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (dryRun) {
      // prints preview already
      continue;
    }
    try {
      // Upsert master account
      let masterDoc = await userCoreCol.findOne({ 'platformIdentities.telegram': user.userId.toString() });
      let masterId;
      if (masterDoc) {
        masterId = masterDoc._id;
      } else {
        const insertRes = await userCoreCol.insertOne(masterBody);
        masterId = insertRes.insertedId;
      }

      // Upsert or create user economy record with EXP
      const now = new Date();
      const expInt = Math.floor(user.exp);
      const expBigInt = BigInt(expInt);
      const existingEconomy = await economyCol.findOne({ masterAccountId: masterId });
      if (existingEconomy) {
        await economyCol.updateOne(
          { _id: existingEconomy._id },
          { $set: { exp: expBigInt, updatedAt: now } }
        );
      } else {
        await economyCol.insertOne({
          masterAccountId: masterId,
          usdCredit: Decimal128.fromString('0'),
          exp: expBigInt,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Insert credit ledger entry
      const ledgerEntry = { ...ledgerBody, master_account_id: masterId };
      const existingLedger = await ledgerCol.findOne({ master_account_id: masterId, type: 'MIGRATION_BONUS', source: ledgerBody.source });
      if (!existingLedger) {
        await ledgerCol.insertOne(ledgerEntry);
      }

      success++;
      console.log(`Migrated user ${user.userId} -> masterAccount ${masterId}`);
    } catch (err) {
      if (err.code === 11000) {
        console.warn(`Duplicate key for user ${user.userId}, skipping.`);
      } else {
        console.error(`Error migrating user ${user.userId}:`, err.message);
      }
    }
  }

  await client.close();

  if (!dryRun) {
    console.log(`[migrateUsers] Completed. Successfully migrated ${success}/${users.length} users.`);
  }
})();
