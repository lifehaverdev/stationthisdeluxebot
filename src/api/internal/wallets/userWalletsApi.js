const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { PRIORITY } = require('../../../core/services/db/utils/queue'); // Import PRIORITY if needed for findOne
const crypto = require('crypto');

// This function initializes the routes for the User Wallets API
module.exports = function userWalletsApi(dependencies) {
  const { logger, db } = dependencies;
  // Use mergeParams to access masterAccountId from the parent router (userCoreApi)
  const router = express.Router({ mergeParams: true }); 

  // Check for essential dependencies
  if (!db || !db.userCore) {
    logger.error('[userWalletsApi] Critical dependency failure: db.userCore service is missing!');
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserCore database service is not available for wallets.' } });
    };
  }

  logger.info('[userWalletsApi] Initializing User Wallets API routes...');

  // Helper function to get masterAccountId (already validated by parent router, but check anyway)
  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.error(`[userWalletsApi] Invalid or missing masterAccountId (${masterAccountIdStr}) received from parent router.`);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve valid masterAccountId for wallet operation.' } });
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  //-------------------------------------------------------------------------
  // --- Wallet Endpoints --- 
  // Mounted at /users/:masterAccountId/wallets
  //-------------------------------------------------------------------------

  // POST /requests/magic-amount - Creates a new wallet linking request
  router.post('/requests/magic-amount', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { tokenAddress, expiresInSeconds } = req.body;
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets/requests/magic-amount called, requestId: ${requestId}`);

    if (!tokenAddress) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'tokenAddress is a required field.' } });
    }

    try {
        // Generate a cryptographically secure random number and format it as a wei string
        // This generates a 6-byte random buffer, giving us 2^48 possibilities,
        // which is sufficient to avoid collisions for this purpose.
        const randomBuffer = crypto.randomBytes(6);
        const magicAmountWei = BigInt('0x' + randomBuffer.toString('hex')).toString();

        const requestData = {
            masterAccountId,
            magicAmountWei,
            tokenAddress,
            expiresInSeconds
        };

        const newRequest = await db.walletLinkingRequests.createRequest(requestData);

        if (!newRequest) {
            // This could happen due to a magic amount collision, which is extremely rare.
            // A more robust implementation might retry a few times.
            logger.error(`[userWalletsApi] Failed to create magic amount request, possibly due to a collision. requestId: ${requestId}`);
            return res.status(500).json({ error: { code: 'REQUEST_CREATION_FAILED', message: 'Failed to generate a unique wallet linking request. Please try again.' } });
        }
        
        logger.info(`[userWalletsApi] Successfully created magic amount request for user ${masterAccountIdStr}. Amount: ${magicAmountWei}, requestId: ${requestId}`);
        res.status(201).json({
            message: 'Wallet linking request created successfully.',
            magicAmountWei: newRequest.magic_amount_wei,
            tokenAddress: newRequest.token_address,
            expiresAt: newRequest.expires_at,
        });

    } catch (error) {
        logger.error(`[userWalletsApi] Error creating magic amount request for user ${masterAccountIdStr}: ${error.message}`, error);
        res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  // POST / - Adds a wallet
  router.post('/', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const walletData = req.body;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets called with body: ${JSON.stringify(walletData)}, requestId: ${requestId}`);

    // MasterAccountId is already validated by getMasterAccountId

    if (!walletData || typeof walletData !== 'object' || Object.keys(walletData).length === 0) {
      logger.warn(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Empty or invalid wallet data payload. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body cannot be empty and must be an object containing wallet data.',
          requestId: requestId,
        },
      });
    }

    // Validate required wallet fields (e.g., address)
    if (!walletData.address || typeof walletData.address !== 'string' || walletData.address.trim() === '') {
      logger.warn(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Missing or invalid 'address' in wallet data. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_WALLET_DATA',
          message: "Missing or invalid 'address' in wallet data. Must be a non-empty string.",
          details: { field: 'address' },
          requestId: requestId,
        },
      });
    }

    try {
      // Use the ObjectId version of masterAccountId for DB calls
      const updatedUser = await db.userCore.addWallet(masterAccountId, walletData);

      if (!updatedUser) {
        logger.warn(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: User not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found with the provided masterAccountId.',
            details: { masterAccountId: masterAccountIdStr },
            requestId: requestId,
          },
        });
      }

      logger.info(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Wallet added successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser);

    } catch (error) {
      logger.error(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Error adding wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while adding the wallet.',
          requestId: requestId,
        },
      });
    }
  });

  // PUT /:address - Updates a wallet
  router.put('/:address', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    
    const { address: walletAddressToUpdate } = req.params;
    const updatePayload = req.body;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userWalletsApi] PUT /users/${masterAccountIdStr}/wallets/${walletAddressToUpdate} called with body: ${JSON.stringify(updatePayload)}, requestId: ${requestId}`);

    // MasterAccountId already validated

    // Validate walletAddressToUpdate
    if (!walletAddressToUpdate || typeof walletAddressToUpdate !== 'string' || walletAddressToUpdate.trim() === '') {
      logger.warn(`[userWalletsApi] PUT /users/${masterAccountIdStr}/wallets/...: Missing or invalid wallet address in path. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_WALLET_ADDRESS_PARAM',
          message: 'Wallet address in path parameter must be a non-empty string.',
          details: { field: 'address', value: walletAddressToUpdate },
          requestId: requestId,
        },
      });
    }

    // Validate updatePayload
    if (!updatePayload || typeof updatePayload !== 'object' || Object.keys(updatePayload).length === 0) {
      logger.warn(`[userWalletsApi] PUT .../${walletAddressToUpdate}: Empty or invalid update payload. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_UPDATE_PAYLOAD',
          message: 'Request body cannot be empty and must be an object containing fields to update.',
          requestId: requestId,
        },
      });
    }

    // Construct $set operations and validate payload fields
    const setOperations = {};
    const allowedUpdateFields = ['isPrimary', 'verified', 'name', 'tag'];
    let hasValidUpdateField = false;

    if (updatePayload.hasOwnProperty('isPrimary')) {
      if (typeof updatePayload.isPrimary !== 'boolean') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'isPrimary' must be a boolean.", details: { field: 'isPrimary' }, requestId }});
      }
      setOperations['wallets.$[elem].isPrimary'] = updatePayload.isPrimary;
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('verified')) {
      if (typeof updatePayload.verified !== 'boolean') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'verified' must be a boolean.", details: { field: 'verified' }, requestId }});
      }
      setOperations['wallets.$[elem].verified'] = updatePayload.verified;
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('name')) {
      if (typeof updatePayload.name !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'name' must be a string.", details: { field: 'name' }, requestId }});
      }
      setOperations['wallets.$[elem].name'] = updatePayload.name.trim(); 
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('tag')) {
      if (typeof updatePayload.tag !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'tag' must be a string.", details: { field: 'tag' }, requestId }});
      }
      setOperations['wallets.$[elem].tag'] = updatePayload.tag.trim(); 
      hasValidUpdateField = true;
    }

    if (!hasValidUpdateField) {
      logger.warn(`[userWalletsApi] PUT .../${walletAddressToUpdate}: Payload contains no updatable fields. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'NO_UPDATABLE_FIELDS',
          message: `Request body must contain at least one updatable field: ${allowedUpdateFields.join(', ')}.`,
          requestId: requestId,
        },
      });
    }
    
    setOperations['wallets.$[elem].updatedAt'] = new Date();

    const updateQuery = { $set: setOperations };
    const updateOptions = { arrayFilters: [{ 'elem.address': walletAddressToUpdate }] };

    try {
      // Pre-check user and wallet existence
      const userExists = await db.userCore.findOne(
        { _id: masterAccountId, 'wallets.address': walletAddressToUpdate }, 
        PRIORITY.HIGH 
      );

      if (!userExists) {
        logger.warn(`[userWalletsApi] PUT .../${walletAddressToUpdate}: User or specific wallet not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_OR_WALLET_NOT_FOUND',
            message: 'User not found, or no wallet with the specified address exists for this user.',
            details: { masterAccountId: masterAccountIdStr, walletAddress: walletAddressToUpdate },
            requestId: requestId,
          },
        });
      }
      
      const updatedUser = await db.userCore.updateUserCore(masterAccountId, updateQuery, updateOptions);

      if (!updatedUser) {
        logger.warn(`[userWalletsApi] PUT .../${walletAddressToUpdate}: User not found post-update. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND_POST_UPDATE',
            message: 'User not found after attempting update.',
            details: { masterAccountId: masterAccountIdStr, walletAddress: walletAddressToUpdate },
            requestId: requestId,
          },
        });
      }

      logger.info(`[userWalletsApi] PUT .../${walletAddressToUpdate}: Wallet updated successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser);

    } catch (error) {
      logger.error(`[userWalletsApi] PUT .../${walletAddressToUpdate}: Error updating wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while updating the wallet.',
          requestId: requestId,
        },
      });
    }
  });

  // DELETE /:address - Removes a wallet
  router.delete('/:address', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { address: walletAddressToDelete } = req.params;
    const masterAccountIdStr = masterAccountId.toString(); // For logging

    logger.info(`[userWalletsApi] DELETE /users/${masterAccountIdStr}/wallets/${walletAddressToDelete} called, requestId: ${requestId}`);

    // MasterAccountId already validated

    // Validate walletAddressToDelete
    if (!walletAddressToDelete || typeof walletAddressToDelete !== 'string' || walletAddressToDelete.trim() === '') {
      logger.warn(`[userWalletsApi] DELETE /users/${masterAccountIdStr}/wallets/...: Missing or invalid wallet address in path. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_WALLET_ADDRESS_PARAM',
          message: 'Wallet address in path parameter must be a non-empty string.',
          details: { field: 'address', value: walletAddressToDelete },
          requestId: requestId,
        },
      });
    }

    try {
      // Pre-check: Ensure user and the specific wallet exist
      const initialUser = await db.userCore.findOne(
        { _id: masterAccountId, 'wallets.address': walletAddressToDelete }, 
        PRIORITY.HIGH
      );

      if (!initialUser) {
        logger.warn(`[userWalletsApi] DELETE .../${walletAddressToDelete}: User or specific wallet not found for deletion. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_OR_WALLET_NOT_FOUND',
            message: 'User not found, or no wallet with the specified address exists for this user.',
            details: { masterAccountId: masterAccountIdStr, walletAddress: walletAddressToDelete },
            requestId: requestId,
          },
        });
      }

      const updatedUser = await db.userCore.deleteWallet(masterAccountId, walletAddressToDelete);

      if (!updatedUser) {
        logger.warn(`[userWalletsApi] DELETE .../${walletAddressToDelete}: User found initially but disappeared before/during wallet deletion. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND_DURING_DELETE',
            message: 'User was not found when attempting to delete the wallet.',
            details: { masterAccountId: masterAccountIdStr, walletAddress: walletAddressToDelete },
            requestId: requestId,
          },
        });
      }

      // Verify wallet was actually removed
      const walletStillExists = updatedUser.wallets && updatedUser.wallets.some(w => w.address === walletAddressToDelete);
      if (walletStillExists) {
        logger.error(`[userWalletsApi] DELETE .../${walletAddressToDelete}: Wallet still found after delete operation. Unexpected. requestId: ${requestId}`);
        return res.status(500).json({
          error: {
            code: 'WALLET_DELETION_VERIFICATION_FAILED',
            message: 'Wallet deletion verification failed. Check server logs.',
            requestId: requestId,
          },
        });
      }

      logger.info(`[userWalletsApi] DELETE .../${walletAddressToDelete}: Wallet deleted successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser); // Return the updated user object

    } catch (error) {
      logger.error(`[userWalletsApi] DELETE .../${walletAddressToDelete}: Error deleting wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('walletAddress is required')) {
        return res.status(400).json({
            error: { code: 'DB_VALIDATION_ERROR', message: error.message, requestId: requestId }
        });
      }
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while deleting the wallet.',
          requestId: requestId,
        },
      });
    }
  });

  // Note: Catch-all for malformed DELETE requests under /users/:masterAccountId/wallets/* should remain in userCoreApi.js
  // as it catches paths before they reach this sub-router.

  logger.info('[userWalletsApi] User Wallets API routes initialized.');
  return router;
}; 