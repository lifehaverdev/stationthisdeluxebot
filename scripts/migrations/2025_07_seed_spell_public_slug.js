/**
 * Seed Script: Backfill publicSlug for spells missing the field.
 *
 * Run with:
 *   node scripts/migrations/2025_07_seed_spell_public_slug.js
 *
 * This script should be idempotent – running multiple times will not
 * change documents that already have a publicSlug.
 */

const { MongoClient } = require('mongodb');

async function seed() {
  const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
  const dbName = 'noema' || process.env.MONGO_DB_NAME || process.env.BOT_NAME || 'station';

  if (!mongoUri) {
    console.error('❌  Seed aborted: missing MONGO_PASS or MONGODB_URI env variable.');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log(`✅  Connected to MongoDB – database: ${dbName}`);

    const db = client.db(dbName);
    const spellsCol = db.collection('spells');

    const result = await spellsCol.updateMany(
      { publicSlug: { $exists: false } },
      [
        {
          $set: {
            publicSlug: '$slug'
          }
        }
      ]
    );

    console.log(`✅  Added publicSlug to ${result.modifiedCount} spell(s).`);
  } catch (err) {
    console.error('❌  Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  seed();
}

module.exports = seed; 