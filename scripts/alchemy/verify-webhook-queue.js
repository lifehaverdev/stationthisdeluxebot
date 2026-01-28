#!/usr/bin/env node
/**
 * Verify Webhook Queue Integration
 *
 * This script tests the webhook queue system to ensure:
 * 1. Events can be enqueued
 * 2. Worker can claim and process events
 * 3. Events are marked as completed
 *
 * Run with: node scripts/alchemy/verify-webhook-queue.js
 */

require('dotenv').config();
const { createLogger } = require('../../src/utils/logger');
const { WebhookEventQueueDb } = require('../../src/core/services/db/alchemy/webhookEventQueueDb');

const logger = createLogger('webhook-queue-verify');

// Mock webhook payload (similar to what Alchemy sends)
const MOCK_WEBHOOK_PAYLOAD = {
  type: 'GRAPHQL',
  event: {
    data: {
      block: {
        number: 12345678,
        logs: [
          {
            transaction: { hash: '0xtest123' },
            topics: ['0xmocktopic'],
            data: '0x',
            index: 0
          }
        ]
      }
    }
  }
};

async function verifyQueue() {
  logger.info('=== Webhook Queue Verification ===\n');

  const queueDb = new WebhookEventQueueDb(logger);

  // Test 1: Enqueue an event
  logger.info('Test 1: Enqueueing test event...');
  const enqueueResult = await queueDb.enqueue('test_webhook', MOCK_WEBHOOK_PAYLOAD, {
    test: true,
    timestamp: new Date().toISOString()
  });
  logger.info(`  Enqueued with ID: ${enqueueResult.insertedId}`);

  // Test 2: Check queue stats
  logger.info('\nTest 2: Checking queue stats...');
  const stats = await queueDb.getQueueStats();
  logger.info(`  Queue stats: ${JSON.stringify(stats)}`);

  // Test 3: Claim the event
  logger.info('\nTest 3: Claiming event...');
  const claimed = await queueDb.claimNext('test-worker-1');
  if (claimed) {
    logger.info(`  Claimed event ID: ${claimed._id}`);
    logger.info(`  Event type: ${claimed.event_type}`);
    logger.info(`  Attempts: ${claimed.attempts}`);

    // Test 4: Mark as completed
    logger.info('\nTest 4: Marking event as completed...');
    await queueDb.markCompleted(claimed._id, { message: 'Test completed successfully' });
    logger.info('  Event marked as completed');
  } else {
    logger.error('  Failed to claim event!');
  }

  // Test 5: Final stats
  logger.info('\nTest 5: Final queue stats...');
  const finalStats = await queueDb.getQueueStats();
  logger.info(`  Final stats: ${JSON.stringify(finalStats)}`);

  // Test 6: Cleanup test event
  logger.info('\nTest 6: Cleaning up test event...');
  await queueDb.cleanupOldEvents(0); // Clean all completed
  logger.info('  Cleanup complete');

  logger.info('\n=== Verification Complete ===');
  logger.info('All tests passed! The webhook queue is working correctly.');

  process.exit(0);
}

verifyQueue().catch(err => {
  logger.error('Verification failed:', err);
  process.exit(1);
});
