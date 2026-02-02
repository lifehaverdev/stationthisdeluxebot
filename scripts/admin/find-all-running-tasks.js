const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const client = new MongoClient(process.env.MONGO_PASS);
  await client.connect();
  const db = client.db('noema');

  // Find ALL running tasks
  const runningTasks = await db.collection('embellishmentTasks').find({
    status: { $in: ['running', 'pending'] }
  }).toArray();

  console.log('All running/pending tasks:', runningTasks.length);
  for (const t of runningTasks) {
    console.log('  Task:', t._id.toString());
    console.log('    datasetId:', t.datasetId, typeof t.datasetId);
    console.log('    status:', t.status);
    console.log('    type:', t.type);
    console.log('    totalItems:', t.totalItems, 'completed:', t.completedItems);
  }

  // Cancel them all
  if (runningTasks.length > 0) {
    const result = await db.collection('embellishmentTasks').updateMany(
      { status: { $in: ['running', 'pending'] } },
      { $set: { status: 'cancelled' } }
    );
    console.log('\nCancelled:', result.modifiedCount, 'tasks');
  }

  await client.close();
}

main().catch(console.error);
