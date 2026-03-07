/**
 * Webhook Processor cost calculation tests
 *
 * Tests:
 *   1. calculates costUsd for per-second tools using duration
 *   2. calculates costUsd for flat-rate tools (request/run/fixed) without needing duration
 *   3. returns null costUsd when costRate is missing
 *   4. flat-rate tools do NOT require jobStartDetails (Bug 3: survives restart)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { calculateCostUsd } = require('../../../src/core/services/comfydeploy/webhookProcessor');

describe('calculateCostUsd', () => {
  test('calculates costUsd for per-second tools using duration', () => {
    const startTime = '2026-03-07T10:00:00.000Z';
    const endTime = '2026-03-07T10:00:30.000Z'; // 30 seconds later
    const result = calculateCostUsd({
      costRate: { amount: 0.001, unit: 'second' },
      jobStartDetails: { startTime },
      finalEventTimestamp: endTime,
    });
    assert.equal(result.costUsd, 0.03); // 30 * 0.001
    assert.equal(result.runDurationSeconds, 30);
  });

  test('calculates costUsd for flat-rate unit=request without needing duration', () => {
    const result = calculateCostUsd({
      costRate: { amount: 0.05, unit: 'request' },
      jobStartDetails: null,
      finalEventTimestamp: '2026-03-07T10:00:30.000Z',
    });
    assert.equal(result.costUsd, 0.05, 'should use costRate.amount directly for request unit');
  });

  test('calculates costUsd for flat-rate unit=run', () => {
    const result = calculateCostUsd({
      costRate: { amount: 0.02, unit: 'run' },
      jobStartDetails: null,
      finalEventTimestamp: '2026-03-07T10:00:30.000Z',
    });
    assert.equal(result.costUsd, 0.02);
  });

  test('calculates costUsd for flat-rate unit=fixed', () => {
    const result = calculateCostUsd({
      costRate: { amount: 0.10, unit: 'fixed' },
      jobStartDetails: null,
      finalEventTimestamp: '2026-03-07T10:00:30.000Z',
    });
    assert.equal(result.costUsd, 0.10);
  });

  test('returns null costUsd when costRate is missing', () => {
    const result = calculateCostUsd({
      costRate: null,
      jobStartDetails: null,
      finalEventTimestamp: '2026-03-07T10:00:30.000Z',
    });
    assert.equal(result.costUsd, null);
  });

  test('returns null costUsd for per-second tool when jobStartDetails is missing', () => {
    const result = calculateCostUsd({
      costRate: { amount: 0.001, unit: 'second' },
      jobStartDetails: null,
      finalEventTimestamp: '2026-03-07T10:00:30.000Z',
    });
    assert.equal(result.costUsd, null, 'per-second tools need duration, should be null without startTime');
  });

  test('clamps negative duration to 0 for per-second tools', () => {
    const result = calculateCostUsd({
      costRate: { amount: 0.001, unit: 'second' },
      jobStartDetails: { startTime: '2026-03-07T10:00:30.000Z' },
      finalEventTimestamp: '2026-03-07T10:00:00.000Z', // end before start
    });
    assert.equal(result.costUsd, 0);
    assert.equal(result.runDurationSeconds, 0);
  });
});
