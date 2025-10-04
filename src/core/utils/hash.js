const crypto = require('crypto');

/**
 * sha256Hex – compute SHA-256 digest of a string and return hex representation.
 * @param {string} str
 * @returns {string} hex digest
 */
function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

module.exports = { sha256Hex };
