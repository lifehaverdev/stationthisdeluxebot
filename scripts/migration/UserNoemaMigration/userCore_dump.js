const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_PASS || process.env.MONGODB_URI;
const NOEMA_DB = 'noema';
if (!mongoUri) {
  console.error('MONGO_PASS or MONGODB_URI not set');
  process.exit(1);
}

(async function() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const col = client.db(NOEMA_DB).collection('userCore');
    const docs = await col.find().toArray();
    console.log(`userCore documents (${docs.length}):`);
    docs.forEach((d, idx) => {
      console.log(`\n--- #${idx + 1} ---`);
      console.dir(d, { depth: null, colors: false });
    });
  } catch (err) {
    console.error('Error dumping userCore:', err);
  } finally {
    await client.close();
  }
})();
