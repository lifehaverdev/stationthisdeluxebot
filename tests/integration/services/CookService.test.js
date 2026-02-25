/**
 * CookService unit tests
 *
 * Tests:
 *   updateCook() - mirrors PUT /internal/v1/data/cook/cooks/:cookId handler logic
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { CookService } = require('../../../src/core/services/store/cook/CookService');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_COOK_ID = '649d9bc2381f3f90f7777a01';
const FAKE_GEN_ID  = '649d9bc2381f3f90f7777b02';

function makeCooksDb() {
  const calls = [];
  return {
    updateOne: async (filter, update) => {
      calls.push({ filter, update });
    },
    _calls: calls,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CookService', () => {

  describe('updateCook()', () => {

    test('status-only update sets $set.status and updatedAt', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await service.updateCook(FAKE_COOK_ID, { status: 'completed' });

      assert.equal(cooksDb._calls.length, 1);
      const { update } = cooksDb._calls[0];
      assert.equal(update.$set.status, 'completed');
      assert.ok(update.$set.updatedAt instanceof Date);
      assert.equal(update.$push, undefined);
      assert.equal(update.$inc, undefined);
    });

    test('completed status sets completedAt', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await service.updateCook(FAKE_COOK_ID, { status: 'completed' });

      const { update } = cooksDb._calls[0];
      assert.ok(update.$set.completedAt instanceof Date);
    });

    test('non-completed status does not set completedAt', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await service.updateCook(FAKE_COOK_ID, { status: 'paused' });

      const { update } = cooksDb._calls[0];
      assert.equal(update.$set.completedAt, undefined);
    });

    test('generationId + costDeltaUsd pushes generation and increments count and cost', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await service.updateCook(FAKE_COOK_ID, {
        generationId: FAKE_GEN_ID,
        costDeltaUsd: 0.0042,
      });

      const { update } = cooksDb._calls[0];
      assert.ok(update.$push.generationIds instanceof ObjectId);
      assert.equal(update.$push.generationIds.toString(), FAKE_GEN_ID);
      assert.equal(update.$inc.costUsd, 0.0042);
      assert.equal(update.$inc.generatedCount, 1);
    });

    test('generationId without costDeltaUsd increments generatedCount only', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await service.updateCook(FAKE_COOK_ID, { generationId: FAKE_GEN_ID });

      const { update } = cooksDb._calls[0];
      assert.ok(update.$push.generationIds instanceof ObjectId);
      assert.equal(update.$inc?.costUsd, undefined);
      assert.equal(update.$inc.generatedCount, 1);
    });

    test('filter targets correct cook ObjectId', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await service.updateCook(FAKE_COOK_ID, { status: 'stopped' });

      const { filter } = cooksDb._calls[0];
      assert.ok(filter._id instanceof ObjectId);
      assert.equal(filter._id.toString(), FAKE_COOK_ID);
    });

    test('invalid cookId throws before calling DB', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await assert.rejects(
        () => service.updateCook('not-a-valid-id', { status: 'completed' }),
        /Invalid cookId/
      );
      assert.equal(cooksDb._calls.length, 0);
    });

    test('null cookId throws', async () => {
      const cooksDb = makeCooksDb();
      const service = new CookService({ cooksDb });

      await assert.rejects(
        () => service.updateCook(null, { status: 'completed' }),
        /Invalid cookId/
      );
    });

  });

});
