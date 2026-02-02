const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const datasetId = process.argv[2] || '69807e1564a2433d36d7f2f3';
  const client = new MongoClient(process.env.MONGO_PASS);
  await client.connect();
  const db = client.db('noema');

  // Find ALL tasks for this dataset
  const tasks = await db.collection('embellishmentTasks').find({ datasetId }).toArray();
  console.log('Tasks found:', tasks.length);
  tasks.forEach(t => console.log('  ', t._id.toString(), t.status, t.type));

  // Force cancel any non-completed tasks
  const result = await db.collection('embellishmentTasks').updateMany(
    { datasetId, status: { $nin: ['completed', 'cancelled', 'failed'] } },
    { $set: { status: 'cancelled' } }
  );
  console.log('Updated tasks:', result.modifiedCount);

  // Also check dataset embellishments
  const dataset = await db.collection('datasets').findOne({ _id: new ObjectId(datasetId) });
  if (dataset && dataset.embellishments) {
    console.log('Dataset embellishments:', dataset.embellishments.length);
    dataset.embellishments.forEach(e => console.log('  ', e._id, e.status, e.type));

    // Update any running ones to cancelled
    let changed = false;
    for (const e of dataset.embellishments) {
      if (e.status === 'running' || e.status === 'pending') {
        e.status = 'cancelled';
        changed = true;
      }
    }
    if (changed) {
      await db.collection('datasets').updateOne(
        { _id: new ObjectId(datasetId) },
        { $set: { embellishments: dataset.embellishments } }
      );
      console.log('Updated dataset embellishments');
    }
  }

  await client.close();
  console.log('Done!');
}

main().catch(console.error);
