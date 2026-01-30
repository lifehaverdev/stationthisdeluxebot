/**
 * Migration Script: Normalize spell visibility field.
 *
 * This migration converts the legacy `isPublic` boolean field to the new
 * `visibility` enum field ('private', 'listed', 'public').
 *
 * Run with:
 *   node scripts/migrations/2025_01_normalize_spell_visibility.js
 *
 * This script is idempotent – running multiple times will not change
 * documents that already have the correct visibility value.
 */

const { MongoClient } = require('mongodb');

async function migrate() {
  const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
  const dbName = process.env.MONGO_DB_NAME || 'noema';

  if (!mongoUri) {
    console.error('❌  Migration aborted: missing MONGO_PASS or MONGODB_URI env variable.');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log(`✅  Connected to MongoDB – database: ${dbName}`);

    const db = client.db(dbName);
    const spellsCol = db.collection('spells');

    // Step 1: Set visibility='public' for spells with isPublic=true that don't have visibility='public'
    const publicResult = await spellsCol.updateMany(
      {
        isPublic: true,
        visibility: { $ne: 'public' }
      },
      {
        $set: { visibility: 'public' }
      }
    );
    console.log(`✅  Set visibility='public' for ${publicResult.modifiedCount} spell(s) with isPublic=true.`);

    // Step 2: Set visibility='private' for spells without visibility or with isPublic=false
    const privateResult = await spellsCol.updateMany(
      {
        $or: [
          { visibility: { $exists: false } },
          { visibility: null },
          { visibility: '' }
        ],
        isPublic: { $ne: true }
      },
      {
        $set: { visibility: 'private' }
      }
    );
    console.log(`✅  Set visibility='private' for ${privateResult.modifiedCount} spell(s) without visibility.`);

    // Step 3: Ensure publicSlug is set for all public/listed spells
    const slugResult = await spellsCol.updateMany(
      {
        visibility: { $in: ['public', 'listed'] },
        publicSlug: { $exists: false }
      },
      [
        {
          $set: {
            publicSlug: '$slug'
          }
        }
      ]
    );
    console.log(`✅  Added publicSlug to ${slugResult.modifiedCount} public/listed spell(s).`);

    // Step 4: Report summary
    const totalSpells = await spellsCol.countDocuments();
    const publicSpells = await spellsCol.countDocuments({ visibility: 'public' });
    const listedSpells = await spellsCol.countDocuments({ visibility: 'listed' });
    const privateSpells = await spellsCol.countDocuments({ visibility: 'private' });

    console.log('\n📊 Summary:');
    console.log(`   Total spells: ${totalSpells}`);
    console.log(`   Public: ${publicSpells}`);
    console.log(`   Listed: ${listedSpells}`);
    console.log(`   Private: ${privateSpells}`);

  } catch (err) {
    console.error('❌  Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
