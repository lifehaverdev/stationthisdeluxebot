/**
 * findTigerBaloneyaga714.js - Find Tiger + BALONEYAGA on 7/14/2025 ~3:21 PM EST
 * EST in July = EDT (UTC-4), so 3:21 PM EDT = 19:21 UTC
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');

  // 3:21 PM EDT on 7/14/2025 = 19:21 UTC
  // Search within a window around that time
  const targetTime = new Date('2025-07-14T19:21:00Z');
  const startTime = new Date('2025-07-14T19:00:00Z'); // 3:00 PM EDT
  const endTime = new Date('2025-07-14T20:00:00Z');   // 4:00 PM EDT

  console.log('\n=== Searching for Tiger + BALONEYAGA on 7/14/2025 around 3:21 PM EDT ===\n');
  console.log('Target time (UTC):', targetTime);
  console.log('Search window:', startTime, 'to', endTime);

  // Search for Tiger + BALONEYAGA in that time window
  const results = await studioCol.find({
    collectionId: 9351423251993,
    createdAt: { $gte: startTime, $lte: endTime },
    'traits.value.name': 'Tiger'
  }).toArray();

  console.log(`\nFound ${results.length} Tiger generations in that window\n`);

  // Filter for BALONEYAGA
  const baloneyagaResults = results.filter(r =>
    r.traits?.some(t => t.value?.name?.toLowerCase().includes('baloneyaga'))
  );

  console.log(`Of those, ${baloneyagaResults.length} have BALONEYAGA\n`);

  // Show all matches
  for (const gen of baloneyagaResults) {
    console.log('========================================');
    console.log('FOUND MATCH');
    console.log('========================================');
    console.log('\n_id:', gen._id);
    console.log('createdAt (UTC):', gen.createdAt);
    console.log('createdAt (EDT):', new Date(gen.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    console.log('status:', gen.status);
    console.log('\nImage URL:');
    console.log(gen.files?.[0]?.url);
    console.log('\nTraits:');
    for (const trait of (gen.traits || [])) {
      console.log(`  ${trait.type}: ${trait.value?.name}`);
    }
    console.log('\nGeneration Settings:');
    console.log('  seed:', gen.generation?.seed);
    console.log('  cfg:', gen.generation?.cfg);
    console.log('  checkpoint:', gen.generation?.checkpoint);
    console.log('  duration:', gen.generation?.duration, 'ms');
    console.log('\nFull prompt:');
    console.log(gen.prompt);
    console.log('\n');
  }

  // If no exact matches, expand the search to the whole day
  if (baloneyagaResults.length === 0) {
    console.log('\n=== No exact matches. Searching entire day of 7/14/2025 ===\n');

    const dayStart = new Date('2025-07-14T00:00:00Z');
    const dayEnd = new Date('2025-07-15T00:00:00Z');

    const dayResults = await studioCol.find({
      collectionId: 9351423251993,
      createdAt: { $gte: dayStart, $lt: dayEnd },
      'traits.value.name': 'Tiger'
    }).toArray();

    const dayBaloneyaga = dayResults.filter(r =>
      r.traits?.some(t => t.value?.name?.toLowerCase().includes('baloneyaga'))
    );

    console.log(`Found ${dayBaloneyaga.length} Tiger + BALONEYAGA on 7/14/2025:\n`);

    for (const gen of dayBaloneyaga) {
      console.log('---');
      console.log('_id:', gen._id);
      console.log('createdAt (EDT):', new Date(gen.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      console.log('status:', gen.status);
      console.log('seed:', gen.generation?.seed);
      console.log('image:', gen.files?.[0]?.url);
    }
  }

  await client.close();
})();
