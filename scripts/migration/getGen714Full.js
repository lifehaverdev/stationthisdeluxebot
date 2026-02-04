/**
 * getGen714Full.js - Get complete raw record for the 7/14 3:20 PM generation
 */

const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;

(async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();

  const legacyDb = client.db('stationthisbot');
  const gensCol = legacyDb.collection('gens');

  // The one at 3:20:55 PM
  const id = '68755897470de28a10402f7b';

  console.log('\n=== COMPLETE RAW RECORD ===\n');

  const doc = await gensCol.findOne({ _id: new ObjectId(id) });

  console.log(JSON.stringify(doc, null, 2));

  await client.close();
})();
