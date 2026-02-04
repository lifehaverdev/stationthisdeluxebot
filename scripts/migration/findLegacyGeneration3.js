/**
 * findLegacyGeneration3.js - Search by exact trait names
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');

  // Search for Tiger + Taint Michael + Neon Graveyard (arcade)
  console.log('\n=== Searching for Tiger + Taint Michael + Neon Graveyard ===\n');

  let results = await studioCol.find({
    collectionId: 9351423251993,
    'traits.value.name': 'Tiger',
  }).toArray();

  console.log(`Total Tiger generations: ${results.length}`);

  // Filter for Taint Michael
  let filtered = results.filter(r =>
    r.traits?.some(t => t.value?.name === 'Taint Michael')
  );
  console.log(`With Taint Michael: ${filtered.length}`);

  // Filter for Neon Graveyard
  filtered = filtered.filter(r =>
    r.traits?.some(t => t.value?.name === 'Neon Graveyard')
  );
  console.log(`With Neon Graveyard (arcade): ${filtered.length}\n`);

  if (filtered.length > 0) {
    for (const gen of filtered) {
      console.log('=== FOUND EXACT MATCH ===');
      console.log('_id:', gen._id);
      console.log('createdAt:', gen.createdAt);
      console.log('status:', gen.status);
      console.log('files:', gen.files?.[0]?.url);
      console.log('\ntraits:');
      for (const trait of (gen.traits || [])) {
        console.log(`  ${trait.type}: ${trait.value?.name}`);
        console.log(`    prompt: ${trait.value?.prompt}`);
        console.log(`    rarity: ${trait.value?.rarity}`);
      }
      console.log('\ngeneration settings:');
      console.log(JSON.stringify(gen.generation, null, 2));
      console.log('\nconfigHash:', gen.configHash);
      console.log('workflow:', gen.workflow);
      console.log('\nfull prompt:');
      console.log(gen.prompt);
      console.log('');
    }
  }

  // Also show any Tiger + any arcade-like background
  console.log('\n=== All Tiger + Neon Graveyard (any fit) ===\n');
  const tigerArcade = results.filter(r =>
    r.traits?.some(t => t.value?.name === 'Neon Graveyard')
  );
  console.log(`Found ${tigerArcade.length} Tiger + Neon Graveyard generations\n`);

  for (const gen of tigerArcade.slice(0, 5)) {
    console.log('---');
    console.log('_id:', gen._id);
    console.log('createdAt:', gen.createdAt);
    console.log('files:', gen.files?.[0]?.url);
    console.log('traits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}: ${trait.value?.name}`);
    }
    console.log('');
  }

  // Show all Tiger + Taint Michael (any background)
  console.log('\n=== All Tiger + Taint Michael (any background) ===\n');
  const tigerTaint = results.filter(r =>
    r.traits?.some(t => t.value?.name === 'Taint Michael')
  );
  console.log(`Found ${tigerTaint.length} Tiger + Taint Michael generations\n`);

  for (const gen of tigerTaint) {
    console.log('---');
    console.log('_id:', gen._id);
    console.log('createdAt:', gen.createdAt);
    console.log('status:', gen.status);
    console.log('files:', gen.files?.[0]?.url);
    console.log('traits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}: ${trait.value?.name}`);
    }
    console.log('generation:', JSON.stringify(gen.generation));
    console.log('');
  }

  await client.close();
})();
