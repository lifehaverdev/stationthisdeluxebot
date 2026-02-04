/**
 * findBaloneyagaGraveyard.js - Search for BALONEYAGA + Neon Graveyard
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');

  console.log('\n=== Searching for BALONEYAGA + Neon Graveyard ===\n');

  // Search for BALONEYAGA fit
  const results = await studioCol.find({
    collectionId: 9351423251993,
    'traits.value.name': { $regex: /baloneyaga/i }
  }).toArray();

  console.log(`Found ${results.length} BALONEYAGA generations total\n`);

  // Filter for Neon Graveyard
  const filtered = results.filter(r =>
    r.traits?.some(t => t.value?.name === 'Neon Graveyard')
  );

  console.log(`With Neon Graveyard: ${filtered.length}\n`);

  // Show all matches with full details
  for (const gen of filtered) {
    console.log('========================================');
    console.log('Generation ID:', gen._id);
    console.log('========================================');
    console.log('\nBasic Info:');
    console.log('  createdAt:', gen.createdAt);
    console.log('  status:', gen.status);
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

    console.log('\n=== FULL PROMPT ===');
    console.log(gen.prompt);
    console.log('\n');
  }

  // If none found, show all BALONEYAGA with their backgrounds
  if (filtered.length === 0) {
    console.log('\n=== All BALONEYAGA generations (showing backgrounds) ===\n');
    for (const gen of results.slice(0, 10)) {
      const bg = gen.traits?.find(t => t.type === 'Background');
      const animal = gen.traits?.find(t => t.type === 'Animal');
      const color = gen.traits?.find(t => t.type === 'Color');
      console.log(`${gen.createdAt} - ${animal?.value?.name} / ${bg?.value?.name} / ${color?.value?.name}`);
      console.log(`  ${gen.files?.[0]?.url}`);
    }
  }

  await client.close();
})();
