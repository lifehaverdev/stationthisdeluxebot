/**
 * findRegularGen714.js - Search ALL generation sources for Tiger + BALONEYAGA on 7/14/2025
 */

const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const noemaDb = client.db('noema');

  // Target: 7/14/2025 3:21 PM EDT = 7:21 PM UTC
  const dayStart = new Date('2025-07-14T00:00:00Z');
  const dayEnd = new Date('2025-07-15T00:00:00Z');

  console.log('\n=== Searching ALL sources for Tiger + BALONEYAGA on 7/14/2025 ===\n');

  // 1. Check noema generationOutputs
  console.log('--- Noema generationOutputs ---\n');
  const genOutputsCol = noemaDb.collection('generationOutputs');

  // Search by prompt content
  let noemaResults = await genOutputsCol.find({
    requestTimestamp: { $gte: dayStart, $lt: dayEnd },
    $or: [
      { 'requestPayload.prompt': { $regex: /tiger/i } },
      { 'metadata.traits': { $elemMatch: { 'value.name': 'Tiger' } } }
    ]
  }).toArray();

  console.log(`Found ${noemaResults.length} Tiger generations in noema on 7/14`);

  // Filter for BALONEYAGA
  let noemaBaloneyaga = noemaResults.filter(r => {
    const prompt = r.requestPayload?.prompt || '';
    const traits = r.metadata?.traits || [];
    return prompt.toLowerCase().includes('baloneyaga') ||
           traits.some(t => t.value?.name?.toLowerCase().includes('baloneyaga'));
  });

  console.log(`Of those, ${noemaBaloneyaga.length} have BALONEYAGA\n`);

  for (const gen of noemaBaloneyaga) {
    console.log('Found in noema generationOutputs:');
    console.log(JSON.stringify(gen, null, 2));
  }

  // 2. Check legacy users' generation history or other collections
  console.log('\n--- Legacy stationthisbot collections ---\n');

  // List all collections in stationthisbot
  const collections = await legacyDb.listCollections().toArray();
  console.log('Available collections:', collections.map(c => c.name).join(', '));

  // Check for any generation-related collections
  const genCollections = collections.filter(c =>
    c.name.includes('gen') ||
    c.name.includes('output') ||
    c.name.includes('history') ||
    c.name.includes('image')
  );

  for (const col of genCollections) {
    const colObj = legacyDb.collection(col.name);
    const count = await colObj.countDocuments({});
    console.log(`\n${col.name}: ${count} documents`);

    // Try to find relevant records
    if (count > 0 && count < 100000) {
      const sample = await colObj.find({
        $or: [
          { createdAt: { $gte: dayStart, $lt: dayEnd } },
          { timestamp: { $gte: dayStart.getTime(), $lt: dayEnd.getTime() } }
        ]
      }).limit(5).toArray();

      if (sample.length > 0) {
        console.log(`  Sample from 7/14:`, sample.length, 'records');
      }
    }
  }

  // 3. Search by user ID across all dates for Tiger + BALONEYAGA prompt
  console.log('\n--- Searching noema for ALL Tiger + BALONEYAGA (any date) ---\n');

  const userId = '6014708959';
  const masterAccountId = new ObjectId('68c0d8a1120ca5d7415ad1ee');

  const allNoemaGens = await genOutputsCol.find({
    $or: [
      { masterAccountId: masterAccountId },
      { 'metadata.userId': userId }
    ],
    $or: [
      { 'requestPayload.prompt': { $regex: /tiger.*baloneyaga/i } },
      { 'requestPayload.prompt': { $regex: /baloneyaga.*tiger/i } }
    ]
  }).toArray();

  console.log(`Found ${allNoemaGens.length} Tiger + BALONEYAGA in noema (all time)`);

  for (const gen of allNoemaGens) {
    const date = gen.requestTimestamp || gen.createdAt;
    console.log('\n---');
    console.log('Date:', date);
    console.log('_id:', gen._id);
    console.log('status:', gen.status);
    console.log('toolDisplayName:', gen.toolDisplayName);
    if (gen.artifactUrls?.[0]) {
      console.log('image:', gen.artifactUrls[0].url || gen.artifactUrls[0]);
    }
  }

  // 4. Also search around that specific time more broadly
  console.log('\n--- All generations by this user around 3:21 PM EDT on 7/14 ---\n');

  const targetStart = new Date('2025-07-14T19:00:00Z'); // 3:00 PM EDT
  const targetEnd = new Date('2025-07-14T20:00:00Z');   // 4:00 PM EDT

  const aroundTimeGens = await genOutputsCol.find({
    masterAccountId: masterAccountId,
    requestTimestamp: { $gte: targetStart, $lte: targetEnd }
  }).toArray();

  console.log(`Found ${aroundTimeGens.length} generations by user around 3:00-4:00 PM EDT on 7/14`);

  for (const gen of aroundTimeGens) {
    console.log('\n---');
    console.log('Time (EDT):', new Date(gen.requestTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    console.log('_id:', gen._id);
    console.log('tool:', gen.toolDisplayName);
    console.log('prompt snippet:', (gen.requestPayload?.prompt || '').substring(0, 100));
    if (gen.artifactUrls?.[0]) {
      console.log('image:', gen.artifactUrls[0].url || gen.artifactUrls[0]);
    }
  }

  await client.close();
})();
