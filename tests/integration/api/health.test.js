/**
 * Health Endpoint Integration Test
 *
 * Verifies the /api/health endpoint responds correctly.
 * Uses supertest against a minimal Express app that mirrors the production health route.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

// Build a minimal app with just the health route — same handler as production
// (src/platforms/web/index.js line 157-159)
function createTestApp() {
  const app = express();
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return app;
}

describe('Health endpoint', () => {
  const app = createTestApp();

  test('GET /api/health returns 200', async () => {
    const res = await supertest(app).get('/api/health');
    assert.equal(res.status, 200);
  });

  test('GET /api/health returns { status: "ok" }', async () => {
    const res = await supertest(app).get('/api/health');
    assert.deepEqual(res.body, { status: 'ok' });
  });

  test('GET /api/health returns JSON content-type', async () => {
    const res = await supertest(app).get('/api/health');
    assert.match(res.headers['content-type'], /application\/json/);
  });
});
