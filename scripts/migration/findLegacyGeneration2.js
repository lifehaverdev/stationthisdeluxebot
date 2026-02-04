/**
 * findLegacyGeneration2.js - Broader search
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');
  const galleryCol = legacyDb.collection('gallery');

  // Date range for July 24, 2025
  const startDate = new Date('2025-07-24T00:00:00Z');
  const endDate = new Date('2025-07-25T00:00:00Z');

  console.log('\n=== All Tiger generations on 7/24/25 ===\n');

  // Search by prompt containing tiger
  let results = await studioCol.find({
    collectionId: 9351423251993,
    createdAt: { $gte: startDate, $lt: endDate },
    prompt: { $regex: /tiger/i }
  }).toArray();

  console.log(`Found ${results.length} tiger generations on 7/24/25\n`);

  for (const gen of results) {
    console.log('---');
    console.log('_id:', gen._id);
    console.log('status:', gen.status);
    console.log('files:', gen.files?.[0]?.url);
    console.log('traits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}: ${trait.value?.name} - "${trait.value?.prompt?.substring(0, 50)}..."`);
    }
    console.log('generation:', JSON.stringify(gen.generation));
    console.log('');
  }

  // Check what "arcade" backgrounds exist in the collection
  console.log('\n=== Available backgrounds with "arcade" in AnimiliaCorp ===\n');
  const gallery = await galleryCol.findOne({ collectionId: 9351423251993 });
  const backgrounds = gallery?.config?.traitTypes?.find(t => t.title === 'Background');
  if (backgrounds) {
    const arcadeBackgrounds = backgrounds.traits.filter(t =>
      t.name.toLowerCase().includes('arcade') ||
      t.prompt.toLowerCase().includes('arcade')
    );
    console.log('Arcade-related backgrounds:');
    for (const bg of arcadeBackgrounds) {
      console.log(`  - ${bg.name}: ${bg.prompt.substring(0, 80)}...`);
    }
  }

  // Check what "taint" fits exist
  console.log('\n=== Available fits with "taint" in AnimiliaCorp ===\n');
  const fits = gallery?.config?.traitTypes?.find(t => t.title === 'Fit' || t.title === 'Special');
  if (fits) {
    const taintFits = fits.traits.filter(t =>
      t.name.toLowerCase().includes('taint') ||
      t.prompt.toLowerCase().includes('taint')
    );
    console.log('Taint-related fits:');
    for (const fit of taintFits) {
      console.log(`  - ${fit.name}: ${fit.prompt.substring(0, 80)}...`);
    }
  }

  // Search for arcade background generations on 7/24
  console.log('\n=== Searching for arcade background on 7/24/25 ===\n');
  results = await studioCol.find({
    collectionId: 9351423251993,
    createdAt: { $gte: startDate, $lt: endDate },
    prompt: { $regex: /arcade/i }
  }).toArray();

  console.log(`Found ${results.length} arcade generations on 7/24/25\n`);
  for (const gen of results) {
    console.log('---');
    console.log('_id:', gen._id);
    console.log('files:', gen.files?.[0]?.url);
    console.log('traits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}: ${trait.value?.name}`);
    }
    console.log('');
  }

  // Expand date range to find the generation
  console.log('\n=== Tiger generations around 7/24 (7/20 - 7/28) ===\n');
  const widerStart = new Date('2025-07-20T00:00:00Z');
  const widerEnd = new Date('2025-07-28T00:00:00Z');

  results = await studioCol.find({
    collectionId: 9351423251993,
    createdAt: { $gte: widerStart, $lt: widerEnd },
    prompt: { $regex: /tiger/i }
  }).toArray();

  console.log(`Found ${results.length} tiger generations 7/20-7/28\n`);

  // Filter for taint
  const taintTigers = results.filter(r =>
    r.prompt?.toLowerCase().includes('taint') ||
    r.traits?.some(t => t.value?.name?.toLowerCase().includes('taint'))
  );

  console.log(`Of those, ${taintTigers.length} have "taint":\n`);
  for (const gen of taintTigers) {
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
