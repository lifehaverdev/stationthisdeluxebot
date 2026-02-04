/**
 * dumpRawGeneration.js - Dump complete raw generation document
 */

const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const studioCol = legacyDb.collection('studio');

  // The approved Goat + BALONEYAGA + Neon Graveyard
  const id = '684a3c6a470de28a104012a0';

  console.log('\n=== COMPLETE RAW DOCUMENT ===\n');

  const doc = await studioCol.findOne({ _id: new ObjectId(id) });

  console.log(JSON.stringify(doc, null, 2));

  await client.close();
})();
