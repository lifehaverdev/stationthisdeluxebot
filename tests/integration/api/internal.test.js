/**
 * Internal API Auth Integration Test
 *
 * Verifies the internal API authentication middleware:
 * - Missing key → 401
 * - Invalid key → 403
 * - Valid key → passes through
 *
 * Uses a standalone Express app with the same auth logic as production (app.js).
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const path = require('path');

// Load env so we have the real API keys
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Same auth middleware as app.js (lines 250-289)
  const internalApiAuthMiddleware = (req, res, next) => {
    const clientKey = req.headers['x-internal-client-key'];

    if (!clientKey) {
      return res.status(401).json({
        error: { code: 'MISSING_AUTH_HEADER', message: 'Missing X-Internal-Client-Key header.' }
      });
    }

    const validKeys = [
      process.env.INTERNAL_API_KEY_SYSTEM,
      process.env.INTERNAL_API_KEY_TELEGRAM,
      process.env.INTERNAL_API_KEY_DISCORD,
      process.env.INTERNAL_API_KEY_WEB,
      process.env.INTERNAL_API_KEY_API,
      process.env.INTERNAL_API_KEY_ADMIN,
    ].filter(key => key);

    if (!validKeys.includes(clientKey)) {
      return res.status(403).json({
        error: { code: 'INVALID_API_KEY', message: 'Invalid API key provided.' }
      });
    }

    next();
  };

  app.use('/internal', internalApiAuthMiddleware);
  app.get('/internal/ping', (req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe('Internal API authentication', () => {
  let app;
  let validKey;

  before(() => {
    app = createTestApp();
    // Pick the first available valid key
    validKey = process.env.INTERNAL_API_KEY_SYSTEM
      || process.env.INTERNAL_API_KEY_WEB
      || process.env.INTERNAL_API_KEY_TELEGRAM;
  });

  test('returns 401 when X-Internal-Client-Key header is missing', async () => {
    const res = await supertest(app).get('/internal/ping');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'MISSING_AUTH_HEADER');
  });

  test('returns 403 when X-Internal-Client-Key is invalid', async () => {
    const res = await supertest(app)
      .get('/internal/ping')
      .set('X-Internal-Client-Key', 'definitely-not-a-real-key');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'INVALID_API_KEY');
  });

  test('returns 200 when X-Internal-Client-Key is valid', async () => {
    if (!validKey) {
      // Skip if no internal API keys are configured in .env
      return;
    }
    const res = await supertest(app)
      .get('/internal/ping')
      .set('X-Internal-Client-Key', validKey);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});
