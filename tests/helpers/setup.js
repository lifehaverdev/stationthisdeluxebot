/**
 * Test Setup Helper
 *
 * Provides DB connection management and environment validation for integration tests.
 * Uses the same connection path as the production app (getCachedClient).
 */

const path = require('path');

// Load .env from project root (tests may run from any cwd)
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { getCachedClient } = require('../../src/core/services/db/utils/queue');

const DB_NAME = process.env.MONGO_DB_NAME || 'station';

/**
 * Validate that required environment variables are present.
 * Throws if any are missing so tests fail fast with a clear message.
 */
function validateEnv(requiredVars = []) {
  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars for tests: ${missing.join(', ')}`);
  }
}

/**
 * Get a connected MongoDB client + database handle.
 * Re-uses the production cached client — no separate test pool needed.
 * @returns {Promise<{ client: import('mongodb').MongoClient, db: import('mongodb').Db }>}
 */
async function getTestDb() {
  const client = await getCachedClient();
  const db = client.db(DB_NAME);
  return { client, db };
}

/**
 * Close the cached MongoDB connection and force-exit after a short delay.
 * node:test runs each file in its own child process, so this is safe.
 * The delay lets final TAP output flush before exit.
 */
async function closeTestDb() {
  try {
    const client = await getCachedClient();
    await client.close(true); // force close
  } catch {
    // already closed or never connected — fine
  }
  // Safety net: if the event loop still hangs (dbQueue timers, etc.),
  // force exit after a short grace period.
  setTimeout(() => process.exit(0), 500).unref();
}

module.exports = {
  validateEnv,
  getTestDb,
  closeTestDb,
  DB_NAME,
};
