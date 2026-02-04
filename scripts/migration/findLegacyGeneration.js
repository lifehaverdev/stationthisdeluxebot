/**
 * findLegacyGeneration.js
 *
 * Search for a specific generation in the legacy stationthisbot database.
 *
 * Usage:
 *   scripts/run-with-env.sh node scripts/migration/findLegacyGeneration.js
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');

  // Search for generation on 7/24/25 with tiger + taint shirt + arcade
  // Date range for July 24, 2025
  const startDate = new Date('2025-07-24T00:00:00Z');
  const endDate = new Date('2025-07-25T00:00:00Z');

  console.log('\n=== Searching for Tiger + Taint + Arcade generation on 7/24/25 ===\n');

  // First, let's search by traits
  const query = {
    collectionId: 9351423251993, // AnimiliaCorp
    createdAt: { $gte: startDate, $lt: endDate },
    $or: [
      { 'traits.value.name': { $regex: /tiger/i } },
      { prompt: { $regex: /tiger/i } }
    ]
  };

  const results = await studioCol.find(query).toArray();
  console.log(`Found ${results.length} tiger generations on 7/24/25\n`);

  // Filter for ones with "taint" in traits or prompt
  const taintResults = results.filter(r => {
    const hasTaintTrait = r.traits?.some(t =>
      t.value?.name?.toLowerCase().includes('taint') ||
      t.value?.prompt?.toLowerCase().includes('taint')
    );
    const hasTaintPrompt = r.prompt?.toLowerCase().includes('taint');
    return hasTaintTrait || hasTaintPrompt;
  });

  console.log(`Of those, ${taintResults.length} have "taint" in traits/prompt\n`);

  // Filter for arcade background
  const arcadeResults = taintResults.filter(r => {
    const hasArcadeTrait = r.traits?.some(t =>
      t.value?.name?.toLowerCase().includes('arcade') ||
      t.value?.prompt?.toLowerCase().includes('arcade') ||
      t.type?.toLowerCase() === 'background'
    );
    const hasArcadePrompt = r.prompt?.toLowerCase().includes('arcade');
    return hasArcadeTrait || hasArcadePrompt;
  });

  console.log(`Of those, ${arcadeResults.length} have "arcade" in traits/prompt\n`);

  // Show all taint results with their details
  console.log('=== Taint shirt generations ===\n');
  for (const gen of taintResults) {
    console.log('---');
    console.log('_id:', gen._id);
    console.log('status:', gen.status);
    console.log('createdAt:', gen.createdAt);
    console.log('files:', gen.files?.map(f => f.url).join('\n        '));
    console.log('traits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}: ${trait.value?.name}`);
    }
    console.log('\ngeneration settings:');
    console.log('  seed:', gen.generation?.seed);
    console.log('  cfg:', gen.generation?.cfg);
    console.log('  checkpoint:', gen.generation?.checkpoint);
    console.log('  duration:', gen.generation?.duration);
    console.log('\nprompt:', gen.prompt?.substring(0, 300) + '...');
    console.log('');
  }

  // If no results, try a broader search
  if (taintResults.length === 0) {
    console.log('\n=== No exact matches. Trying broader search for "taint" on that date ===\n');

    const broaderQuery = {
      collectionId: 9351423251993,
      createdAt: { $gte: startDate, $lt: endDate },
      $or: [
        { prompt: { $regex: /taint/i } },
        { 'traits.value.name': { $regex: /taint/i } }
      ]
    };

    const broaderResults = await studioCol.find(broaderQuery).toArray();
    console.log(`Found ${broaderResults.length} generations with "taint" on 7/24/25\n`);

    for (const gen of broaderResults) {
      console.log('---');
      console.log('_id:', gen._id);
      console.log('files:', gen.files?.map(f => f.url).join('\n        '));
      console.log('traits:');
      for (const trait of (gen.traits || [])) {
        console.log(`  ${trait.type}: ${trait.value?.name}`);
      }
      console.log('generation seed:', gen.generation?.seed);
      console.log('');
    }
  }

  // Also search across all dates for tiger+taint+arcade to be thorough
  if (taintResults.length === 0) {
    console.log('\n=== Searching ALL dates for Tiger + Taint + Arcade ===\n');

    const allTimeQuery = {
      collectionId: 9351423251993,
      prompt: { $regex: /tiger.*taint|taint.*tiger/i }
    };

    const allTimeResults = await studioCol.find(allTimeQuery).limit(10).toArray();
    console.log(`Found ${allTimeResults.length} tiger+taint generations (all time, limit 10)\n`);

    for (const gen of allTimeResults) {
      console.log('---');
      console.log('_id:', gen._id);
      console.log('createdAt:', gen.createdAt);
      console.log('files:', gen.files?.map(f => f.url).join('\n        '));
      console.log('traits:');
      for (const trait of (gen.traits || [])) {
        console.log(`  ${trait.type}: ${trait.value?.name}`);
      }
      console.log('');
    }
  }

  await client.close();
})();
