/**
 * Unit tests for authApi — GET /auth/account-exists
 * Uses Node built-in test runner + supertest.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

before(() => {
  process.env.JWT_SECRET = 'test-secret-for-unit-tests';
});

const { createAuthApi } = require('./authApi');

function makeApp(internalApiClient) {
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthApi({ internalApiClient }));
  return app;
}

describe('GET /auth/account-exists', () => {
  test('returns { exists: true } for known address', async () => {
    const mockClient = {
      get: () => Promise.resolve({ data: { masterAccountId: '0xaabbcc' } }),
    };
    const app = makeApp(mockClient);
    const res = await supertest(app).get('/auth/account-exists?address=0xaabbccddeeff0011223344556677889900aabbcc');
    assert.equal(res.status, 200);
    assert.equal(res.body.exists, true);
  });

  test('returns { exists: false } for unknown address', async () => {
    const mockClient = {
      get: () => Promise.reject({ response: { status: 404 } }),
    };
    const app = makeApp(mockClient);
    const res = await supertest(app).get('/auth/account-exists?address=0xaabbccddeeff0011223344556677889900aabbcc');
    assert.equal(res.status, 200);
    assert.equal(res.body.exists, false);
  });

  test('returns 400 for missing address', async () => {
    const mockClient = { get: () => Promise.resolve({}) };
    const app = makeApp(mockClient);
    const res = await supertest(app).get('/auth/account-exists');
    assert.equal(res.status, 400);
  });

  test('returns 400 for invalid (non-Ethereum) address', async () => {
    const mockClient = { get: () => Promise.resolve({}) };
    const app = makeApp(mockClient);
    const res = await supertest(app).get('/auth/account-exists?address=notanaddress');
    assert.equal(res.status, 400);
  });
});
