const { MongoClient, ObjectId } = require('mongodb');

/**
 * Inspects the `generationOutputs` collection for a specific masterAccountId.
 *
 * Usage:
 *   BOT_NAME=<dbName> MONGODB_URI=<mongoUri> node inspect-generationOutputs.js <masterAccountId> [limit]
 *
 * Environment variables:
 *   BOT_NAME       – MongoDB database name (required)
 *   MONGODB_URI    – Full MongoDB connection string (default: mongodb://localhost:27017)
 *
 * Positional args:
 *   masterAccountId – ObjectId string of the user (required)
 *   limit           – Number of docs to fetch (default: 10)
 */
async function run() {
  const [masterAccountIdArg, limitArg] = process.argv.slice(2);
  if (!masterAccountIdArg) {
    console.error('Usage: node inspect-generationOutputs.js <masterAccountId> [limit]');
    process.exit(1);
  }
  if (!ObjectId.isValid(masterAccountIdArg)) {
    console.error('Invalid masterAccountId. Must be a valid ObjectId.');
    process.exit(1);
  }

  const limit = parseInt(limitArg, 10) || 10;
  const DB_NAME = 'noema' || process.env.BOT_NAME;
  if (!DB_NAME) {
    console.error('Environment variable BOT_NAME must be set to the MongoDB database name.');
    process.exit(1);
  }
  const MONGO_URI = process.env.MONGO_PASS || 'mongodb://localhost:27017';

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log(`Connected to MongoDB (${MONGO_URI}). DB: ${DB_NAME}`);

    const db = client.db(DB_NAME);
    const collection = db.collection('generationOutputs');

    const docs = await collection
      .find({ masterAccountId: new ObjectId(masterAccountIdArg) })
      .sort({ requestTimestamp: -1 })
      .limit(limit)
      .toArray();

    if (docs.length === 0) {
      console.log('No generationOutputs found for this user.');
      return;
    }

    console.log(`Found ${docs.length} generationOutputs (most recent first):\n`);
    docs.forEach((doc, idx) => {
      console.log(`--- [${idx + 1}] _id: ${doc._id.toString()}`);
      console.log(`    toolId:       ${doc.toolId ?? doc.serviceName ?? 'N/A'}`);
      console.log(`    requestTime:  ${doc.requestTimestamp?.toISOString?.()}`);
      console.log(`    status:       ${doc.status}`);
      console.log(`    metadata.platform: ${doc.metadata?.platform}`);
      console.log(`    metadata.platformContext?.platform: ${doc.metadata?.platformContext?.platform}`);
      console.log(`    metadata.notificationContext: ${JSON.stringify(doc.metadata?.notificationContext || {})}`);
      console.log();
    });
  } catch (err) {
    console.error('Error inspecting generationOutputs:', err);
  } finally {
    await client.close();
  }
}

run();
