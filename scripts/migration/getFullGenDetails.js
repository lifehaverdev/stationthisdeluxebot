/**
 * getFullGenDetails.js - Get complete details for specific generations
 */

const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');
  const galleryCol = legacyDb.collection('gallery');

  // Get the two Tiger + Taint Michael generations
  const ids = [
    '6878ea55470de28a10403374', // burnt orange, Icefang Crater
    '68790c5d470de28a104036b6', // iridescent white, Luna Station X
  ];

  console.log('\n=== Full Generation Details ===\n');

  for (const id of ids) {
    const gen = await studioCol.findOne({ _id: new ObjectId(id) });
    if (!gen) continue;

    console.log('========================================');
    console.log('Generation ID:', gen._id);
    console.log('========================================');
    console.log('\nBasic Info:');
    console.log('  createdAt:', gen.createdAt);
    console.log('  status:', gen.status);
    console.log('  collectionId:', gen.collectionId);
    console.log('  workflow:', gen.workflow);
    console.log('  configHash:', gen.configHash);

    console.log('\nImage URL:');
    console.log(' ', gen.files?.[0]?.url);

    console.log('\nTraits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}:`);
      console.log(`    name: ${trait.value?.name}`);
      console.log(`    prompt: ${trait.value?.prompt}`);
      console.log(`    rarity: ${trait.value?.rarity}`);
    }

    console.log('\nGeneration Settings:');
    console.log('  seed:', gen.generation?.seed);
    console.log('  cfg:', gen.generation?.cfg);
    console.log('  checkpoint:', gen.generation?.checkpoint);
    console.log('  duration:', gen.generation?.duration, 'ms');
    console.log('  timestamp:', new Date(gen.generation?.timestamp));

    console.log('\nFull Prompt:');
    console.log(gen.prompt);

    console.log('\n');
  }

  // Also get the collection config to show master prompt
  console.log('\n========================================');
  console.log('Collection Master Config');
  console.log('========================================\n');

  const gallery = await galleryCol.findOne({ collectionId: 9351423251993 });
  console.log('Master Prompt:');
  console.log(gallery?.config?.masterPrompt);
  console.log('\nWorkflow:', gallery?.config?.workflow);

  await client.close();
})();
