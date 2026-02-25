/**
 * SpellService unit tests
 *
 * Tests:
 *   1. getCast() - returns cast or null
 *   2. createCast() - delegates to castsDb.createCast
 *   3. updateCast() - generationId dedup ($addToSet), costUsd accumulation ($inc), status + timestamps
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { SpellService } = require('../../../src/core/services/store/spells/SpellService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_CAST_ID = '649d9bc2381f3f90f7777e10';
const FAKE_GEN_ID  = '649d9bc2381f3f90f7777e20';

function makeCastsDb() {
  const updates = [];
  const creates = [];
  let storedCast = null;

  return {
    findOne: async (query) => storedCast,
    setStoredCast: (c) => { storedCast = c; },
    createCast: async (params) => {
      creates.push(params);
      return { _id: new ObjectId(FAKE_CAST_ID), ...params };
    },
    updateOne: async (query, update) => {
      updates.push({ query, update });
    },
    _updates: updates,
    _creates: creates,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SpellService', () => {

  describe('getCast()', () => {
    test('returns the cast document when found', async () => {
      const castsDb = makeCastsDb();
      const fakeCast = { _id: new ObjectId(FAKE_CAST_ID), status: 'running' };
      castsDb.setStoredCast(fakeCast);

      const service = new SpellService({ castsDb });
      const result = await service.getCast(FAKE_CAST_ID);
      assert.deepEqual(result, fakeCast);
    });

    test('returns null when cast not found', async () => {
      const castsDb = makeCastsDb();
      castsDb.setStoredCast(null);

      const service = new SpellService({ castsDb });
      const result = await service.getCast(FAKE_CAST_ID);
      assert.equal(result, null);
    });
  });

  describe('createCast()', () => {
    test('delegates to castsDb.createCast with correct params', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      const result = await service.createCast({
        spellId: 'spellABC',
        initiatorAccountId: '649d9bc2381f3f90f7777e99',
        metadata: { webhookUrl: 'https://example.com' },
      });

      assert.equal(castsDb._creates.length, 1);
      assert.equal(castsDb._creates[0].spellId, 'spellABC');
      assert.equal(castsDb._creates[0].initiatorAccountId, '649d9bc2381f3f90f7777e99');
      assert.deepEqual(castsDb._creates[0].metadata, { webhookUrl: 'https://example.com' });
      assert.ok(result._id, 'should return doc with _id');
    });

    test('throws if spellId is missing', async () => {
      const service = new SpellService({ castsDb: makeCastsDb() });
      await assert.rejects(() => service.createCast({ initiatorAccountId: 'abc' }));
    });

    test('throws if initiatorAccountId is missing', async () => {
      const service = new SpellService({ castsDb: makeCastsDb() });
      await assert.rejects(() => service.createCast({ spellId: 'abc' }));
    });
  });

  describe('updateCast()', () => {
    test('adds generationId via $addToSet', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { generationId: FAKE_GEN_ID });

      const u = castsDb._updates[0].update;
      assert.ok(u.$addToSet, '$addToSet should be set');
      assert.ok(u.$addToSet.stepGenerationIds instanceof ObjectId, 'stepGenerationIds should be ObjectId');
      assert.equal(u.$addToSet.stepGenerationIds.toString(), FAKE_GEN_ID);
    });

    test('accumulates costUsd via $inc', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { costDeltaUsd: 0.005 });

      const u = castsDb._updates[0].update;
      assert.ok(u.$inc, '$inc should be set');
      assert.equal(u.$inc.costUsd, 0.005);
    });

    test('skips $inc when costDeltaUsd is 0', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { costDeltaUsd: 0 });

      const u = castsDb._updates[0].update;
      assert.equal(u.$inc, undefined, '$inc should not be set for zero cost');
    });

    test('sets status on $set', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { status: 'failed', failureReason: 'oops', failedAt: new Date('2025-01-01') });

      const u = castsDb._updates[0].update;
      assert.equal(u.$set.status, 'failed');
      assert.equal(u.$set.failureReason, 'oops');
      assert.ok(u.$set.failedAt instanceof Date);
    });

    test('adds completedAt when status is completed', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { status: 'completed' });

      const u = castsDb._updates[0].update;
      assert.equal(u.$set.status, 'completed');
      assert.ok(u.$set.completedAt instanceof Date, 'completedAt should be set');
    });

    test('does NOT add completedAt for non-completed status', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { status: 'failed' });

      const u = castsDb._updates[0].update;
      assert.equal(u.$set.completedAt, undefined);
    });

    test('always sets updatedAt', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, {});

      const u = castsDb._updates[0].update;
      assert.ok(u.$set.updatedAt instanceof Date);
    });

    test('accepts string costDeltaUsd', async () => {
      const castsDb = makeCastsDb();
      const service = new SpellService({ castsDb });

      await service.updateCast(FAKE_CAST_ID, { costDeltaUsd: '0.012' });

      const u = castsDb._updates[0].update;
      assert.ok(Math.abs(u.$inc.costUsd - 0.012) < 0.0001);
    });
  });
});
