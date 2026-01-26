#!/usr/bin/env node
/**
 * Touch a training job's updatedAt to prevent sweeper cleanup.
 * Usage: ./run-with-env.sh node scripts/vastai/touch-training-job.js <jobId>
 */
const { MongoClient, ObjectId } = require('mongodb');

const jobId = process.argv[2] || '697574feb67de72635bab861';
const uri = process.env.MONGO_PASS;

if (!uri) {
  console.error('No MONGO_PASS found in env');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('noema');

  const job = await db.collection('trainingJobs').findOne({
    _id: new ObjectId(jobId)
  });

  if (!job) {
    console.log('Job not found:', jobId);
    await client.close();
    process.exit(1);
  }

  console.log('Job:       ', job.modelName);
  console.log('Status:    ', job.status);
  console.log('updatedAt: ', job.updatedAt);
  console.log('Instance:  ', job.vastaiInstanceId);
  console.log('Progress:  ', job.progress || 'none');
  console.log('Step:      ', job.currentStep || 'none');

  // Accept optional progress values from CLI args
  const step = process.argv[3] ? parseInt(process.argv[3], 10) : null;
  const total = process.argv[4] ? parseInt(process.argv[4], 10) : null;

  const update = { updatedAt: new Date() };
  if (step) update.currentStep = step;
  if (total) update.totalSteps = total;
  if (step && total) update.progress = Math.round((step / total) * 100);

  const result = await db.collection('trainingJobs').updateOne(
    { _id: new ObjectId(jobId) },
    { $set: update }
  );

  if (step) console.log(`\nUpdated progress: ${step}/${total} (${update.progress}%)`);
  console.log('Touched updatedAt:', result.modifiedCount ? 'OK' : 'FAILED');
  await client.close();
  process.exit(0);
})().catch(err => {
  console.error('DB error:', err.message);
  process.exit(1);
});
