/**
 * Webhook Utilities
 * ------------------
 * Utility functions for webhook URL validation and signature generation
 */

const crypto = require('crypto');

/**
 * Validates a webhook URL format and security requirements
 * @param {string} url - The webhook URL to validate
 * @param {boolean} allowLocalhost - Allow localhost URLs (for development)
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateWebhookUrl(url, allowLocalhost = false) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Webhook URL must be a non-empty string' };
  }

  try {
    const parsed = new URL(url.trim());
    
    // Require HTTPS except for localhost in development
    if (parsed.protocol !== 'https:') {
      const isLocalhost = parsed.hostname === 'localhost' || 
                         parsed.hostname === '127.0.0.1' || 
                         parsed.hostname.startsWith('192.168.') ||
                         parsed.hostname.startsWith('10.') ||
                         parsed.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./);
      
      if (!allowLocalhost || !isLocalhost) {
        return { valid: false, error: 'Webhook URLs must use HTTPS (except localhost in development)' };
      }
    }

    // Validate URL format
    if (!parsed.hostname) {
      return { valid: false, error: 'Webhook URL must include a hostname' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid webhook URL format: ${error.message}` };
  }
}

/**
 * Generates HMAC-SHA256 signature for webhook payload
 * @param {object|string} payload - The payload to sign (object will be JSON stringified)
 * @param {string} secret - The secret key for signing
 * @returns {string} - Hex-encoded signature
 */
function signWebhook(payload, secret) {
  if (!secret) {
    return null;
  }

  const payloadString = typeof payload === 'string' 
    ? payload 
    : JSON.stringify(payload);
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  
  return signature;
}

/**
 * Converts costUsd from various formats to a number
 * @param {any} costUsd - Cost value from database (Decimal128, number, string, or null)
 * @returns {number|null} - Converted number or null
 */
function convertCostUsd(costUsd) {
  if (costUsd === null || costUsd === undefined) {
    return null;
  }

  // Handle Decimal128 objects (MongoDB BSON type)
  if (costUsd && typeof costUsd === 'object') {
    // Check for Decimal128 BSON type first
    if (costUsd._bsontype === 'Decimal128' && costUsd.toString) {
      try {
        return parseFloat(costUsd.toString());
      } catch (e) {
        return null;
      }
    }
    
    // Handle MongoDB $numberDecimal format
    if (costUsd.$numberDecimal) {
      try {
        return parseFloat(costUsd.$numberDecimal);
      } catch (e) {
        return null;
      }
    }
    
    // Try toString() as fallback
    if (costUsd.toString && typeof costUsd.toString === 'function') {
      try {
        const str = costUsd.toString();
        if (str !== '[object Object]') {
          const num = parseFloat(str);
          if (!isNaN(num)) {
            return num;
          }
        }
      } catch (e) {
        // Fall through
      }
    }
  }

  // Handle string or number
  if (typeof costUsd === 'string' || typeof costUsd === 'number') {
    const num = parseFloat(costUsd);
    return isNaN(num) ? null : num;
  }

  return null;
}

module.exports = {
  validateWebhookUrl,
  signWebhook,
  convertCostUsd
};

