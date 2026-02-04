/**
 * findN64Lora.js - Search for the N64_Game_Style lora in our database
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const noemaDb = client.db('noema');
  const loraModelsCol = noemaDb.collection('loraModels');

  console.log('\n=== Searching for N64 Game Style LoRA ===\n');

  // Search by various patterns
  const searchPatterns = [
    { slug: { $regex: /n64/i } },
    { name: { $regex: /n64/i } },
    { triggerWords: { $regex: /n64/i } },
    { slug: { $regex: /game.?style/i } },
    { name: { $regex: /game.?style/i } },
  ];

  for (const pattern of searchPatterns) {
    const results = await loraModelsCol.find(pattern).toArray();
    if (results.length > 0) {
      console.log(`\nFound ${results.length} matches for pattern:`, JSON.stringify(pattern));
      for (const lora of results) {
        console.log('\n---');
        console.log('_id:', lora._id);
        console.log('slug:', lora.slug);
        console.log('name:', lora.name);
        console.log('triggerWords:', lora.triggerWords);
        console.log('checkpoint:', lora.checkpoint);
        console.log('visibility:', lora.visibility);
        console.log('moderation.status:', lora.moderation?.status);
        if (lora.importedFrom) {
          console.log('importedFrom:', lora.importedFrom.source, lora.importedFrom.url);
        }
      }
    }
  }

  // Also search specifically for the exact name used in the prompt
  console.log('\n=== Searching for exact "N64_Game_Style_F1D" ===\n');

  const exactMatches = await loraModelsCol.find({
    $or: [
      { slug: 'N64_Game_Style_F1D' },
      { slug: { $regex: /N64_Game_Style_F1D/i } },
      { name: { $regex: /N64_Game_Style_F1D/i } },
      { triggerWords: 'n64style' },
      { triggerWords: { $regex: /n64style/i } },
    ]
  }).toArray();

  if (exactMatches.length > 0) {
    console.log(`Found ${exactMatches.length} exact matches:`);
    for (const lora of exactMatches) {
      console.log('\n---');
      console.log('Full document:', JSON.stringify(lora, null, 2));
    }
  } else {
    console.log('No exact matches found for N64_Game_Style_F1D');
  }

  // Check the legacy stationthisbot database too
  console.log('\n=== Checking legacy stationthisbot database ===\n');

  const legacyDb = client.db('stationthisbot');
  const collections = await legacyDb.listCollections().toArray();
  console.log('Legacy collections:', collections.map(c => c.name).join(', '));

  // Check if there's a loras collection in legacy
  for (const col of collections) {
    if (col.name.toLowerCase().includes('lora')) {
      const legacyLoraCol = legacyDb.collection(col.name);
      const count = await legacyLoraCol.countDocuments({});
      console.log(`\n${col.name}: ${count} documents`);

      const n64Results = await legacyLoraCol.find({
        $or: [
          { slug: { $regex: /n64/i } },
          { name: { $regex: /n64/i } },
          { trigger: { $regex: /n64/i } },
        ]
      }).toArray();

      if (n64Results.length > 0) {
        console.log(`Found ${n64Results.length} N64-related in ${col.name}:`);
        for (const lora of n64Results) {
          console.log(JSON.stringify(lora, null, 2));
        }
      }
    }
  }

  // List all available loras in noema to get an idea of what we have
  console.log('\n=== All LoRAs in noema (first 20) ===\n');

  const allLoras = await loraModelsCol.find({}).limit(20).toArray();
  console.log(`Total loras in noema: ${await loraModelsCol.countDocuments({})}`);

  for (const lora of allLoras) {
    console.log(`- ${lora.slug || lora.name} (${lora.visibility}, ${lora.moderation?.status})`);
  }

  await client.close();
})();
