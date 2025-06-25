const express = require('express');
const { verifyApiKey } = require('../../core/services/apiKeyService');

/**
 * Creates a router for internal authentication-related tasks.
 * @param {Object} dependencies - Service dependencies, including logger and db services.
 * @returns {express.Router} - An Express router.
 */
function createAuthApi(dependencies) {
  const router = express.Router();
  // This internal API is allowed to access the database directly.
  const { userCoreDb } = dependencies.db;
  const logger = dependencies.logger;

  /**
   * POST /validate-key
   * Validates a given API key and returns the associated user and key details if successful.
   * This is intended for internal use by other services (like the external API gateway).
   */
  router.post('/validate-key', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.includes('_')) {
      return res.status(400).json({ error: { code: 'INVALID_FORMAT', message: 'API key is missing or has an invalid format.' } });
    }

    try {
      const keyPrefix = apiKey.substring(0, apiKey.indexOf('_') + 1);
      const user = await userCoreDb.findUserByApiKeyPrefix(keyPrefix);

      if (!user) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No user found for the provided API key prefix.' } });
      }

      const key = user.apiKeys.find(k => k.keyPrefix === keyPrefix && verifyApiKey(apiKey, k.keyHash));

      if (!key) {
        return res.status(401).json({ error: { code: 'INVALID_KEY', message: 'API key verification failed.' } });
      }
      
      if (key.status !== 'active') {
          return res.status(403).json({ error: { code: 'KEY_INACTIVE', message: 'The API key is not active.' } });
      }

      // Key is valid. Update its last used timestamp (fire-and-forget).
      userCoreDb.updateApiKeyLastUsed(user._id, key.keyPrefix).catch(err => {
        logger.error(`Failed to update last used timestamp for key ${key.keyPrefix} on behalf of internal request`, err);
      });

      // Return the necessary user and key information.
      res.status(200).json({
        user: {
          masterAccountId: user._id.toString(),
          ...user.profile,
        },
        apiKey: {
          keyPrefix: key.keyPrefix,
          permissions: key.permissions,
        },
      });
    } catch (error) {
      logger.error('Internal API key validation endpoint failed:', error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  return router;
}

module.exports = { createAuthApi }; 