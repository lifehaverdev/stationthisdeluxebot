#!/usr/bin/env node
/**
 * test-client.js - Test RunPod client connectivity
 *
 * Usage:
 *   node scripts/runpod/test-client.js --endpoint <ENDPOINT_ID>
 *   node scripts/runpod/test-client.js --endpoint <ENDPOINT_ID> --run-test
 *
 * Environment:
 *   RUNPOD_API_KEY - Your RunPod API key
 */
require('dotenv').config();

const { RunPodClient } = require('../../src/core/services/runpod');

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => {
    if (process.env.DEBUG) console.log('[DEBUG]', ...args);
  }
};

async function testClient(endpointId, runTest = false) {
  console.log('\n' + '='.repeat(60));
  console.log('RunPod Client Test');
  console.log('='.repeat(60));

  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    console.error('Error: RUNPOD_API_KEY environment variable not set');
    process.exit(1);
  }

  console.log(`\nAPI Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log(`Endpoint ID: ${endpointId}`);

  const client = new RunPodClient({
    apiKey,
    logger
  });

  // Test 1: Health check
  console.log('\n--- Health Check ---');
  try {
    const health = await client.getHealth(endpointId);
    console.log('Health response:', JSON.stringify(health, null, 2));

    if (health.workers) {
      console.log(`\nWorker status:`);
      console.log(`  Idle:      ${health.workers.idle || 0}`);
      console.log(`  Running:   ${health.workers.running || 0}`);
      console.log(`  Throttled: ${health.workers.throttled || 0}`);
    }
  } catch (error) {
    console.error('Health check failed:', error.message);
    if (error.status === 401) {
      console.error('Authentication failed - check your API key');
      process.exit(1);
    }
    if (error.status === 404) {
      console.error('Endpoint not found - check your endpoint ID');
      process.exit(1);
    }
  }

  // Test 2: Optional test job
  if (runTest) {
    console.log('\n--- Test Job ---');
    console.log('Submitting test job...');

    try {
      // Submit async job with minimal input
      const runResult = await client.run(endpointId, {
        test: true,
        prompt: 'RunPod client test'
      });

      console.log('Job submitted:', JSON.stringify(runResult, null, 2));
      const jobId = runResult.id;

      // Poll for completion
      console.log(`\nPolling for job ${jobId}...`);
      const result = await client.waitForCompletion(endpointId, jobId, {
        intervalMs: 2000,
        maxAttempts: 60,
        onStatus: (status) => {
          process.stdout.write(`  Status: ${status.status}\r`);
        }
      });

      console.log('\nJob completed!');
      console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Test job failed:', error.message);
      if (error.code) {
        console.error('Error code:', error.code);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60) + '\n');
}

// CLI
const args = process.argv.slice(2);
const endpointIdx = args.indexOf('--endpoint');
const endpointId = endpointIdx >= 0 ? args[endpointIdx + 1] : process.env.RUNPOD_COMFYUI_ENDPOINT_ID;
const runTest = args.includes('--run-test');

if (!endpointId) {
  console.error('Usage: node scripts/runpod/test-client.js --endpoint <ENDPOINT_ID> [--run-test]');
  console.error('\nOr set RUNPOD_COMFYUI_ENDPOINT_ID environment variable');
  process.exit(1);
}

testClient(endpointId, runTest).catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
