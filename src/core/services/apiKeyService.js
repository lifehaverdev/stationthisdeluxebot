const crypto = require('crypto');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('ApiKeyService');

const API_KEY_PREFIX = 'ms2_';
const TOKEN_LENGTH = 32; // 32 random bytes → 64 hex chars
const KEY_PREFIX_LENGTH = 12; // 'ms2_' (4) + 8 random hex chars for DB lookup

/**
 * Generates a secure API key and its SHA-256 hash.
 * Format: ms2_<64 hex chars>
 *
 * @returns {{apiKey: string, keyHash: string, keyPrefix: string}}
 *          apiKey    — full key shown to user once (ms2_<64 hex>)
 *          keyHash   — SHA-256 of full key, stored in DB
 *          keyPrefix — first 12 chars (ms2_ + 8 hex), stored for fast lookup
 */
function generateApiKey() {
  const token = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  const apiKey = `${API_KEY_PREFIX}${token}`;

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Include random chars in the prefix so DB lookup is a meaningful discriminator
  const keyPrefix = apiKey.substring(0, KEY_PREFIX_LENGTH);

  logger.debug(`Generated new API key with prefix: ${keyPrefix}`);

  return {
    apiKey,     // e.g., 'ms2_a1b2c3d4...xyz'
    keyHash,    // SHA-256 hash stored in DB (never the raw key)
    keyPrefix,  // e.g., 'ms2_a1b2c3d4' — stored for fast lookup
  };
}

/**
 * Verifies a provided API key against a stored hash.
 *
 * @param {string} providedKey - The full API key provided by the user.
 * @param {string} storedHash - The SHA-256 hash stored in the database.
 * @returns {boolean} True if the key matches the hash, false otherwise.
 */
function verifyApiKey(providedKey, storedHash) {
  if (!providedKey || !storedHash) {
    return false;
  }
  const providedKeyHash = crypto.createHash('sha256').update(providedKey).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(providedKeyHash), Buffer.from(storedHash));
}

module.exports = {
  generateApiKey,
  verifyApiKey,
}; 