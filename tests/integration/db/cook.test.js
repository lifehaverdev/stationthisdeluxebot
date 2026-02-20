/**
 * Cook DB Lifecycle Integration Test
 *
 * Verifies CooksDB create/read/update lifecycle against the real database.
 * Tests run against the 'noema' database (same as production).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { getTestDb, closeTestDb } = require('../../helpers/setup');

// CooksDB extends BaseDB which hardcodes dbName to 'noema'
const CooksDB = require('../../../src/core/services/db/cooksDb');

describe('Cook job lifecycle', () => {
  let cooksDb;
  const createdIds = []; // track for cleanup

  before(async () => {
    // Ensure DB connection is warm
    await getTestDb();
    cooksDb = new CooksDB(console);
  });

  after(async () => {
    // Clean up all test records
    for (const id of createdIds) {
      try {
        await cooksDb.deleteOne({ _id: new ObjectId(id) });
      } catch {
        // already gone — fine
      }
    }
    await closeTestDb();
  });

  test('creates a cook job and returns it with an _id', async () => {
    const cook = await cooksDb.createCook({
      collectionId: 'test-collection-' + Date.now(),
      initiatorAccountId: new ObjectId().toHexString(),
      targetSupply: 5,
    });

    createdIds.push(cook._id);

    assert.ok(cook._id, 'should have an _id');
    assert.equal(cook.targetSupply, 5);
    assert.equal(cook.generatedCount, 0);
    assert.equal(cook.status, 'running');
    assert.ok(cook.startedAt instanceof Date);
    assert.ok(Array.isArray(cook.generationIds));
    assert.equal(cook.generationIds.length, 0);
  });

  test('retrieves a cook job by _id', async () => {
    const cook = await cooksDb.createCook({
      collectionId: 'test-retrieve-' + Date.now(),
      initiatorAccountId: new ObjectId().toHexString(),
      targetSupply: 3,
    });
    createdIds.push(cook._id);

    const found = await cooksDb.findOne({ _id: new ObjectId(cook._id) });
    assert.ok(found, 'should find the cook');
    assert.equal(found.targetSupply, 3);
    assert.equal(found.status, 'running');
  });

  test('addGeneration increments count and pushes id', async () => {
    const cook = await cooksDb.createCook({
      collectionId: 'test-addgen-' + Date.now(),
      initiatorAccountId: new ObjectId().toHexString(),
      targetSupply: 10,
    });
    createdIds.push(cook._id);

    const genId = new ObjectId();
    await cooksDb.addGeneration(cook._id.toHexString(), genId.toHexString());

    const updated = await cooksDb.findOne({ _id: new ObjectId(cook._id) });
    assert.equal(updated.generatedCount, 1);
    assert.equal(updated.generationIds.length, 1);
    assert.equal(updated.generationIds[0].toHexString(), genId.toHexString());
  });

  test('updates cook status', async () => {
    const cook = await cooksDb.createCook({
      collectionId: 'test-status-' + Date.now(),
      initiatorAccountId: new ObjectId().toHexString(),
      targetSupply: 2,
    });
    createdIds.push(cook._id);

    await cooksDb.updateOne(
      { _id: new ObjectId(cook._id) },
      { $set: { status: 'completed', updatedAt: new Date() } }
    );

    const updated = await cooksDb.findOne({ _id: new ObjectId(cook._id) });
    assert.equal(updated.status, 'completed');
  });

  test('rejects invalid initiatorAccountId', async () => {
    await assert.rejects(
      () => cooksDb.createCook({
        collectionId: 'test-invalid',
        initiatorAccountId: 'not-a-valid-objectid',
        targetSupply: 1,
      }),
      { message: /Invalid initiatorAccountId/ }
    );
  });
});
