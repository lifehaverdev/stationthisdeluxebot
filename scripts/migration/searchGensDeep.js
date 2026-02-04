/**
 * searchGensDeep.js - Deep search gens collection
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const gensCol = legacyDb.collection('gens');

  const userId = 6014708959;

  console.log('\n=== Searching gens for Tiger + BALONEYAGA ===\n');

  // Search in promptObj.prompt
  const results = await gensCol.find({
    userId,
    'promptObj.prompt': { $regex: /tiger/i }
  }).toArray();

  console.log(`Found ${results.length} Tiger gens for this user`);

  // Filter for BALONEYAGA
  const baloneyaga = results.filter(g =>
    g.promptObj?.prompt?.toLowerCase().includes('baloneyaga')
  );

  console.log(`Tiger + BALONEYAGA: ${baloneyaga.length}\n`);

  // Show all with full details
  for (const gen of baloneyaga) {
    const ts = gen.timestamp;
    let dateStr = ts;
    if (ts) {
      const d = new Date(ts);
      dateStr = d.toLocaleString('en-US', { timeZone: 'America/New_York' });
    }

    console.log('========================================');
    console.log('Date (EDT):', dateStr);
    console.log('========================================');
    console.log('_id:', gen._id);
    console.log('runId:', gen.runId);
    console.log('status:', gen.status);
    console.log('duration:', gen.duration);
    console.log('type:', gen.type);

    console.log('\nOutputs:');
    if (gen.outputs) {
      console.log(JSON.stringify(gen.outputs, null, 2));
    }

    console.log('\nPromptObj:');
    const po = gen.promptObj || {};
    console.log('  type:', po.type);
    console.log('  seed:', po.seed);
    console.log('  cfg:', po.cfg);
    console.log('  steps:', po.steps);
    console.log('  checkpoint:', po.checkpoint);
    console.log('  input_width:', po.input_width);
    console.log('  input_height:', po.input_height);

    console.log('\nFull prompt:');
    console.log(po.prompt);

    console.log('\n');
  }

  // Also search July 2025 specifically
  console.log('\n=== All user gens in July 2025 ===\n');

  const julyStart = new Date('2025-07-01T00:00:00Z');
  const julyEnd = new Date('2025-08-01T00:00:00Z');

  // timestamp is stored as ISO string in gens
  const julyGens = await gensCol.find({
    userId,
    timestamp: {
      $gte: julyStart.toISOString(),
      $lt: julyEnd.toISOString()
    }
  }).limit(20).toArray();

  console.log(`Found ${julyGens.length} gens in July 2025 for this user`);

  // Check for any around 7/14
  const july14Gens = julyGens.filter(g => {
    const ts = new Date(g.timestamp);
    return ts >= new Date('2025-07-14T00:00:00Z') && ts < new Date('2025-07-15T00:00:00Z');
  });

  console.log(`On 7/14: ${july14Gens.length}`);

  for (const gen of july14Gens) {
    const dateStr = new Date(gen.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' });
    console.log('\n---');
    console.log('Date (EDT):', dateStr);
    console.log('type:', gen.type);
    console.log('prompt snippet:', (gen.promptObj?.prompt || '').substring(0, 100));
  }

  await client.close();
})();
