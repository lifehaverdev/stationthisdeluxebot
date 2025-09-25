const { MongoClient } = require('mongodb');
require('dotenv').config();

(async () => {
  const uri = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017/make';
  const toolName = process.argv[2];
  if (!toolName) {
    console.error('Usage: node tool_usage_stats.js <toolDisplayName>');
    process.exit(1);
  }

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const dbName = 'noema' || process.env.DB_NAME || process.argv[3] || undefined; // optional 3rd arg
  try {
    await client.connect();
    const db = dbName ? client.db(dbName) : client.db();
    const coll = db.collection('generationOutputs');

    const agg = [
      { $match: { toolDisplayName: toolName, durationMs: { $gt: 0 }, costUsd: { $gt: 0 } } },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          avgDurationMs: { $avg: '$durationMs' },
          avgCostUsd: { $avg: '$costUsd' }
      }}
    ];

    const [stats] = await coll.aggregate(agg).toArray();
    if (!stats) {
      console.log(`No records found for '${toolName}'.`);
    } else {
      console.log(JSON.stringify(stats, null, 2));
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
})();
