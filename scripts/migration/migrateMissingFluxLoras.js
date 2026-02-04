/**
 * migrateMissingFluxLoras.js - Migrate specific missing FLUX loras from legacy to noema
 */

const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

const LORAS_TO_MIGRATE = [
  'N64_Game_Style_F1D',
  'Textimprover-FLUX-V0.4',
  'P5Xflux',
  'ThisUserflux',
  'NEKOflux',
  'MetalMouthflux'
];

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const lorasCol = legacyDb.collection('loras');
  const noemaDb = client.db('noema');
  const loraModelsCol = noemaDb.collection('loraModels');

  console.log('\n=== Migrating Missing FLUX Loras to Noema ===\n');

  for (const loraName of LORAS_TO_MIGRATE) {
    console.log(`\nProcessing: ${loraName}`);

    // Get from legacy
    const legacyLora = await lorasCol.findOne({ lora_name: loraName });
    if (!legacyLora) {
      console.log(`  ERROR: Not found in legacy database`);
      continue;
    }

    // Check if already exists in noema
    const existsInNoema = await loraModelsCol.findOne({
      $or: [
        { slug: loraName },
        { name: loraName },
        { slug: loraName.toLowerCase() },
      ]
    });

    if (existsInNoema) {
      console.log(`  SKIP: Already exists in noema (${existsInNoema._id})`);
      continue;
    }

    // Transform legacy schema to noema schema
    const triggerWords = (legacyLora.triggerWords || [])
      .filter(t => t && t !== '#')
      .map(t => t.toLowerCase());

    const tags = [];
    if (legacyLora.tags) {
      for (const [tag, enabled] of Object.entries(legacyLora.tags)) {
        if (enabled) {
          tags.push({ tag: tag.toLowerCase(), source: 'legacy', score: 1 });
        }
      }
    }
    if (legacyLora.type) {
      tags.push({ tag: legacyLora.type.toLowerCase(), source: 'legacy', score: 1 });
    }

    const noemaLora = {
      slug: legacyLora.lora_name,
      name: legacyLora.lora_name,
      triggerWords: triggerWords,
      cognates: legacyLora.cognates || [],
      defaultWeight: legacyLora.default_weight || 1.0,
      version: 'v1.0',
      modelType: legacyLora.type || 'style',
      strength: 'medium',
      checkpoint: legacyLora.version || 'FLUX', // version in legacy = checkpoint
      createdBy: null,
      ownedBy: null,
      visibility: 'public',
      permissionType: 'public',
      monetization: null,
      tags: tags,
      description: legacyLora.description || null,
      examplePrompts: [],
      previewImages: legacyLora.exampleImagePath ? [legacyLora.exampleImagePath] : [],
      usageCount: legacyLora.uses || 0,
      rating: {
        avg: legacyLora.rating || 0,
        count: 0,
        sum: 0
      },
      disabled: legacyLora.disabled || false,
      importedFrom: legacyLora.civitaiLink ? {
        source: 'civitai',
        url: legacyLora.civitaiLink,
        importedAt: new Date()
      } : {
        source: 'legacy_migration',
        url: null,
        importedAt: new Date()
      },
      createdAt: legacyLora.addedDate ? new Date(legacyLora.addedDate) : new Date(),
      migratedFrom: {
        collection: 'stationthisbot.loras',
        originalId: legacyLora._id,
        migratedAt: new Date()
      }
    };

    // Insert into noema
    const result = await loraModelsCol.insertOne(noemaLora);
    console.log(`  SUCCESS: Migrated to noema (${result.insertedId})`);
    console.log(`    slug: ${noemaLora.slug}`);
    console.log(`    checkpoint: ${noemaLora.checkpoint}`);
    console.log(`    triggerWords: ${noemaLora.triggerWords.join(', ')}`);
    console.log(`    usageCount: ${noemaLora.usageCount}`);
  }

  console.log('\n=== Migration Complete ===\n');

  await client.close();
})();
