#!/usr/bin/env node
// Script: fixNoemaLoras.js
// Purpose: Apply corrective actions to `noema` database LoRA collections so that they
//          match legacy `stationthisbot` data and remove unwanted models.
// Actions implemented when run with --apply flag:
//   1. Update capitalization of `name` and `slug` fields in `noema.loraModels` to
//      match legacy `stationthisbot.loras.lora_name`.
//   2. Insert models that exist only in legacy DB.
//   3. Rename `deathburgerflux` → `DeathBurgerflux_000003000` (+ slug).
//   4. Remove specific unwanted models (and associated trainings).
//
// Usage:
//   node scripts/migration/fixNoemaLoras.js           # dry-run, exit non-zero if fixes needed
//   node scripts/migration/fixNoemaLoras.js --apply   # perform fixes
//
// Environment variables:
//   MONGO_URI / MONGO_PASS  – connection string
//   LEGACY_DB_NAME          – defaults to "stationthisbot"
//   NEW_DB_NAME             – defaults to "noema"
//
// This script intentionally avoids modifying GridFS buckets for simplicity; any
// orphaned images will be handled in a later cleanup pass.
// -----------------------------------------------------------------------------

const { MongoClient, ObjectId } = require('mongodb');
const { transformLegacyLoras } = require('./LoraTrain/transformLoraData');

const UNWANTED = [
  'ethereumescobar',
  'scrotoshi',
  'scrotoghosty',
  'akurypto',
  'schizocurrency',
  'cornfed',
];

function toSlug(str) {
  return str.trim().toLowerCase().replace(/\s+/g, '_');
}

(async () => {
  const uri = process.env.MONGO_PASS || 'mongodb://localhost:27017';
  const legacyDbName = process.env.LEGACY_DB_NAME || 'stationthisbot';
  const newDbName = process.env.NEW_DB_NAME || 'noema';
  const apply = process.argv.includes('--apply');

  console.log(`[fixNoemaLoras] Connecting to ${uri}`);
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const legacyCol = client.db(legacyDbName).collection('loras');
    const newModelsCol = client.db(newDbName).collection('loraModels');
    const newTrainCol = client.db(newDbName).collection('loraTrainings');

    const [legacyDocs, newDocs] = await Promise.all([
      legacyCol.find({}, { projection: { _id: 1, lora_name: 1 } }).toArray(),
      newModelsCol.find({}, { projection: { _id: 1, name: 1, slug: 1 } }).toArray(),
    ]);

    const toMap = (arr, field) => arr.reduce((acc, doc) => {
      const v = doc[field];
      if (typeof v === 'string') acc[v.toLowerCase()] = doc;
      return acc;
    }, {});

    const legacyMap = toMap(legacyDocs, 'lora_name');
    const newMap = toMap(newDocs, 'name');

    const actions = {
      updateCaps: [], // { _id, newName, newSlug }
      legacyOnly: [], // legacy doc
      renameDeathburger: null, // { _id, newName, newSlug }
      removeIds: [], // array of _ids to delete
    };

    // Detect capitalization mismatches & legacy only
    for (const lower in legacyMap) {
      const leg = legacyMap[lower];
      const cur = newMap[lower];
      const canonicalName = leg.lora_name;
      const canonicalSlug = toSlug(canonicalName);

      if (cur) {
        if (cur.name !== canonicalName || cur.slug !== canonicalSlug) {
          // Special case deathburger handled later
          if (lower === 'deathburgerflux') continue;
          actions.updateCaps.push({ _id: cur._id, newName: canonicalName, newSlug: canonicalSlug });
        }
      } else {
        actions.legacyOnly.push(leg);
      }
    }

    // deathburger rename
    if (newMap['deathburgerflux']) {
      const cur = newMap['deathburgerflux'];
      actions.renameDeathburger = {
        _id: cur._id,
        newName: 'DeathBurgerflux_000003000',
        newSlug: 'deathburgerflux_000003000',
      };
    }

    // Removal list – match if `name` or `slug` contains unwanted keyword (case-insensitive)
    const unwantedRegexes = UNWANTED.map(u => new RegExp(u, 'i'));
    for (const doc of newDocs) {
      if (unwantedRegexes.some(rx => rx.test(doc.name) || rx.test(doc.slug))) {
        actions.removeIds.push(doc._id);
      }
    }

    // --- Summary ---
    const summary = {
      capitalizationFixes: actions.updateCaps.length,
      legacyInserts: actions.legacyOnly.length,
      renameDeathburger: !!actions.renameDeathburger,
      removeCount: actions.removeIds.length,
    };

    console.table(summary);

    if (!apply) {
      if (Object.values(summary).some(v => v)) {
        console.log('\nRun with --apply to perform these changes.');
        process.exitCode = 1;
      } else {
        console.log('✅ No changes required.');
      }
      return;
    }

    // --- APPLY CHANGES ---
    // 1. Capitalization fixes
    if (actions.updateCaps.length) {
      await Promise.all(actions.updateCaps.map(({ _id, newName, newSlug }) =>
        newModelsCol.updateOne({ _id }, { $set: { name: newName, slug: newSlug } })
      ));
      console.log(`✏️  Updated capitalization for ${actions.updateCaps.length} models.`);
    }

    // 2. Insert legacy-only models (and trainings) via transformer
    if (actions.legacyOnly.length) {
      console.log('🚚 Inserting missing legacy models…');
      const { loraModels, loraTrainings } = await transformLegacyLoras();
      // Filter to just ones needed
      const neededNames = new Set(actions.legacyOnly.map(d => d.lora_name));
      const modelsToInsert = loraModels.filter(m => neededNames.has(m.name));
      const trainingsToInsert = loraTrainings.filter(t => neededNames.has(t.preferredTrigger) || neededNames.has(t.name));
      if (modelsToInsert.length) {
        await newModelsCol.insertMany(modelsToInsert);
        console.log(`📦 Inserted ${modelsToInsert.length} models.`);
      }
      if (trainingsToInsert.length) {
        await newTrainCol.insertMany(trainingsToInsert);
        console.log(`📚 Inserted ${trainingsToInsert.length} trainings.`);
      }
    }

    // 3. Rename deathburgerflux
    if (actions.renameDeathburger) {
      const { _id, newName, newSlug } = actions.renameDeathburger;
      await newModelsCol.updateOne({ _id }, { $set: { name: newName, slug: newSlug } });
      console.log('🔄 Renamed deathburgerflux → DeathBurgerflux_000003000.');
    }

    // 4. Remove unwanted models & their trainings
    if (actions.removeIds.length) {
      const deleteRes = await newModelsCol.deleteMany({ _id: { $in: actions.removeIds } });
      const trainDelRes = await newTrainCol.deleteMany({ outputLoRAId: { $in: actions.removeIds } });
      console.log(`🗑️  Removed ${deleteRes.deletedCount} models and ${trainDelRes.deletedCount} related trainings.`);
    }

    console.log('🎉 Fixes applied successfully.');
  } catch (err) {
    console.error('[fixNoemaLoras] ❌ Error:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
