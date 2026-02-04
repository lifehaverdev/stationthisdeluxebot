/**
 * findN64LoraLegacy.js - Search legacy loras collection for N64_Game_Style_F1D
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const lorasCol = legacyDb.collection('loras');

  console.log('\n=== Legacy loras collection - searching for N64 ===\n');

  // Get sample to understand schema
  const sample = await lorasCol.findOne({});
  if (sample) {
    console.log('Sample lora schema keys:', Object.keys(sample));
  }

  // Search for N64 related
  const n64Results = await lorasCol.find({
    $or: [
      { slug: { $regex: /n64/i } },
      { name: { $regex: /n64/i } },
      { trigger: { $regex: /n64/i } },
      { triggerWords: { $regex: /n64/i } },
      { filename: { $regex: /n64/i } },
    ]
  }).toArray();

  console.log(`Found ${n64Results.length} N64-related loras in legacy:\n`);

  for (const lora of n64Results) {
    console.log('---');
    console.log(JSON.stringify(lora, null, 2));
  }

  // Also search for "Game_Style"
  console.log('\n=== Searching for "Game_Style" ===\n');

  const gameStyleResults = await lorasCol.find({
    $or: [
      { slug: { $regex: /game.?style/i } },
      { name: { $regex: /game.?style/i } },
      { trigger: { $regex: /game.?style/i } },
      { filename: { $regex: /game.?style/i } },
    ]
  }).toArray();

  console.log(`Found ${gameStyleResults.length} Game_Style-related loras in legacy:\n`);

  for (const lora of gameStyleResults) {
    console.log('---');
    console.log(JSON.stringify(lora, null, 2));
  }

  // Search for exact "F1D" suffix which seems unique
  console.log('\n=== Searching for "F1D" suffix ===\n');

  const f1dResults = await lorasCol.find({
    $or: [
      { slug: { $regex: /F1D/i } },
      { name: { $regex: /F1D/i } },
      { filename: { $regex: /F1D/i } },
    ]
  }).toArray();

  console.log(`Found ${f1dResults.length} F1D-related loras in legacy:\n`);

  for (const lora of f1dResults) {
    console.log('---');
    console.log(JSON.stringify(lora, null, 2));
  }

  // List ALL loras with "style" in the name to see what's available
  console.log('\n=== All loras with "style" in name ===\n');

  const styleResults = await lorasCol.find({
    $or: [
      { name: { $regex: /style/i } },
      { slug: { $regex: /style/i } },
    ]
  }).limit(30).toArray();

  console.log(`Found ${styleResults.length} style-related loras:\n`);

  for (const lora of styleResults) {
    console.log(`- ${lora.slug || lora.name || lora._id} (trigger: ${lora.trigger || lora.triggerWords?.[0] || 'unknown'})`);
  }

  await client.close();
})();
