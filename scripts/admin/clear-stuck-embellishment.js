const { MongoClient, ObjectId } = require("mongodb");

async function main() {
  const datasetId = process.argv[2];
  if (!datasetId) {
    console.log("Usage: node scripts/admin/clear-stuck-embellishment.js <datasetId>");
    console.log("Example: node scripts/admin/clear-stuck-embellishment.js 69807e1564a2433d36d7f2f3");
    return;
  }

  const uri = process.env.MONGO_PASS;
  if (!uri) {
    console.log("MONGO_PASS not set");
    return;
  }

  console.log("Connecting to MongoDB...");
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db("noema");
  const tasksCollection = db.collection("embellishmentTasks");

  // Find running tasks for this dataset
  const runningTasks = await tasksCollection.find({
    datasetId: datasetId,
    status: "running"
  }).toArray();

  console.log(`Found ${runningTasks.length} running task(s) for dataset ${datasetId}`);

  for (const task of runningTasks) {
    console.log(`  - Task ${task._id}: type=${task.type}, status=${task.status}`);
    
    // Update to cancelled
    await tasksCollection.updateOne(
      { _id: task._id },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    );
    console.log(`    -> Marked as cancelled`);
  }

  // Also update any embellishments on the dataset that are "running"
  const datasetsCollection = db.collection("datasets");
  const dataset = await datasetsCollection.findOne({ _id: new ObjectId(datasetId) });
  
  if (dataset?.embellishments) {
    let modified = false;
    for (const emb of dataset.embellishments) {
      if (emb.status === "running") {
        console.log(`  - Embellishment ${emb._id}: type=${emb.type}, status=${emb.status}`);
        emb.status = "cancelled";
        modified = true;
      }
    }
    if (modified) {
      await datasetsCollection.updateOne(
        { _id: new ObjectId(datasetId) },
        { $set: { embellishments: dataset.embellishments } }
      );
      console.log("    -> Updated dataset embellishments");
    }
  }

  console.log("Done!");
  await client.close();
}

main().catch(console.error);
