#!/usr/bin/env node

/**
 * Quick helper to inspect recent collection export jobs.
 * Usage: node scripts/inspect-collection-export.js <collectionId> [userId]
 */

const { getCachedClient } = require('../src/core/services/db/utils/queue');

async function main() {
  const [collectionId, userId] = process.argv.slice(2);
  if (!collectionId) {
    console.error('Usage: node scripts/inspect-collection-export.js <collectionId> [userId]');
    process.exit(1);
  }

  try {
    const client = await getCachedClient();
    const dbName = process.env.MONGO_DB_NAME || 'station';
    const collection = client.db(dbName).collection('collectionExports');
    const query = { collectionId };
    if (userId) query.userId = userId;

    const jobs = await collection.find(query).sort({ createdAt: -1 }).limit(5).toArray();
    if (!jobs.length) {
      console.log('No export jobs found for', query);
      process.exit(0);
    }

    jobs.forEach((job, idx) => {
      const progress = job.progress || {};
      console.log(`Job ${idx + 1}:`);
      console.log(`  _id: ${job._id}`);
      console.log(`  status: ${job.status}`);
      console.log(`  stage: ${progress.stage || 'n/a'}`);
      console.log(`  progress: ${progress.current || 0}/${progress.total || 0}`);
      console.log(`  createdAt: ${job.createdAt}`);
      console.log(`  updatedAt: ${job.updatedAt}`);
      if (job.error) {
        console.log(`  error: ${job.error}`);
      }
      if (job.downloadUrl) {
        console.log(`  downloadUrl: ${job.downloadUrl}`);
      }
      console.log('---');
    });
  } catch (err) {
    console.error('Failed to inspect export jobs:', err);
    process.exit(1);
  }
}

main();
