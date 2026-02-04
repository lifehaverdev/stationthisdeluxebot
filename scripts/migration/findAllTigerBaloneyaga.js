/**
 * findAllTigerBaloneyaga.js - Find ALL Tiger + BALONEYAGA generations
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');

  console.log('\n=== ALL Tiger + BALONEYAGA generations ===\n');

  // Find all Tiger generations
  const results = await studioCol.find({
    collectionId: 9351423251993,
    'traits.value.name': 'Tiger'
  }).toArray();

  console.log(`Total Tiger generations: ${results.length}`);

  // Filter for BALONEYAGA
  const baloneyagaResults = results.filter(r =>
    r.traits?.some(t => t.value?.name?.toLowerCase().includes('baloneyaga'))
  );

  console.log(`Tiger + BALONEYAGA: ${baloneyagaResults.length}\n`);

  // Sort by date
  baloneyagaResults.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Show all with full details
  for (const gen of baloneyagaResults) {
    const edtDate = new Date(gen.createdAt).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    console.log('========================================');
    console.log('Date (EDT):', edtDate);
    console.log('========================================');
    console.log('_id:', gen._id);
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

  await client.close();
})();
