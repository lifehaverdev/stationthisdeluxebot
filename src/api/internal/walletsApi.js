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

  // NEW ENDPOINT: Find User by Wallet Address
  // This is a top-level route on the main app router, not the user-specific one.
  // We will add it here for co-location of wallet logic but it needs to be mounted differently.
  // Let's adjust the export of this file to handle this.

  const walletsRouter = express.Router();

  // GET /lookup?address=<wallet_address>
  walletsRouter.get('/lookup', async (req, res) => {
    const requestId = uuidv4();
    const { address } = req.query;

    logger.info(`[userWalletsApi] GET /wallets/lookup called with address: ${address}, requestId: ${requestId}`);

    if (!address || typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        logger.warn(`[userWalletsApi] GET /wallets/lookup: Invalid or missing 'address' query parameter. Address: ${address}, requestId: ${requestId}`);
        return res.status(400).json({
            error: { code: 'INVALID_INPUT', message: "Invalid or missing 'address' query parameter. Must be a valid Ethereum address.", details: { address }, requestId },
        });
    }

    try {
        const normalizedAddress = address.toLowerCase();
        // Find a user where the 'wallets' array contains an element with the matching address
        const user = await db.userCore.findOne({ 'wallets.address': normalizedAddress });

        if (!user) {
            logger.warn(`[userWalletsApi] GET /wallets/lookup: No user found for address ${normalizedAddress}. requestId: ${requestId}`);
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'No user found with the specified wallet address.', details: { address: normalizedAddress }, requestId },
            });
        }

        logger.info(`[userWalletsApi] GET /wallets/lookup: Found user for address ${normalizedAddress}. MasterAccountId: ${user._id}. requestId: ${requestId}`);
        res.status(200).json({
            masterAccountId: user._id.toString(),
            // Optionally return other details, but masterAccountId is the key
        });

    } catch (error) {
        logger.error(`[userWalletsApi] GET /wallets/lookup: Error looking up user by wallet. Address: ${address}. Error: ${error.message}. requestId: ${requestId}`, error);
        res.status(500).json({
            error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while looking up user by wallet.', requestId },
        });
    }
  });


  // This router is for user-specific wallet management, e.g., /users/{masterAccountId}/wallets
  const userScopedRouter = express.Router({ mergeParams: true });

  // GET / - List wallets for the user
  userScopedRouter.get('/', async (req, res) => {
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
  userScopedRouter.post('/', async (req, res) => {
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
  userScopedRouter.get('/:address', async (req, res) => {
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
  userScopedRouter.put('/:address', async (req, res) => {
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
        error: {
            code: 'NO_VALID_UPDATE_FIELDS',
            message: `The update payload did not contain any of the allowed fields to update: [${allowedUpdateFields.join(', ')}]`,
            requestId,
        },
      });
    }
    
    // Add the timestamp for the update
    setOperations['wallets.$[elem].updatedAt'] = new Date();

    try {
      if (updatePayload.isPrimary === true) {
        // If setting a wallet to primary, first unset any other primary wallet for this user.
        await db.userCore.updateUserCore(
            masterAccountId,
            { $set: { 'wallets.$[].isPrimary': false } },
            // No array filters here, apply to all wallets for the user
        );
      }

      const updatedUser = await db.userCore.updateUserCore(
          masterAccountId,
          { $set: setOperations },
          { arrayFilters: [{ 'elem.address': walletAddressToUpdate }] }
      );

      if (!updatedUser) {
        return res.status(404).json({
          error: { code: 'USER_OR_WALLET_NOT_FOUND', message: 'User not found, or no wallet matched the specified address for this user.', details: { masterAccountId: masterAccountIdStr, walletAddressToUpdate }, requestId },
        });
      }

      const updatedWallet = updatedUser.wallets.find(w => w.address === walletAddressToUpdate);
      const responseWallet = updatedWallet ? {
            address: updatedWallet.address,
            name: updatedWallet.name,
            tag: updatedWallet.tag,
            isPrimary: updatedWallet.isPrimary,
            verified: updatedWallet.verified,
            addedAt: updatedWallet.addedAt ? updatedWallet.addedAt.toISOString() : null,
            updatedAt: updatedWallet.updatedAt ? updatedWallet.updatedAt.toISOString() : null,
         } : null;

      logger.info(`[userWalletsApi] PUT .../wallets/${walletAddressToUpdate}: Wallet updated successfully. requestId: ${requestId}`);
      res.status(200).json(responseWallet);

    } catch (error) {
      logger.error(`[userWalletsApi] PUT .../wallets/${walletAddressToUpdate}: Error updating wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while updating the wallet.', requestId },
      });
    }
  });

  // DELETE /:address - Deletes a wallet
  userScopedRouter.delete('/:address', async (req, res) => {
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
      const updatedUser = await db.userCore.removeWallet(masterAccountId, walletAddressToDelete);

      if (!updatedUser) {
        return res.status(404).json({
          error: { code: 'USER_OR_WALLET_NOT_FOUND', message: 'User not found, or no wallet matched the specified address to delete.', details: { masterAccountId: masterAccountIdStr, walletAddressToDelete }, requestId },
        });
      }

      logger.info(`[userWalletsApi] DELETE .../wallets/${walletAddressToDelete}: Wallet deleted successfully. requestId: ${requestId}`);
      res.status(204).send(); // 204 No Content is standard for successful deletions

    } catch (error) {
      logger.error(`[userWalletsApi] DELETE .../wallets/${walletAddressToDelete}: Error deleting wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while deleting the wallet.', requestId },
      });
    }
  });

  logger.info('[userWalletsApi] User Wallets API routes configured.');
  
  return {
    walletsRouter, // for /wallets/lookup
    userScopedRouter // for /users/{masterAccountId}/wallets
  };
};
