/**
 * DB Connection Integration Test
 *
 * Verifies the MongoDB connection works and the database is reachable.
 * Simplest possible integration test — if this fails, nothing else will work.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb, DB_NAME } = require('../../helpers/setup');

describe('Database connection', () => {
  let client;
  let db;

  before(async () => {
    ({ client, db } = await getTestDb());
  });

  after(async () => {
    await closeTestDb();
  });

  test('connects to MongoDB successfully', () => {
    assert.ok(client, 'client should exist');
  });

  test('can ping the database', async () => {
    const result = await db.command({ ping: 1 });
    assert.equal(result.ok, 1, 'ping should return ok: 1');
  });

  test('uses the correct database name', () => {
    assert.equal(db.databaseName, DB_NAME);
  });

  test('can list collections without error', async () => {
    const collections = await db.listCollections().toArray();
    assert.ok(Array.isArray(collections), 'should return an array of collections');
  });
});
