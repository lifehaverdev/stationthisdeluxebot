/**
 * GenerationService unit tests
 *
 * Tests:
 *   1. update() coerces costUsd to Decimal128
 *   2. update() emits 'generationUpdated' when status→completed and deliveryStatus==='pending'
 *   3. update() does NOT emit when deliveryStatus!=='pending'
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Decimal128 } = require('mongodb');

const { GenerationService } = require('../../../src/core/services/store/generations/GenerationService');
const notificationEvents = require('../../../src/core/events/notificationEvents');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_ID = '649d9bc2381f3f90f7777e99';

function makeDb(record) {
  return {
    updateGenerationOutput: async () => ({ matchedCount: 1 }),
    findGenerationById: async () => record,
    findGenerations: async () => (record ? [record] : []),
  };
}

function waitForEvent(emitter, event, timeoutMs = 50) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Event '${event}' not emitted within ${timeoutMs}ms`)), timeoutMs);
    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GenerationService', () => {
  describe('update() - Decimal128 coercion', () => {
    test('coerces numeric costUsd to Decimal128', async () => {
      let capturedPayload;
      const db = {
        updateGenerationOutput: async (_id, payload) => { capturedPayload = payload; return { matchedCount: 1 }; },
        findGenerationById: async () => ({
          _id: FAKE_ID,
          status: 'processing',
          deliveryStatus: 'none',
          notificationPlatform: 'none',
        }),
      };

      const service = new GenerationService(db);
      await service.update(FAKE_ID, { costUsd: 0.0042 });

      assert.ok(capturedPayload.costUsd instanceof Decimal128, 'costUsd should be Decimal128');
      assert.equal(capturedPayload.costUsd.toString(), '0.0042');
    });

    test('coerces null costUsd to Decimal128 zero', async () => {
      let capturedPayload;
      const db = {
        updateGenerationOutput: async (_id, payload) => { capturedPayload = payload; return { matchedCount: 1 }; },
        findGenerationById: async () => ({
          _id: FAKE_ID,
          status: 'processing',
          deliveryStatus: 'none',
          notificationPlatform: 'none',
        }),
      };

      const service = new GenerationService(db);
      await service.update(FAKE_ID, { costUsd: null });

      assert.ok(capturedPayload.costUsd instanceof Decimal128, 'null costUsd should be Decimal128');
      assert.equal(capturedPayload.costUsd.toString(), '0');
    });

    test('leaves costUsd untouched when not in payload', async () => {
      let capturedPayload;
      const db = {
        updateGenerationOutput: async (_id, payload) => { capturedPayload = payload; return { matchedCount: 1 }; },
        findGenerationById: async () => ({
          _id: FAKE_ID,
          status: 'completed',
          deliveryStatus: 'none',
          notificationPlatform: 'none',
        }),
      };

      const service = new GenerationService(db);
      await service.update(FAKE_ID, { status: 'completed' });

      assert.equal(capturedPayload.costUsd, undefined, 'costUsd should not be added when not provided');
    });
  });

  describe('update() - event emission', () => {
    test('emits generationUpdated when status→completed and deliveryStatus===pending', async () => {
      const record = {
        _id: FAKE_ID,
        status: 'completed',
        deliveryStatus: 'pending',
        notificationPlatform: 'telegram',
        metadata: {},
      };
      const service = new GenerationService(makeDb(record));

      const emittedPromise = waitForEvent(notificationEvents, 'generationUpdated');
      await service.update(FAKE_ID, { status: 'completed' });

      const emitted = await emittedPromise;
      assert.equal(emitted.status, 'completed');
      assert.equal(emitted._id, FAKE_ID);
    });

    test('emits generationUpdated when status→failed and deliveryStatus===pending', async () => {
      const record = {
        _id: FAKE_ID,
        status: 'failed',
        deliveryStatus: 'pending',
        notificationPlatform: 'telegram',
        metadata: {},
      };
      const service = new GenerationService(makeDb(record));

      const emittedPromise = waitForEvent(notificationEvents, 'generationUpdated');
      await service.update(FAKE_ID, { status: 'failed' });

      const emitted = await emittedPromise;
      assert.equal(emitted.status, 'failed');
    });

    test('does NOT emit when deliveryStatus!==pending', async () => {
      const record = {
        _id: FAKE_ID,
        status: 'completed',
        deliveryStatus: 'delivered',
        notificationPlatform: 'telegram',
        metadata: {},
      };
      const service = new GenerationService(makeDb(record));

      let emitted = false;
      const listener = () => { emitted = true; };
      notificationEvents.once('generationUpdated', listener);

      await service.update(FAKE_ID, { status: 'completed' });

      // Give event loop a tick to fire any synchronous events
      await new Promise(resolve => setImmediate(resolve));

      notificationEvents.removeListener('generationUpdated', listener);
      assert.equal(emitted, false, 'generationUpdated should NOT emit when deliveryStatus is not pending');
    });

    test('does NOT emit when notificationPlatform===none', async () => {
      const record = {
        _id: FAKE_ID,
        status: 'completed',
        deliveryStatus: 'pending',
        notificationPlatform: 'none',
        metadata: {},
      };
      const service = new GenerationService(makeDb(record));

      let emitted = false;
      const listener = () => { emitted = true; };
      notificationEvents.once('generationUpdated', listener);

      await service.update(FAKE_ID, { status: 'completed' });
      await new Promise(resolve => setImmediate(resolve));

      notificationEvents.removeListener('generationUpdated', listener);
      assert.equal(emitted, false, 'generationUpdated should NOT emit when notificationPlatform is none');
    });

    test('does NOT emit when status update is non-terminal', async () => {
      const record = {
        _id: FAKE_ID,
        status: 'processing',
        deliveryStatus: 'pending',
        notificationPlatform: 'telegram',
        metadata: {},
      };
      const service = new GenerationService(makeDb(record));

      let emitted = false;
      const listener = () => { emitted = true; };
      notificationEvents.once('generationUpdated', listener);

      await service.update(FAKE_ID, { status: 'processing' });
      await new Promise(resolve => setImmediate(resolve));

      notificationEvents.removeListener('generationUpdated', listener);
      assert.equal(emitted, false, 'generationUpdated should NOT emit for non-terminal status update');
    });

    test('sets deliveryStrategy=spell_step for spell records', async () => {
      const record = {
        _id: FAKE_ID,
        status: 'completed',
        deliveryStatus: 'pending',
        notificationPlatform: 'telegram',
        metadata: { isSpell: true },
      };
      const service = new GenerationService(makeDb(record));

      const emittedPromise = waitForEvent(notificationEvents, 'generationUpdated');
      await service.update(FAKE_ID, { status: 'completed' });

      const emitted = await emittedPromise;
      assert.equal(emitted.deliveryStrategy, 'spell_step', 'spell records should have deliveryStrategy=spell_step');
    });
  });

  describe('update() - null on missing record', () => {
    test('returns null when findGenerationById returns null', async () => {
      const db = {
        updateGenerationOutput: async () => ({ matchedCount: 0 }),
        findGenerationById: async () => null,
      };
      const service = new GenerationService(db);
      const result = await service.update(FAKE_ID, { status: 'completed' });
      assert.equal(result, null);
    });
  });
});
