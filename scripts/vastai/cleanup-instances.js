#!/usr/bin/env node
/**
 * Cleanup VastAI Instances
 *
 * Runs a single sweep to find and terminate orphaned instances.
 * Can be run manually or via cron as a safety net.
 *
 * Usage:
 *   node scripts/vastai/cleanup-instances.js          # Dry run (list only)
 *   node scripts/vastai/cleanup-instances.js --force  # Actually terminate
 *   node scripts/vastai/cleanup-instances.js --all    # Terminate ALL instances (nuclear option)
 */

require('dotenv').config();

const VastAIClient = require('../../src/core/services/vastai/VastAIClient');
const TrainingDB = require('../../src/core/services/db/trainingDb');
const InstanceSweeper = require('../../src/core/services/vastai/InstanceSweeper');
const { MongoClient } = require('mongodb');

const VASTAI_API_KEY = process.env.VASTAI_API_KEY;
const MONGO_URI = process.env.MONGODB_URI || `mongodb+srv://admin:${encodeURIComponent(process.env.MONGO_PASS)}@cluster0.jxzqz.mongodb.net/stationthis`;

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const terminateAll = args.includes('--all');
  const dryRun = !force && !terminateAll;

  console.log('='.repeat(60));
  console.log('VastAI Instance Cleanup');
  console.log('='.repeat(60));
  console.log(`Mode: ${terminateAll ? 'TERMINATE ALL (NUCLEAR)' : force ? 'FORCE (will terminate)' : 'DRY RUN (list only)'}`);
  console.log('');

  if (!VASTAI_API_KEY) {
    console.error('ERROR: VASTAI_API_KEY not set');
    process.exit(1);
  }

  // Initialize VastAI client
  const vastAIClient = new VastAIClient({
    apiKey: VASTAI_API_KEY,
    apiBaseUrl: 'https://console.vast.ai/api/v0',
    logger: console,
  });

  // Step 1: List all instances
  console.log('Fetching VastAI instances...');
  const instancesResponse = await vastAIClient.listInstances();
  const instances = instancesResponse?.instances || [];

  if (instances.length === 0) {
    console.log('No instances found. All clean!');
    return;
  }

  console.log(`Found ${instances.length} instance(s):\n`);

  for (const instance of instances) {
    const startTime = instance.start_date ? new Date(instance.start_date * 1000) : null;
    const runtimeMs = startTime ? Date.now() - startTime.getTime() : 0;
    const runtimeHours = (runtimeMs / 3600000).toFixed(2);
    const hourlyRate = instance.dph_total || instance.dph_base || 0;
    const costSoFar = (hourlyRate * runtimeMs / 3600000).toFixed(4);

    console.log(`  Instance ${instance.id}:`);
    console.log(`    Status: ${instance.actual_status}`);
    console.log(`    GPU: ${instance.gpu_name} x${instance.num_gpus}`);
    console.log(`    SSH: ${instance.ssh_host}:${instance.ssh_port}`);
    console.log(`    Runtime: ${runtimeHours}h`);
    console.log(`    Rate: $${hourlyRate.toFixed(4)}/hr`);
    console.log(`    Cost so far: $${costSoFar}`);
    console.log('');
  }

  // TERMINATE ALL mode - nuclear option
  if (terminateAll) {
    console.log('⚠️  TERMINATING ALL INSTANCES...\n');

    for (const instance of instances) {
      try {
        console.log(`  Terminating instance ${instance.id}...`);
        await vastAIClient.deleteInstance(instance.id);
        console.log(`  ✓ Instance ${instance.id} terminated`);
      } catch (err) {
        console.error(`  ✗ Failed to terminate ${instance.id}: ${err.message}`);
      }
    }

    console.log('\nDone.');
    return;
  }

  // Connect to MongoDB for sweeper
  console.log('Connecting to MongoDB...');
  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const db = mongoClient.db('stationthis');

  const trainingDb = new TrainingDB(console);
  trainingDb.db = db;
  trainingDb.collection = db.collection('loraTrainings');

  // Create sweeper
  const sweeper = new InstanceSweeper({
    vastAIClient,
    trainingDb,
    logger: console,
    maxRuntimeMs: 4 * 60 * 60 * 1000, // 4 hours
    stuckThresholdMs: 2 * 60 * 60 * 1000, // 2 hours
  });

  // Check training database for correlations
  console.log('Checking training database...\n');

  for (const instance of instances) {
    const instanceId = String(instance.id);
    const trainings = await trainingDb.findMany({ vastaiInstanceId: instanceId }, { limit: 1 });
    const training = trainings[0];

    if (training) {
      console.log(`  Instance ${instanceId} -> Training ${training._id}`);
      console.log(`    Model: ${training.modelName}`);
      console.log(`    Status: ${training.status}`);
      console.log(`    Last Update: ${training.updatedAt}`);
      console.log(`    Instance Terminated: ${training.instanceTerminatedAt || 'NO'}`);
    } else {
      console.log(`  Instance ${instanceId} -> NO TRAINING RECORD (orphan)`);
    }
    console.log('');
  }

  if (dryRun) {
    console.log('DRY RUN - No changes made.');
    console.log('Run with --force to terminate orphaned instances.');
    console.log('Run with --all to terminate ALL instances (nuclear option).');
  } else {
    console.log('Running sweeper...\n');
    const results = await sweeper.sweep();
    console.log('\nSweep Results:');
    console.log(`  Instances Checked: ${results.instancesChecked}`);
    console.log(`  Terminated: ${results.terminated.length}`);
    if (results.terminated.length > 0) {
      for (const t of results.terminated) {
        console.log(`    - ${t.instanceId}: ${t.reason}`);
      }
    }
    if (results.errors.length > 0) {
      console.log(`  Errors: ${results.errors.length}`);
      for (const e of results.errors) {
        console.log(`    - ${e.instanceId || 'general'}: ${e.error}`);
      }
    }
  }

  await mongoClient.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
