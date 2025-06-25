const crypto = require('crypto');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('ApiKeyService');

const API_KEY_PREFIX = 'sat_';
const TOKEN_LENGTH = 32; // The length of the random part of the key

/**
 * Generates a secure API key and its SHA-256 hash.
 * The key consists of a prefix, a random token, and is base64 encoded.
 *
 * @returns {{apiKey: string, keyHash: string, keyPrefix: string}}
 *          An object containing the full API key (to be shown to the user once),
 *          its SHA-256 hash (to be stored in the database), and the key prefix
 *          (for quick lookups).
 */
function generateApiKey() {
  const token = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  const apiKey = `${API_KEY_PREFIX}${token}`;
  
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  // The prefix is the part of the key before the first underscore, plus the underscore itself.
  const keyPrefix = apiKey.substring(0, apiKey.indexOf('_') + 1);

  logger.info(`Generated new API key with prefix: ${keyPrefix}`);
  
  return {
    apiKey, // e.g., 'sat_...xyz'
    keyHash, // The SHA-256 hash of the full apiKey
    keyPrefix, // 'sat_'
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