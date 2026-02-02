const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const datasetId = process.argv[2] || '69807e1564a2433d36d7f2f3';
  const client = new MongoClient(process.env.MONGO_PASS);
  await client.connect();
  const db = client.db('noema');

  const dataset = await db.collection('datasets').findOne({ _id: new ObjectId(datasetId) });
  if (!dataset) {
    console.log('Dataset not found');
    await client.close();
    return;
  }

  console.log('Dataset:', dataset.name);
  console.log('Embellishments:', dataset.embellishments ? dataset.embellishments.length : 0);

  if (dataset.embellishments && dataset.embellishments.length > 0) {
    let changed = false;
    for (const e of dataset.embellishments) {
      console.log('  ', e._id, 'status:', e.status, 'type:', e.type);
      if (e.status === 'running' || e.status === 'pending') {
        console.log('    -> Cancelling');
        e.status = 'cancelled';
        changed = true;
      }
    }

    if (changed) {
      await db.collection('datasets').updateOne(
        { _id: new ObjectId(datasetId) },
        { $set: { embellishments: dataset.embellishments } }
      );
      console.log('Dataset updated');
    }
  }

  await client.close();
  console.log('Done!');
}

main().catch(console.error);
