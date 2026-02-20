const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const crypto = require('crypto'); // Needed for key generation
const { PRIORITY } = require('../../core/services/db/utils/queue'); // Needed for findOne pre-check

// This function initializes the routes for the User API Keys API
module.exports = function userApiKeysApi(dependencies) {
  const { logger, db } = dependencies;
  // Use mergeParams to access masterAccountId from the parent router (userCoreApi)
  const router = express.Router({ mergeParams: true }); 

  // Check for essential dependencies
  if (!db || !db.userCore) {
    logger.error('[userApiKeysApi] Critical dependency failure: db.userCore service is missing!');
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserCore database service is not available for API keys.' } });
    };
  }

  logger.debug('[userApiKeysApi] Initializing User API Keys API routes...');

  // Helper function to get masterAccountId (already validated by parent router, but check anyway)
  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.error(`[userApiKeysApi] Invalid or missing masterAccountId (${masterAccountIdStr}) received from parent router.`);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve valid masterAccountId for API key operation.' } });
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  //-------------------------------------------------------------------------
  // --- API Key Endpoints --- 
  // Mounted at /users/:masterAccountId/apikeys
  //-------------------------------------------------------------------------

  // POST / - Creates an API key
  router.post('/', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    
    const { name, permissions } = req.body;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userApiKeysApi] POST /users/${masterAccountIdStr}/apikeys called with name: '${name}', permissions: ${JSON.stringify(permissions)}, requestId: ${requestId}`);

    // MasterAccountId already validated

    if (!name || typeof name !== 'string' || name.trim() === '') {
      logger.warn(`[userApiKeysApi] POST /apikeys: Missing or invalid 'name'. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: "Missing or invalid 'name' in request body. Must be a non-empty string.", details: { field: 'name' }, requestId },
      });
    }

    if (permissions && (!Array.isArray(permissions) || !permissions.every(p => typeof p === 'string' && p.trim() !== ''))) {
      logger.warn(`[userApiKeysApi] POST /apikeys: Invalid 'permissions' format. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: "Invalid 'permissions' in request body. Must be an array of non-empty strings.", details: { field: 'permissions' }, requestId },
      });
    }

    try {
      // 1. Generate API Key components
      const apiKeySecret = crypto.randomBytes(24).toString('hex'); // 48 characters
      const fullApiKey = `st_${apiKeySecret}`; // Prefix with st_
      const keyPrefix = `st_${apiKeySecret.substring(0, 6)}`;
      const keyHash = crypto.createHash('sha256').update(fullApiKey).digest('hex');
      const now = new Date();

      const apiKeyDocumentForDb = {
        keyPrefix,
        keyHash,
        name: name.trim(),
        permissions: permissions || [], // Default to empty array if not provided
        createdAt: now,
        updatedAt: now, // Initially same as createdAt
        lastUsedAt: null,
        status: 'active',
      };

      // 2. Add to DB
      const updatedUser = await db.userCore.addApiKey(masterAccountId, apiKeyDocumentForDb);

      if (!updatedUser) {
        logger.warn(`[userApiKeysApi] POST /apikeys: User not found for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found with the provided masterAccountId.', details: { masterAccountId: masterAccountIdStr }, requestId },
        });
      }

      // 3. Prepare and send response (showing fullApiKey ONCE)
      const responseApiKeyObject = {
        apiKey: fullApiKey, // Show the full key ONLY in this response
        keyPrefix: apiKeyDocumentForDb.keyPrefix,
        name: apiKeyDocumentForDb.name,
        permissions: apiKeyDocumentForDb.permissions,
        createdAt: apiKeyDocumentForDb.createdAt.toISOString(),
        status: apiKeyDocumentForDb.status,
      };

      logger.info(`[userApiKeysApi] POST /apikeys: API key created successfully for masterAccountId ${masterAccountIdStr}. KeyPrefix: ${keyPrefix}. requestId: ${requestId}`);
      res.status(201).json(responseApiKeyObject);

    } catch (error) {
      logger.error(`[userApiKeysApi] POST /apikeys: Error creating API key for masterAccountId ${masterAccountIdStr}. Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('Invalid apiKeyDocument')) { 
        return res.status(500).json({ error: { code: 'DB_OPERATION_ERROR', message: 'Internal error preparing API key for storage.', requestId }});
      }
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while creating the API key.', requestId },
      });
    }
  });

  // GET / - Lists API keys
  router.get('/', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userApiKeysApi] GET /users/${masterAccountIdStr}/apikeys called, requestId: ${requestId}`);

    // MasterAccountId already validated

    try {
      const user = await db.userCore.findUserCoreById(masterAccountId);

      if (!user) {
        logger.warn(`[userApiKeysApi] GET /apikeys: User not found for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found with the provided masterAccountId.', details: { masterAccountId: masterAccountIdStr }, requestId },
        });
      }

      let userApiKeys = [];
      if (user.apiKeys && Array.isArray(user.apiKeys)) {
        userApiKeys = user.apiKeys.map(key => ({
          keyPrefix: key.keyPrefix,
          name: key.name,
          permissions: key.permissions,
          createdAt: key.createdAt ? key.createdAt.toISOString() : null, 
          updatedAt: key.updatedAt ? key.updatedAt.toISOString() : null,
          lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
          status: key.status,
          // Explicitly DO NOT include key.keyHash or the full key itself
        }));
      }

      logger.info(`[userApiKeysApi] GET /apikeys: Successfully retrieved ${userApiKeys.length} API key(s) for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
      res.status(200).json(userApiKeys);

    } catch (error) {
      logger.error(`[userApiKeysApi] GET /apikeys: Error retrieving API keys for masterAccountId ${masterAccountIdStr}. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving API keys.', requestId },
      });
    }
  });

  // PUT /:keyPrefix - Updates an API key
  router.put('/:keyPrefix', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { keyPrefix } = req.params;
    const payload = req.body;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userApiKeysApi] PUT /users/${masterAccountIdStr}/apikeys/${keyPrefix} called with payload: ${JSON.stringify(payload)}, requestId: ${requestId}`);

    // MasterAccountId already validated

    if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId }});
    }
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_UPDATE_PAYLOAD', message: 'Request body cannot be empty and must be an object.', requestId }});
    }

    const updatesForDb = {};
    let hasValidUpdate = false;
    const allowedFields = ['name', 'permissions', 'status'];

    if (payload.hasOwnProperty('name')) {
      if (typeof payload.name !== 'string' || payload.name.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'name' must be a non-empty string.", details: { field: 'name' }, requestId }});
      }
      updatesForDb['apiKeys.$[elem].name'] = payload.name.trim();
      hasValidUpdate = true;
    }
    if (payload.hasOwnProperty('permissions')) {
      if (!Array.isArray(payload.permissions) || !payload.permissions.every(p => typeof p === 'string' && p.trim() !== '')) {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'permissions' must be an array of non-empty strings.", details: { field: 'permissions' }, requestId }});
      }
      updatesForDb['apiKeys.$[elem].permissions'] = payload.permissions;
      hasValidUpdate = true;
    }
    if (payload.hasOwnProperty('status')) {
      if (typeof payload.status !== 'string' || !['active', 'inactive'].includes(payload.status)) {
          return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'status' must be either 'active' or 'inactive'.", details: { field: 'status' }, requestId }});
      }
      updatesForDb['apiKeys.$[elem].status'] = payload.status;
      hasValidUpdate = true;
    }

    if (!hasValidUpdate) {
      return res.status(400).json({
        error: { code: 'NO_UPDATABLE_FIELDS', message: `Request body must contain at least one updatable field: ${allowedFields.join(', ')}.`, requestId },
      });
    }

    updatesForDb['apiKeys.$[elem].updatedAt'] = new Date();

    try {
      // Pre-check user and API key existence
      const userWithKey = await db.userCore.findOne(
        { _id: masterAccountId, 'apiKeys.keyPrefix': keyPrefix }, 
        PRIORITY.HIGH
      );
      if (!userWithKey) {
        return res.status(404).json({ error: { code: 'USER_OR_API_KEY_NOT_FOUND', message: 'User not found or no API key with the specified prefix exists for this user.', details: { masterAccountId: masterAccountIdStr, keyPrefix }, requestId }});
      }

      const updatedUser = await db.userCore.updateApiKey(masterAccountId, keyPrefix, updatesForDb);

      if (!updatedUser) {
        return res.status(404).json({ error: { code: 'USER_NOT_FOUND_POST_UPDATE', message: 'User not found after attempting API key update.', details: { masterAccountId: masterAccountIdStr, keyPrefix }, requestId }});
      }
      
      logger.info(`[userApiKeysApi] PUT /apikeys/${keyPrefix}: API key updated successfully for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
      res.status(200).json(updatedUser);

    } catch (error) {
      logger.error(`[userApiKeysApi] PUT /apikeys/${keyPrefix}: Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('keyPrefix is required') || error.message.includes('updates object is required')) {
        return res.status(500).json({ error: { code: 'DB_VALIDATION_ERROR', message: `Internal error calling database: ${error.message}`, requestId }});
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred.', requestId }});
    }
  });

  // DELETE /:keyPrefix - Deletes/Deactivates an API key
  router.delete('/:keyPrefix', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { keyPrefix } = req.params;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userApiKeysApi] DELETE /users/${masterAccountIdStr}/apikeys/${keyPrefix} called, requestId: ${requestId}`);

    // MasterAccountId already validated

    if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
      logger.warn(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: Invalid keyPrefix. Value: ${keyPrefix}, requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId },
      });
    }

    try {
      // Pre-check
      const userWithKey = await db.userCore.findOne(
        { _id: masterAccountId, 'apiKeys.keyPrefix': keyPrefix },
        PRIORITY.HIGH
      );
      if (!userWithKey) {
        logger.warn(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: User or API Key not found. masterAccountId: ${masterAccountIdStr}, keyPrefix: ${keyPrefix}, requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_OR_API_KEY_NOT_FOUND',
            message: 'User not found, or no API key with the specified prefix exists for this user.',
            details: { masterAccountId: masterAccountIdStr, keyPrefix },
            requestId,
          },
        });
      }
      
      const updatedUser = await db.userCore.deleteApiKey(masterAccountId, keyPrefix);

      if (!updatedUser) {
        logger.warn(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} not found for user ${masterAccountIdStr} during deletion attempt, or user vanished. requestId: ${requestId}`);
        return res.status(404).json({ 
          error: {
            code: 'API_KEY_NOT_FOUND_ON_DELETE',
            message: 'API key not found during deletion attempt, or user data inconsistent.',
            details: { masterAccountId: masterAccountIdStr, keyPrefix },
            requestId,
          },
        });
      }

      // Verify the key is actually gone
      const keyStillExists = updatedUser.apiKeys && updatedUser.apiKeys.some(k => k.keyPrefix === keyPrefix);
      if (keyStillExists) {
        logger.error(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} was expected to be deleted for user ${masterAccountIdStr}, but it still exists. requestId: ${requestId}`);
        return res.status(500).json({
          error: {
            code: 'API_KEY_NOT_DELETED_UNEXPECTEDLY',
            message: 'API key was targeted for deletion but was not removed. Please check server logs.',
            details: { masterAccountId: masterAccountIdStr, keyPrefix },
            requestId,
          },
        });
      }

      logger.info(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} deleted successfully for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
      res.status(200).json({ 
        message: 'API key deleted successfully.',
        details: { masterAccountId: masterAccountIdStr, keyPrefix },
        requestId 
      });

    } catch (error) {
      logger.error(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: Error deleting API key for masterAccountId ${masterAccountIdStr}. Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('masterAccountId is required') || error.message.includes('keyPrefix is required')) {
         return res.status(500).json({ error: { code: 'DB_VALIDATION_ERROR', message: `Internal error calling database: ${error.message}`, requestId }});
      }
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while deleting the API key.', requestId },
      });
    }
  });

  // Note: Catch-all for malformed DELETE requests under /users/:masterAccountId/apikeys/* should remain in userCoreApi.js

  logger.debug('[userApiKeysApi] User API Keys API routes initialized.');
  return router;
}; 