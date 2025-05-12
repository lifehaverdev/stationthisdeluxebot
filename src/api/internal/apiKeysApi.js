const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const crypto = require('crypto'); // Needed for key generation
const { PRIORITY } = require('../../core/services/db/utils/queue'); // Needed for findOne pre-check

// This function initializes the routes for the User API Keys API
module.exports = function initializeApiKeysApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router({ mergeParams: true }); 

  if (!db || !db.userCore) {
    logger.error('[userApiKeysApi] Critical dependency failure: db.userCore service is missing!');
    router.use((req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserCore database service is not available for API keys.' } });
    });
    return router;
  }

  logger.info('[userApiKeysApi] Initializing User API Keys API routes...');

  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.error(`[userApiKeysApi] Invalid or missing masterAccountId (${masterAccountIdStr}) in params.`);
        if (!res.headersSent) {
             res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId parameter.' } });
        }
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
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userApiKeysApi] POST /users/${masterAccountIdStr}/apikeys called with name: '${name}', permissions: ${JSON.stringify(permissions)}, requestId: ${requestId}`);

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: "Missing or invalid 'name' in request body. Must be a non-empty string.", details: { field: 'name' }, requestId },
      });
    }

    if (permissions && (!Array.isArray(permissions) || !permissions.every(p => typeof p === 'string' && p.trim() !== ''))) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: "Invalid 'permissions' in request body. Must be an array of non-empty strings.", details: { field: 'permissions' }, requestId },
      });
    }

    try {
      const apiKeySecret = crypto.randomBytes(24).toString('hex');
      const fullApiKey = `st_${apiKeySecret}`;
      const keyPrefix = `st_${apiKeySecret.substring(0, 6)}`;
      const keyHash = crypto.createHash('sha256').update(fullApiKey).digest('hex');
      const now = new Date();

      const apiKeyDocumentForDb = {
        keyPrefix,
        keyHash,
        name: name.trim(),
        permissions: permissions || [],
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        status: 'active',
      };

      const updatedUser = await db.userCore.addApiKey(masterAccountId, apiKeyDocumentForDb);

      if (!updatedUser) {
        logger.warn(`[userApiKeysApi] POST /apikeys: User not found for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found with the provided masterAccountId.', details: { masterAccountId: masterAccountIdStr }, requestId },
        });
      }

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
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userApiKeysApi] GET /users/${masterAccountIdStr}/apikeys called, requestId: ${requestId}`);

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

  // GET /:keyPrefix - Get a specific API key by prefix
  router.get('/:keyPrefix', async (req, res) => {
        const requestId = uuidv4();
        const masterAccountId = getMasterAccountId(req, res);
        if (!masterAccountId) return;
        const masterAccountIdStr = masterAccountId.toString();
        const { keyPrefix } = req.params;

        logger.info(`[userApiKeysApi] GET /users/${masterAccountIdStr}/apikeys/${keyPrefix} called, requestId: ${requestId}`);

        if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
            return res.status(400).json({ error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId }});
        }

        try {
            const userWithKey = await db.userCore.findOne(
                { _id: masterAccountId, 'apiKeys.keyPrefix': keyPrefix },
                { projection: { 'apiKeys.$': 1 } },
                PRIORITY.HIGH
            );

            if (!userWithKey || !userWithKey.apiKeys || userWithKey.apiKeys.length === 0) {
                logger.warn(`[userApiKeysApi] GET .../apikeys/${keyPrefix}: User or API key not found. requestId: ${requestId}`);
                return res.status(404).json({
                    error: { code: 'API_KEY_NOT_FOUND', message: 'API key with the specified prefix not found for this user.', details: { masterAccountId: masterAccountIdStr, keyPrefix }, requestId },
                });
            }

            const key = userWithKey.apiKeys[0];
            const responseApiKey = {
                keyPrefix: key.keyPrefix,
                name: key.name,
                permissions: key.permissions,
                createdAt: key.createdAt ? key.createdAt.toISOString() : null,
                updatedAt: key.updatedAt ? key.updatedAt.toISOString() : null,
                lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
                status: key.status,
            };

            logger.info(`[userApiKeysApi] GET .../apikeys/${keyPrefix}: API key found. requestId: ${requestId}`);
            res.status(200).json(responseApiKey);

        } catch (error) {
            logger.error(`[userApiKeysApi] GET .../apikeys/${keyPrefix}: Error retrieving API key. Error: ${error.message}. requestId: ${requestId}`, error);
            res.status(500).json({
                error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving the API key.', requestId },
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
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userApiKeysApi] PUT /users/${masterAccountIdStr}/apikeys/${keyPrefix} called with payload: ${JSON.stringify(payload)}, requestId: ${requestId}`);

    if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId }});
    }
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_UPDATE_PAYLOAD', message: 'Request body cannot be empty and must be an object.', requestId }});
    }

    const updatesForSubDoc = {};
    let hasValidUpdate = false;

    if (payload.hasOwnProperty('name')) {
      if (typeof payload.name !== 'string' || payload.name.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'name' must be a non-empty string.", details: { field: 'name' }, requestId }});
      }
      updatesForSubDoc.name = payload.name.trim();
      hasValidUpdate = true;
    }
    if (payload.hasOwnProperty('permissions')) {
      if (!Array.isArray(payload.permissions) || !payload.permissions.every(p => typeof p === 'string' && p.trim() !== '')) {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'permissions' must be an array of non-empty strings.", details: { field: 'permissions' }, requestId }});
      }
      updatesForSubDoc.permissions = payload.permissions;
      hasValidUpdate = true;
    }
    if (payload.hasOwnProperty('status')) {
      if (typeof payload.status !== 'string' || !['active', 'inactive'].includes(payload.status)) {
          return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'status' must be either 'active' or 'inactive'.", details: { field: 'status' }, requestId }});
      }
      updatesForSubDoc.status = payload.status;
      hasValidUpdate = true;
    }

    if (!hasValidUpdate) {
      return res.status(400).json({ error: { code: 'NO_UPDATABLE_FIELDS', message: `Request body must contain at least one of the allowed fields to update: name, permissions, status.`, requestId }});
    }

    updatesForSubDoc.updatedAt = new Date();

    try {
      const updatedUser = await db.userCore.updateApiKey(masterAccountId, keyPrefix, updatesForSubDoc);

      if (!updatedUser) {
        logger.warn(`[userApiKeysApi] PUT .../apikeys/${keyPrefix}: API key not found or update failed. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'API_KEY_NOT_FOUND', message: 'API key with the specified prefix not found for this user, or update failed.', details: { masterAccountId: masterAccountIdStr, keyPrefix }, requestId },
        });
      }
      
      const updatedKeyData = updatedUser.apiKeys && updatedUser.apiKeys.find(k => k.keyPrefix === keyPrefix);

      if (!updatedKeyData) {
        logger.error(`[userApiKeysApi] PUT .../apikeys/${keyPrefix}: API key was reportedly updated but not found in returned user document. This is unexpected. requestId: ${requestId}`);
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'API key updated but could not be retrieved.', requestId } });
      }

      const responseApiKey = {
        keyPrefix: updatedKeyData.keyPrefix,
        name: updatedKeyData.name,
        permissions: updatedKeyData.permissions,
        createdAt: updatedKeyData.createdAt ? updatedKeyData.createdAt.toISOString() : null,
        updatedAt: updatedKeyData.updatedAt ? updatedKeyData.updatedAt.toISOString() : null,
        lastUsedAt: updatedKeyData.lastUsedAt ? updatedKeyData.lastUsedAt.toISOString() : null,
        status: updatedKeyData.status,
      };

      logger.info(`[userApiKeysApi] PUT .../apikeys/${keyPrefix}: API key updated successfully. requestId: ${requestId}`);
      res.status(200).json(responseApiKey);

    } catch (error) {
      logger.error(`[userApiKeysApi] PUT .../apikeys/${keyPrefix}: Error updating API key. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while updating the API key.', requestId },
      });
    }
  });

  // DELETE /:keyPrefix - Deletes/Deactivates an API key
  router.delete('/:keyPrefix', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { keyPrefix } = req.params;
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userApiKeysApi] DELETE /users/${masterAccountIdStr}/apikeys/${keyPrefix} called, requestId: ${requestId}`);

    if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
      return res.status(400).json({
        error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId },
      });
    }

    try {
      // Use dedicated delete method
      const updatedUser = await db.userCore.deleteApiKey(masterAccountId, keyPrefix);

      if (!updatedUser) {
        // deleteApiKey returns null if user or key prefix is not found
        // Perform pre-check for better 404 message
        const userWithKey = await db.userCore.findOne(
            { _id: masterAccountId, 'apiKeys.keyPrefix': keyPrefix }, {}, PRIORITY.LOW
        );
        if (!userWithKey) {
             logger.warn(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: User or API Key not found. requestId: ${requestId}`);
             return res.status(404).json({
                 error: { code: 'API_KEY_NOT_FOUND', message: 'API key with the specified prefix not found for this user.', details: { masterAccountId: masterAccountIdStr, keyPrefix }, requestId }
             });
        } else {
             // Should not happen if pre-check passes and delete fails, implies concurrent delete
             logger.error(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: deleteApiKey returned null unexpectedly after pre-check found key. requestId: ${requestId}`);
             return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'API key deletion failed unexpectedly.', requestId }});
        }
      }

      // Verify the key is actually gone
      const keyStillExists = updatedUser.apiKeys && updatedUser.apiKeys.some(k => k.keyPrefix === keyPrefix);
      if (keyStillExists) {
        logger.error(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} still exists after deletion attempt for user ${masterAccountIdStr}. requestId: ${requestId}`);
        return res.status(500).json({
          error: { code: 'API_KEY_DELETION_VERIFICATION_FAILED', message: 'API key deletion verification failed.', details: { masterAccountId: masterAccountIdStr, keyPrefix }, requestId },
        });
      }

      logger.info(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} deleted successfully for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
      res.status(204).send();

    } catch (error) {
      logger.error(`[userApiKeysApi] DELETE /apikeys/${keyPrefix}: Error deleting API key for masterAccountId ${masterAccountIdStr}. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while deleting the API key.', requestId },
      });
    }
  });

  // Error handling middleware specific to this router
  router.use((err, req, res, next) => {
    const masterAccountId = req.params.masterAccountId;
    const keyPrefix = req.params.keyPrefix;
    logger.error(`[userApiKeysApi] Error in API key route for user ${masterAccountId}, key ${keyPrefix || 'N/A'}: ${err.message}`, { 
        stack: err.stack, 
        masterAccountId, 
        keyPrefix,
        requestId: req.id // Assuming a request ID middleware adds req.id
    });
    
    if (res.headersSent) {
      return next(err);
    }

    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred in the API keys API.'
      }
    });
  });


  logger.info('[userApiKeysApi] User API Keys API routes initialized.');
  return router;
};
