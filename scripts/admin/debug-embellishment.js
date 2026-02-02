const { MongoClient } = require("mongodb");

async function main() {
  const uri = process.env.MONGO_PASS;
  if (!uri) {
    console.log("MONGO_PASS not set");
    return;
  }
  console.log("Connecting to MongoDB...");
  const client = new MongoClient(uri);
  await client.connect();

  // List databases
  const adminDb = client.db().admin();
  const dbs = await adminDb.listDatabases();
  console.log("=== DATABASES ===");
  for (const dbInfo of dbs.databases) {
    console.log("  -", dbInfo.name);
  }

  const db = client.db("noema");

  // List collections
  console.log("\n=== COLLECTIONS ===");
  const collections = await db.listCollections().toArray();
  for (const coll of collections) {
    console.log("  -", coll.name);
  }

  // List recent datasets first
  console.log("=== RECENT DATASETS ===");
  const recentDatasets = await db.collection("datasets").find({}).sort({ createdAt: -1 }).limit(10).toArray();
  for (const ds of recentDatasets) {
    console.log("  -", ds._id?.toString(), ds.name);
  }

  // Find the dataset
  const dataset = await db.collection("datasets").findOne({ name: /fullyarmedgirl/i })
    || await db.collection("datasets").findOne({ name: /armed/i })
    || recentDatasets[0];
  console.log("\n=== SELECTED DATASET ===");
  console.log("ID:", dataset?._id?.toString());
  console.log("Name:", dataset?.name);
  console.log("Image count:", dataset?.images?.length);

  // Look at embellishments
  console.log("\n=== EMBELLISHMENTS ===");
  if (dataset?.embellishments?.length) {
    for (const emb of dataset.embellishments) {
      console.log("ID:", emb._id, "type:", emb.type, "method:", emb.method, "status:", emb.status);
      const nonNull = emb.results?.filter(r => r?.value).length || 0;
      console.log("  Results count:", emb.results?.length, "non-null values:", nonNull);
      if (emb.results?.[0]) {
        console.log("  First result:", JSON.stringify(emb.results[0]).slice(0, 300));
      }
    }
  } else {
    console.log("No embellishments");
  }

  // Look for embellishment tasks
  console.log("\n=== EMBELLISHMENT TASKS ===");
  const tasks = await db.collection("embellishmenttasks").find({
    datasetId: dataset?._id?.toString()
  }).toArray();

  for (const task of tasks) {
    console.log("Task ID:", task._id, "type:", task.type, "status:", task.status);
    console.log("  Total:", task.totalItems, "Completed:", task.completedItems, "Failed:", task.failedItems);
    console.log("  Spell:", task.spellSlug);
    if (task.items?.[0]) {
      console.log("  First item:", JSON.stringify(task.items[0]).slice(0, 200));
    }
  }

  // Check generation outputs for this spell
  console.log("\n=== GENERATION OUTPUTS (stylecaption) ===");
  let gens = await db.collection("generationOutputs").find({
    toolId: /stylecaption/i
  }).sort({ createdAt: -1 }).limit(3).toArray();

  // Also try toolDisplayName
  if (!gens.length) {
    console.log("Trying toolDisplayName...");
    gens = await db.collection("generationOutputs").find({
      toolDisplayName: /stylecaption/i
    }).sort({ createdAt: -1 }).limit(5).toArray();
  }

  // Try finding any recent generation outputs
  if (!gens.length) {
    console.log("Trying most recent generation outputs...");
    gens = await db.collection("generationOutputs").find({}).sort({ createdAt: -1 }).limit(5).toArray();
  }

  for (const gen of gens) {
    console.log("\n--- Generation Output ---");
    console.log("Gen ID:", gen._id, "status:", gen.status);
    console.log("All keys:", Object.keys(gen).join(", "));
    console.log("Full record (truncated):", JSON.stringify(gen, null, 2).slice(0, 2000));
  }

  // Check spells with embellishment config
  console.log("\n=== SPELLS WITH EMBELLISHMENT ===");
  const spells = await db.collection("spells").find({
    slug: /stylecaption/i
  }).toArray();

  for (const spell of spells) {
    console.log("Spell:", spell._id, "slug:", spell.slug, "name:", spell.name);
    console.log("  Has embellishment:", spell.embellishment ? "yes" : "no");
    if (spell.embellishment) {
      console.log("  Embellishment config:", JSON.stringify(spell.embellishment, null, 2));
    }
  }

  // Check embellishmentTasks collection more thoroughly
  console.log("\n=== ALL EMBELLISHMENT TASKS ===");
  const allTasks = await db.collection("embellishmentTasks").find({}).sort({ createdAt: -1 }).limit(5).toArray();
  for (const task of allTasks) {
    console.log("Task ID:", task._id, "type:", task.type, "status:", task.status, "dataset:", task.datasetId);
    console.log("  Spell:", task.spellSlug, "Total:", task.totalItems, "Completed:", task.completedItems, "Failed:", task.failedItems);
    if (task.items?.[0]) {
      console.log("  First item:", JSON.stringify(task.items[0]));
    }
  }

  for (const gen of gens) {
    console.log("Gen ID:", gen._id, "status:", gen.status, "toolId:", gen.toolId);
    console.log("  Has outputs:", gen.outputs ? "yes" : "no", "has text:", gen.text ? "yes" : "no");
    if (gen.outputs) {
      console.log("  outputs:", JSON.stringify(gen.outputs).slice(0, 500));
    }
    if (gen.text) {
      console.log("  text:", JSON.stringify(gen.text).slice(0, 300));
    }
  }

  await client.close();
}

main().catch(console.error);
