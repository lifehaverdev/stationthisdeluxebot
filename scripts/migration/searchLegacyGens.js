/**
 * searchLegacyGens.js - Search legacy gens and history collections
 */

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const gensCol = legacyDb.collection('gens');
  const historyCol = legacyDb.collection('history');

  const userId = 6014708959;

  // Target: 7/14/2025 3:21 PM EDT
  const dayStart = new Date('2025-07-14T00:00:00Z');
  const dayEnd = new Date('2025-07-15T00:00:00Z');
  const targetStart = new Date('2025-07-14T19:00:00Z');
  const targetEnd = new Date('2025-07-14T20:00:00Z');

  // First, let's see the schema of these collections
  console.log('\n=== Examining gens collection schema ===\n');
  const genSample = await gensCol.findOne({ userId });
  if (genSample) {
    console.log('Sample gens record keys:', Object.keys(genSample));
    console.log('Sample:', JSON.stringify(genSample, null, 2).substring(0, 1000));
  }

  console.log('\n=== Examining history collection schema ===\n');
  const historySample = await historyCol.findOne({ userId });
  if (historySample) {
    console.log('Sample history record keys:', Object.keys(historySample));
    console.log('Sample:', JSON.stringify(historySample, null, 2).substring(0, 1000));
  }

  // Search gens for Tiger + BALONEYAGA
  console.log('\n=== Searching gens for Tiger + BALONEYAGA on 7/14/2025 ===\n');

  // Try different date field names
  let gensResults = await gensCol.find({
    userId,
    $or: [
      { createdAt: { $gte: dayStart, $lt: dayEnd } },
      { timestamp: { $gte: dayStart.getTime(), $lt: dayEnd.getTime() } },
      { date: { $gte: dayStart, $lt: dayEnd } }
    ]
  }).toArray();

  console.log(`Found ${gensResults.length} gens on 7/14 for this user`);

  // Filter for tiger + baloneyaga
  let tigerBaloneyaga = gensResults.filter(g => {
    const prompt = (g.prompt || g.text || g.input || '').toLowerCase();
    return prompt.includes('tiger') && prompt.includes('baloneyaga');
  });

  console.log(`Tiger + BALONEYAGA: ${tigerBaloneyaga.length}`);

  for (const gen of tigerBaloneyaga) {
    console.log('\n--- Found in gens ---');
    console.log(JSON.stringify(gen, null, 2));
  }

  // Search history
  console.log('\n=== Searching history for Tiger + BALONEYAGA on 7/14/2025 ===\n');

  let historyResults = await historyCol.find({
    userId,
    $or: [
      { createdAt: { $gte: dayStart, $lt: dayEnd } },
      { timestamp: { $gte: dayStart.getTime(), $lt: dayEnd.getTime() } },
      { date: { $gte: dayStart, $lt: dayEnd } }
    ]
  }).toArray();

  console.log(`Found ${historyResults.length} history records on 7/14 for this user`);

  tigerBaloneyaga = historyResults.filter(h => {
    const text = JSON.stringify(h).toLowerCase();
    return text.includes('tiger') && text.includes('baloneyaga');
  });

  console.log(`Tiger + BALONEYAGA: ${tigerBaloneyaga.length}`);

  for (const gen of tigerBaloneyaga) {
    console.log('\n--- Found in history ---');
    console.log(JSON.stringify(gen, null, 2));
  }

  // Broader search - all Tiger + BALONEYAGA in gens for this user
  console.log('\n=== ALL Tiger + BALONEYAGA in gens (any date) ===\n');

  const allUserGens = await gensCol.find({
    userId,
    $or: [
      { prompt: { $regex: /tiger/i } },
      { text: { $regex: /tiger/i } },
      { input: { $regex: /tiger/i } }
    ]
  }).toArray();

  console.log(`Total Tiger gens for user: ${allUserGens.length}`);

  const allTigerBaloneyaga = allUserGens.filter(g => {
    const text = JSON.stringify(g).toLowerCase();
    return text.includes('baloneyaga');
  });

  console.log(`Tiger + BALONEYAGA: ${allTigerBaloneyaga.length}`);

  for (const gen of allTigerBaloneyaga.slice(0, 10)) {
    const date = gen.createdAt || gen.timestamp || gen.date;
    console.log('\n---');
    console.log('Date:', date);
    if (date && typeof date === 'number') {
      console.log('Date (parsed):', new Date(date).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    }
    console.log('_id:', gen._id);
    console.log('Keys:', Object.keys(gen).join(', '));
    const prompt = gen.prompt || gen.text || gen.input || '';
    console.log('Prompt snippet:', prompt.substring(0, 150));
  }

  await client.close();
})();
