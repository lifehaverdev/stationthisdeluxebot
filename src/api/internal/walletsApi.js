const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { PRIORITY } = require('../../core/services/db/utils/queue'); // Import PRIORITY

// This function initializes the routes for the User Wallets API
module.exports = function initializeWalletsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router({ mergeParams: true }); 

  if (!db || !db.userCore) {
    logger.error('[userWalletsApi] Critical dependency failure: db.userCore service is missing!');
    router.use((req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserCore database service is not available for wallets.' } });
    });
    return router;
  }

  logger.info('[userWalletsApi] Initializing User Wallets API routes...');

  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.error(`[userWalletsApi] Invalid or missing masterAccountId (${masterAccountIdStr}) in params.`);
        if (!res.headersSent) {
             res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId parameter.' } });
        }
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  // GET / - List wallets for the user
  router.get('/', async (req, res) => {
        const requestId = uuidv4();
        const masterAccountId = getMasterAccountId(req, res);
        if (!masterAccountId) return;
        const masterAccountIdStr = masterAccountId.toString();

        logger.info(`[userWalletsApi] GET /users/${masterAccountIdStr}/wallets called, requestId: ${requestId}`);

        try {
            const user = await db.userCore.findUserCoreById(masterAccountId);

            if (!user) {
                logger.warn(`[userWalletsApi] GET /wallets: User not found for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
                return res.status(404).json({
                    error: { code: 'USER_NOT_FOUND', message: 'User not found.', details: { masterAccountId: masterAccountIdStr }, requestId },
                });
            }

            const userWallets = (user.wallets && Array.isArray(user.wallets)) ? user.wallets.map(wallet => ({
                address: wallet.address,
                name: wallet.name,
                tag: wallet.tag,
                isPrimary: wallet.isPrimary,
                verified: wallet.verified,
                addedAt: wallet.addedAt ? wallet.addedAt.toISOString() : null,
                updatedAt: wallet.updatedAt ? wallet.updatedAt.toISOString() : null,
            })) : [];

            logger.info(`[userWalletsApi] GET /wallets: Successfully retrieved ${userWallets.length} wallet(s) for masterAccountId ${masterAccountIdStr}. requestId: ${requestId}`);
            res.status(200).json(userWallets);

        } catch (error) {
            logger.error(`[userWalletsApi] GET /wallets: Error retrieving wallets for masterAccountId ${masterAccountIdStr}. Error: ${error.message}. requestId: ${requestId}`, error);
            res.status(500).json({
                error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving wallets.', requestId },
            });
        }
    });

  // POST / - Adds a wallet
  router.post('/', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const walletData = req.body;
    const masterAccountIdStr = masterAccountId.toString(); 

    logger.info(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets called with body: ${JSON.stringify(walletData)}, requestId: ${requestId}`);

    if (!walletData || typeof walletData !== 'object' || Object.keys(walletData).length === 0) {
      logger.warn(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Empty or invalid wallet data payload. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Request body cannot be empty and must be an object containing wallet data.', requestId: requestId },
      });
    }

    if (!walletData.address || typeof walletData.address !== 'string' || walletData.address.trim() === '') {
      logger.warn(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Missing or invalid 'address' in wallet data. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_WALLET_DATA', message: "Missing or invalid 'address' in wallet data. Must be a non-empty string.", details: { field: 'address' }, requestId: requestId },
      });
    }

    try {
      const updatedUser = await db.userCore.addWallet(masterAccountId, walletData);

      if (!updatedUser) {
        logger.warn(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: User not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found with the provided masterAccountId.', details: { masterAccountId: masterAccountIdStr }, requestId: requestId },
        });
      }
      
      const addedWallet = updatedUser.wallets.find(w => w.address === walletData.address);
       // Format wallet data similarly to GET /
      const responseWallet = addedWallet ? {
            address: addedWallet.address,
            name: addedWallet.name,
            tag: addedWallet.tag,
            isPrimary: addedWallet.isPrimary,
            verified: addedWallet.verified,
            addedAt: addedWallet.addedAt ? addedWallet.addedAt.toISOString() : null,
            updatedAt: addedWallet.updatedAt ? addedWallet.updatedAt.toISOString() : null,
         } : null;


      logger.info(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Wallet added successfully. Address: ${walletData.address}, requestId: ${requestId}`);
      res.status(201).json(responseWallet || {}); // Return added wallet or empty obj if not found post-add (shouldn't happen)

    } catch (error) {
      logger.error(`[userWalletsApi] POST /users/${masterAccountIdStr}/wallets: Error adding wallet. Error: ${error.message}. requestId: ${requestId}`, error);
       if (error.message && error.message.includes('Wallet address already exists')) { 
           return res.status(409).json({
               error: { code: 'CONFLICT', message: 'Wallet address already exists for this user.', details: { address: walletData.address }, requestId },
           });
       }
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while adding the wallet.', requestId: requestId },
      });
    }
  });

  // GET /:address - Get a specific wallet by address
  router.get('/:address', async (req, res) => {
        const requestId = uuidv4();
        const masterAccountId = getMasterAccountId(req, res);
        if (!masterAccountId) return;
        const masterAccountIdStr = masterAccountId.toString();
        const { address: walletAddress } = req.params;

        logger.info(`[userWalletsApi] GET /users/${masterAccountIdStr}/wallets/${walletAddress} called, requestId: ${requestId}`);

        if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
            logger.warn(`[userWalletsApi] GET .../wallets/...: Missing or invalid wallet address in path. Address: '${walletAddress}', requestId: ${requestId}`);
            return res.status(400).json({
                error: { code: 'INVALID_WALLET_ADDRESS_PARAM', message: 'Wallet address in path parameter must be a non-empty string.', details: { value: walletAddress }, requestId },
            });
        }

        try {
            // Find the user and project only the matching wallet
             const userWithWallet = await db.userCore.findOne(
                 { _id: masterAccountId, 'wallets.address': walletAddress },
                 { projection: { 'wallets.$': 1 } },
                 PRIORITY.HIGH
             );


            if (!userWithWallet || !userWithWallet.wallets || userWithWallet.wallets.length === 0) {
                logger.warn(`[userWalletsApi] GET .../wallets/${walletAddress}: User or wallet not found. requestId: ${requestId}`);
                return res.status(404).json({
                    error: { code: 'WALLET_NOT_FOUND', message: 'Wallet with the specified address not found for this user.', details: { masterAccountId: masterAccountIdStr, walletAddress }, requestId },
                });
            }

            const wallet = userWithWallet.wallets[0];
             const responseWallet = {
                address: wallet.address,
                name: wallet.name,
                tag: wallet.tag,
                isPrimary: wallet.isPrimary,
                verified: wallet.verified,
                addedAt: wallet.addedAt ? wallet.addedAt.toISOString() : null,
                updatedAt: wallet.updatedAt ? wallet.updatedAt.toISOString() : null,
             };

            logger.info(`[userWalletsApi] GET .../wallets/${walletAddress}: Wallet found. requestId: ${requestId}`);
            res.status(200).json(responseWallet);

        } catch (error) {
            logger.error(`[userWalletsApi] GET .../wallets/${walletAddress}: Error retrieving wallet. Error: ${error.message}. requestId: ${requestId}`, error);
            res.status(500).json({
                error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving the wallet.', requestId },
            });
        }
    });

  // PUT /:address - Updates a specific wallet
  router.put('/:address', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    
    const { address: walletAddressToUpdate } = req.params;
    const updatePayload = req.body;
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userWalletsApi] PUT /users/${masterAccountIdStr}/wallets/${walletAddressToUpdate} called with body: ${JSON.stringify(updatePayload)}, requestId: ${requestId}`);

    if (!walletAddressToUpdate || typeof walletAddressToUpdate !== 'string' || walletAddressToUpdate.trim() === '') {
      return res.status(400).json({
        error: { code: 'INVALID_WALLET_ADDRESS_PARAM', message: 'Wallet address in path parameter must be a non-empty string.', details: { value: walletAddressToUpdate }, requestId },
      });
    }

    if (!updatePayload || typeof updatePayload !== 'object' || Object.keys(updatePayload).length === 0) {
      return res.status(400).json({
        error: { code: 'INVALID_UPDATE_PAYLOAD', message: 'Request body cannot be empty and must be an object containing fields to update.', requestId },
      });
    }

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
      if (typeof updatePayload.name !== 'string') { // Allow empty string
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'name' must be a string.", details: { field: 'name' }, requestId }});
      }
      setOperations['wallets.$[elem].name'] = updatePayload.name.trim(); 
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('tag')) {
       if (typeof updatePayload.tag !== 'string') { // Allow empty string
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'tag' must be a string.", details: { field: 'tag' }, requestId }});
      }
      setOperations['wallets.$[elem].tag'] = updatePayload.tag.trim(); 
      hasValidUpdateField = true;
    }

    if (!hasValidUpdateField) {
      return res.status(400).json({
        error: { code: 'NO_UPDATABLE_FIELDS', message: `Request body must contain at least one updatable field: ${allowedUpdateFields.join(', ')}.`, requestId },
      });
    }
    
    setOperations['wallets.$[elem].updatedAt'] = new Date();

    const updateOptions = {
         arrayFilters: [{ 'elem.address': walletAddressToUpdate }],
    };

    const updateResult = await db.userCore.updateUserCore(
        masterAccountId, 
        { $set: setOperations }, 
        updateOptions
    );

    if (!updateResult || updateResult.matchedCount === 0) {
      logger.warn(`[userWalletsApi] PUT .../wallets/${walletAddressToUpdate}: Wallet not found or update failed. requestId: ${requestId}`);
      return res.status(404).json({
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found for update.', details: { masterAccountId: masterAccountIdStr, walletAddress: walletAddressToUpdate }, requestId },
      });
    }

    // Fetch the updated wallet to return it
    const updatedUserDoc = await db.userCore.findOne(
        { _id: masterAccountId, 'wallets.address': walletAddressToUpdate },
        { projection: { 'wallets.$': 1 } },
        PRIORITY.HIGH
    );

    if (!updatedUserDoc || !updatedUserDoc.wallets || updatedUserDoc.wallets.length === 0) {
       logger.error(`[userWalletsApi] PUT .../wallets/${walletAddressToUpdate}: Failed to fetch updated wallet after successful update. requestId: ${requestId}`);
       return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve wallet data after update.', requestId }});
    }

    const updatedWallet = updatedUserDoc.wallets[0];
     const responseWallet = {
        address: updatedWallet.address,
        name: updatedWallet.name,
        tag: updatedWallet.tag,
        isPrimary: updatedWallet.isPrimary,
        verified: updatedWallet.verified,
        addedAt: updatedWallet.addedAt ? updatedWallet.addedAt.toISOString() : null,
        updatedAt: updatedWallet.updatedAt ? updatedWallet.updatedAt.toISOString() : null,
    };

    res.status(200).json(responseWallet);

  });

  // DELETE /:address - Removes a wallet
  router.delete('/:address', async (req, res) => {
    const requestId = uuidv4();
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;

    const { address: walletAddressToDelete } = req.params;
    const masterAccountIdStr = masterAccountId.toString();

    logger.info(`[userWalletsApi] DELETE /users/${masterAccountIdStr}/wallets/${walletAddressToDelete} called, requestId: ${requestId}`);

    if (!walletAddressToDelete || typeof walletAddressToDelete !== 'string' || walletAddressToDelete.trim() === '') {
      return res.status(400).json({
        error: { code: 'INVALID_WALLET_ADDRESS_PARAM', message: 'Wallet address in path parameter must be a non-empty string.', details: { value: walletAddressToDelete }, requestId },
      });
    }

    try {
      // Pre-check user and wallet
       const initialUser = await db.userCore.findOne(
           { _id: masterAccountId, 'wallets.address': walletAddressToDelete },
           {}, 
           PRIORITY.HIGH
       );

       if (!initialUser) {
            logger.warn(`[userWalletsApi] DELETE .../${walletAddressToDelete}: User or wallet not found. requestId: ${requestId}`);
            return res.status(404).json({
                error: { code: 'WALLET_NOT_FOUND', message: 'Wallet with the specified address not found for this user.', details: { masterAccountId: masterAccountIdStr, walletAddress: walletAddressToDelete }, requestId },
            });
        }


      const updatedUser = await db.userCore.deleteWallet(masterAccountId, walletAddressToDelete);

      if (!updatedUser) {
        // This case implies user existed but deleteWallet failed (e.g. concurrent deletion of user)
        logger.warn(`[userWalletsApi] DELETE .../${walletAddressToDelete}: deleteWallet returned null after successful pre-check. User likely deleted concurrently. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND_DURING_DELETE', message: 'User not found during wallet deletion attempt.', details: { masterAccountId: masterAccountIdStr }, requestId },
        });
      }

      // Verify wallet was actually removed
      const walletStillExists = updatedUser.wallets && updatedUser.wallets.some(w => w.address === walletAddressToDelete);
      if (walletStillExists) {
        logger.error(`[userWalletsApi] DELETE .../${walletAddressToDelete}: Wallet still found after delete operation. Unexpected. requestId: ${requestId}`);
        return res.status(500).json({ error: { code: 'WALLET_DELETION_VERIFICATION_FAILED', message: 'Wallet deletion verification failed.', requestId } });
      }

      logger.info(`[userWalletsApi] DELETE .../${walletAddressToDelete}: Wallet deleted successfully. requestId: ${requestId}`);
      res.status(204).send(); 

    } catch (error) {
      logger.error(`[userWalletsApi] DELETE .../${walletAddressToDelete}: Error deleting wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while deleting the wallet.', requestId },
      });
    }
  });

  // Error handling middleware specific to this router
  router.use((err, req, res, next) => {
    const masterAccountId = req.params.masterAccountId;
    const walletAddress = req.params.address;
    logger.error(`[userWalletsApi] Error in wallet route for user ${masterAccountId}, wallet ${walletAddress || 'N/A'}: ${err.message}`, { 
        stack: err.stack, 
        masterAccountId: masterAccountId, 
        walletAddress: walletAddress,
        requestId: req.id // Assuming a request ID middleware adds req.id
    });
    
    if (res.headersSent) {
      return next(err);
    }

    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred in the wallets API.'
      }
    });
  });

  logger.info('[userWalletsApi] User Wallets API routes initialized.');
  return router;
};
