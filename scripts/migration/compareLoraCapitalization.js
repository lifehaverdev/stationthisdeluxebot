#!/usr/bin/env node
// Script: compareLoraCapitalization.js
// Purpose: Compare the capitalization of LoRA `name` fields between the legacy
//          `stationthisbot.loras` collection and the new `noema.loraModels`
//          collection. Reports discrepancies where the names match
//          case-insensitively but have different capitalization.
//
// Usage:
//   node scripts/migration/compareLoraCapitalization.js [--json]
//
// Environment variables:
//   MONGO_URI       – MongoDB connection string (defaults to process.env.MONGO_PASS or "mongodb://localhost:27017")
//   LEGACY_DB_NAME  – Defaults to "stationthisbot"
//   NEW_DB_NAME     – Defaults to "noema"
//
// Notes:
//   • This script performs a read-only audit – it does not modify any data.
//   • Pass the --json flag to output machine-readable JSON instead of human-readable text.
// -----------------------------------------------------------------------------

const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGO_PASS || process.env.MONGO_URI || 'mongodb://localhost:27017';
  const legacyDbName = process.env.LEGACY_DB_NAME || 'stationthisbot';
  const newDbName = process.env.NEW_DB_NAME || 'noema';
  const outputJson = process.argv.includes('--json');

  console.log(`[compareLoraCapitalization] Connecting to MongoDB @ ${uri}`);

  const client = new MongoClient(uri);

  try {
    await client.connect();

    const legacyCollection = client.db(legacyDbName).collection('loras');
    const newCollection = client.db(newDbName).collection('loraModels');

    console.log(`[compareLoraCapitalization] Fetching names from ${legacyDbName}.loras …`);
    const legacyDocs = await legacyCollection.find({}, { projection: { _id: 0, lora_name: 1 } }).toArray();
    console.log(`[compareLoraCapitalization] Fetched ${legacyDocs.length} legacy docs.`);

    console.log(`[compareLoraCapitalization] Fetching names from ${newDbName}.loraModels …`);
    const newDocs = await newCollection.find({}, { projection: { _id: 0, name: 1 } }).toArray();
    console.log(`[compareLoraCapitalization] Fetched ${newDocs.length} new docs.`);

    // Build maps keyed by lowercase name → original name
    const toMap = (arr, field) => arr.reduce((acc, doc) => {
      const val = doc[field];
      if (typeof val !== 'string') return acc;
      acc[val.toLowerCase()] = val;
      return acc;
    }, {});

    const legacyMap = toMap(legacyDocs, 'lora_name');
    const newMap = toMap(newDocs, 'name');

    const discrepancies = [];

    // Check capitalization differences & missing in new
    for (const lowerName in legacyMap) {
      const legacyName = legacyMap[lowerName];
      const newName = newMap[lowerName];
      if (!newName) {
        discrepancies.push({ type: 'missingInNew', lowerName, legacyName });
      } else if (legacyName !== newName) {
        discrepancies.push({ type: 'capitalization', lowerName, legacyName, newName });
      }
    }

    // Check names present in new but missing in legacy
    for (const lowerName in newMap) {
      if (!Object.prototype.hasOwnProperty.call(legacyMap, lowerName)) {
        discrepancies.push({ type: 'missingInLegacy', lowerName, newName: newMap[lowerName] });
      }
    }

    // Output results
    const exitWithError = discrepancies.length > 0;

    if (outputJson) {
      console.log(JSON.stringify({ total: discrepancies.length, discrepancies }, null, 2));
    } else {
      console.log('\n================ LoRA Name Audit ================');
      if (discrepancies.length === 0) {
        console.log('✅ All names match exactly across databases.');
      } else {
        discrepancies.forEach((d, idx) => {
          if (d.type === 'capitalization') {
            console.log(`${idx + 1}. Capitalization mismatch: "${d.legacyName}" ⇄ "${d.newName}"`);
          } else if (d.type === 'missingInNew') {
            console.log(`${idx + 1}. Present in legacy only: "${d.legacyName}"`);
          } else if (d.type === 'missingInLegacy') {
            console.log(`${idx + 1}. Present in new only: "${d.newName}"`);
          }
        });
        console.log(`\nTotal issues: ${discrepancies.length}`);
      }
      console.log('===============================================\n');
    }

    if (exitWithError) {
      console.error('[compareLoraCapitalization] ❌ Name inconsistencies detected.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[compareLoraCapitalization] ❌ Error:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
