/**
 * Migration: Add publicSlug, isPublic, and avgCostPtsCached to all spell documents
 * and create the spell_component_stats collection.
 *
 * Run with:
 *   node scripts/migrations/2025_07_add_spell_public_slug.js
 *
 * Environment variables required:
 *   - MONGO_PASS or MONGODB_URI  : Mongo connection string
 *   - MONGO_DB_NAME or BOT_NAME  : Database name (defaults to "station")
 */

const { MongoClient } = require('mongodb');

async function migrate() {
  const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
  const dbName = 'noema' || process.env.MONGO_DB_NAME || process.env.BOT_NAME || 'station';

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

    /* ------------------------------------------------------------------ */
    /* 1. Ensure a sparse unique index on publicSlug                       */
    /* ------------------------------------------------------------------ */
    try {
      await spellsCol.createIndex({ publicSlug: 1 }, { unique: true, sparse: true });
      console.log('✅  Index { publicSlug: 1 } created (unique, sparse)');
    } catch (idxErr) {
      if (idxErr.codeName === 'IndexOptionsConflict' || idxErr.message?.includes('already exists')) {
        console.log('ℹ️  Index on publicSlug already exists – skipped');
      } else {
        throw idxErr;
      }
    }

    /* ------------------------------------------------------------------ */
    /* 2. Back-fill new fields on existing spell documents                 */
    /* ------------------------------------------------------------------ */
    const updateResult = await spellsCol.updateMany(
      {},
      [
        {
          $set: {
            publicSlug: { $ifNull: ['$publicSlug', '$slug'] },
            isPublic: { $cond: [{ $eq: ['$visibility', 'public'] }, true, false] },
            avgCostPtsCached: { $ifNull: ['$avgCostPtsCached', 0] }
          }
        }
      ]
    );
    console.log(`✅  Updated ${updateResult.modifiedCount} spell(s) with new fields`);

    /* ------------------------------------------------------------------ */
    /* 3. Create spell_component_stats collection (if not present)        */
    /* ------------------------------------------------------------------ */
    const existing = await db.listCollections({ name: 'spell_component_stats' }).toArray();
    if (existing.length === 0) {
      await db.createCollection('spell_component_stats');
      await db.collection('spell_component_stats').createIndex({ spellId: 1, toolId: 1 });
      console.log('✅  Collection spell_component_stats created with index { spellId: 1, toolId: 1 }');
    } else {
      console.log('ℹ️  Collection spell_component_stats already exists – skipped');
    }

    console.log('🎉  Migration completed successfully');
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