/**
 * Training DB Lifecycle Integration Test
 *
 * Verifies TrainingDB queue/claim/status/complete/fail lifecycle against real database.
 * Tests run against the 'noema' database (same as production).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { getTestDb, closeTestDb } = require('../../helpers/setup');

const TrainingDB = require('../../../src/core/services/db/trainingDb');

describe('Training job lifecycle', () => {
  let trainingDb;
  const createdIds = [];

  /** Minimal valid training job payload */
  function makeJob(overrides = {}) {
    return {
      datasetId: new ObjectId(),
      ownerAccountId: new ObjectId(),
      walletAddress: '0xTEST' + Date.now(),
      offeringId: 'flux-standard',
      baseModel: 'FLUX',
      modelName: 'test-lora-' + Date.now(),
      triggerWord: 'testword',
      steps: 1000,
      datasetImageCount: 20,
      ...overrides,
    };
  }

  before(async () => {
    await getTestDb();
    trainingDb = new TrainingDB(console);
  });

  after(async () => {
    for (const id of createdIds) {
      try {
        await trainingDb.deleteOne({ _id: new ObjectId(id) });
      } catch { /* already gone */ }
    }
    await closeTestDb();
  });

  test('queueJob creates a QUEUED training job', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    assert.ok(job._id, 'should have an _id');
    assert.equal(job.status, 'QUEUED');
    assert.equal(job.progress, 0);
    assert.equal(job.baseModel, 'FLUX');
    assert.ok(job.createdAt instanceof Date);
  });

  test('findTrainingById retrieves the job', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    const found = await trainingDb.findTrainingById(job._id.toHexString());
    assert.ok(found);
    assert.equal(found.modelName, job.modelName);
    assert.equal(found.status, 'QUEUED');
  });

  test('claimJob atomically transitions QUEUED → PROVISIONING', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    const claimed = await trainingDb.claimJob(job._id);
    assert.ok(claimed, 'should return the claimed job');
    assert.equal(claimed.status, 'PROVISIONING');
    assert.ok(claimed.startedAt instanceof Date);

    // Second claim should fail (already PROVISIONING)
    const secondClaim = await trainingDb.claimJob(job._id);
    assert.equal(secondClaim, null, 'double-claim should return null');
  });

  test('setStatus updates the status field', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    await trainingDb.setStatus(job._id, 'TRAINING');
    const found = await trainingDb.findTrainingById(job._id.toHexString());
    assert.equal(found.status, 'TRAINING');
  });

  test('updateProgress sets step and loss data', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    await trainingDb.updateProgress(job._id, {
      currentStep: 500,
      totalSteps: 1000,
      loss: 0.045,
      progress: 50,
    });

    const found = await trainingDb.findTrainingById(job._id.toHexString());
    assert.equal(found.currentStep, 500);
    assert.equal(found.totalSteps, 1000);
    assert.equal(found.currentLoss, 0.045);
    assert.equal(found.progress, 50);
  });

  test('markCompleted sets COMPLETED status with completion data', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    const loraId = new ObjectId();
    await trainingDb.markCompleted(job._id, {
      loraModelId: loraId.toHexString(),
      modelRepoUrl: 'https://huggingface.co/test/model',
      triggerWords: ['testword'],
      actualCostPoints: 500,
    });

    const found = await trainingDb.findTrainingById(job._id.toHexString());
    assert.equal(found.status, 'COMPLETED');
    assert.ok(found.completedAt instanceof Date);
    assert.equal(found.modelRepoUrl, 'https://huggingface.co/test/model');
    assert.equal(found.actualCostPoints, 500);
    assert.equal(found.costReconciled, true);
  });

  test('markFailed sets FAILED status with reason', async () => {
    const job = await trainingDb.queueJob(makeJob());
    createdIds.push(job._id);

    await trainingDb.markFailed(job._id, 'GPU out of memory');

    const found = await trainingDb.findTrainingById(job._id.toHexString());
    assert.equal(found.status, 'FAILED');
    assert.equal(found.failureReason, 'GPU out of memory');
    assert.ok(found.completedAt instanceof Date);
  });

  test('deleteTraining removes the record', async () => {
    const job = await trainingDb.queueJob(makeJob());
    // Don't push to createdIds — we're deleting it here

    const deleted = await trainingDb.deleteTraining(job._id.toHexString());
    assert.equal(deleted, true);

    const found = await trainingDb.findTrainingById(job._id.toHexString());
    assert.equal(found, null);
  });
});
