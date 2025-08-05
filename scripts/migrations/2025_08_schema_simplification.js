/**
 * Migration: Simplify Spell schema – remove legacy visibility/slug fields,
 * rename cached stats, enforce unique name index.
 *
 * Run with:
 *   node scripts/migrations/2025_08_schema_simplification.js
 *
 * Required env vars:
 *   - MONGODB_URI or MONGO_PASS
 *   - MONGO_DB_NAME (optional – defaults to "station")
 */

const { MongoClient } = require('mongodb');
const { slugify } = require('../../src/utils/stringUtils');

async function migrate() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_PASS;
  const dbName = 'noema'//process.env.MONGO_DB_NAME || 'station';

  if (!mongoUri) {
    console.error('❌  Migration aborted: missing MONGODB_URI or MONGO_PASS env variable.');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log(`✅  Connected to MongoDB – database: ${dbName}`);

    const db = client.db(dbName);
    const spellsCol = db.collection('spells');

    /* ------------------------------------------------------------------ */
    /* 1. Ensure unique index on "name" (case-insensitive)                 */
    /* ------------------------------------------------------------------ */
    try {
      await spellsCol.createIndex(
        { name: 1 },
        { unique: true, collation: { locale: 'en', strength: 2 } },
      );
      console.log('✅  Index { name: 1 } created (unique, case-insensitive)');
    } catch (idxErr) {
      if (idxErr.codeName === 'IndexOptionsConflict' || idxErr.message?.includes('already exists')) {
        console.log('ℹ️  Unique index on name already exists – skipped');
      } else {
        throw idxErr;
      }
    }

    /* ------------------------------------------------------------------ */
    /* 2. Update existing documents                                        */
    /* ------------------------------------------------------------------ */
    // Convert in batches to avoid memory blow-ups for huge collections
    const BATCH_SIZE = 500;
    let processed = 0;

    const cursor = spellsCol.find({}, { projection: { _id: 1, name: 1, slug: 1, visibility: 1, permissionType: 1, isPublic: 1, publicSlug: 1, avgRuntimeMsCached: 1, avgCostPtsCached: 1 } });

    while (await cursor.hasNext()) {
      const batch = await cursor.next();
      if (!batch) break;

      const _id = batch._id;
      const update = { $set: {}, $unset: {} };

      // 2a. Rename cached stats
      if (typeof batch.avgRuntimeMsCached !== 'undefined') {
        update.$set.estimatedRuntimeMs = batch.avgRuntimeMsCached;
        update.$unset.avgRuntimeMsCached = '';
      }
      if (typeof batch.avgCostPtsCached !== 'undefined') {
        update.$set.estimatedCostPts = batch.avgCostPtsCached;
        update.$unset.avgCostPtsCached = '';
      }

      // 2b. Determine isPublic value – already exists as single source of truth
      // No-op, but we remove redundant fields below

      // 2c. Remove legacy fields
      ['slug', 'visibility', 'permissionType', 'publicSlug'].forEach((field) => {
        if (typeof batch[field] !== 'undefined') {
          update.$unset[field] = '';
        }
      });

      // 2d. Ensure name exists (fallback from slug if missing)
      if (!batch.name && batch.slug) {
        const derivedName = batch.slug.replace(/[-_]/g, ' ');
        update.$set.name = derivedName;
      }

      // 2e. Optionally ensure isPublic boolean exists
      if (typeof batch.isPublic === 'undefined') {
        update.$set.isPublic = batch.visibility === 'public' || false;
      }

      // Skip empty updates
      if (Object.keys(update.$set).length === 0 && Object.keys(update.$unset).length === 0) {
        continue;
      }

      await spellsCol.updateOne({ _id }, update);
      processed += 1;
      if (processed % 100 === 0) {
        console.log(`   …processed ${processed} spells`);
      }
    }

    console.log(`🎉  Migration completed. Updated ${processed} spell(s).`);
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