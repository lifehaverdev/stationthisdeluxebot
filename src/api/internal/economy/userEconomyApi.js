const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ObjectId, Decimal128 } = require('mongodb');
const { getCachedClient } = require('../../../core/services/db/utils/queue'); // path adjusted

// This function initializes the routes for the User Economy API
module.exports = function initializeUserEconomyApi(dependencies) {
  const { logger, db } = dependencies;
  // Use mergeParams to access masterAccountId from the parent router (userCoreApi)
  const router = express.Router({ mergeParams: true }); 

  // Check for essential dependencies
  if (!db || !db.userEconomy || !db.transactions) {
    logger.error('[userEconomyApi] Critical dependency failure: db.userEconomy or db.transactions service is missing!');
    router.use((req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Required database services for economy are not available.' } });
    });
    return router;
  }

  logger.info('[userEconomyApi] Initializing User Economy API routes...');

  // Helper function to get masterAccountId ObjectId from params
  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.error(`[userEconomyApi] Invalid or missing masterAccountId (${masterAccountIdStr}) in params.`);
        if (!res.headersSent) {
             res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId parameter.' } });
        }
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  //-------------------------------------------------------------------------
  // --- Economy Endpoints --- 
  // Mounted at /users/:masterAccountId/economy
  //-------------------------------------------------------------------------

  // GET / - Retrieves user economy record
  router.get('/', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString();
    const requestId = uuidv4();

    logger.info(`[userEconomyApi] GET /users/${masterAccountIdStr}/economy - RequestId: ${requestId}`);

    try {
      const economyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId);

      if (!economyRecord) {
        logger.warn(`[userEconomyApi] GET /economy: Economy record not found for ${masterAccountIdStr}. RequestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'ECONOMY_RECORD_NOT_FOUND',
            message: 'User economy record not found.',
            details: { masterAccountId: masterAccountIdStr },
            requestId
          },
        });
      }

      logger.info(`[userEconomyApi] GET /economy: Record found for ${masterAccountIdStr}. RequestId: ${requestId}`);
      res.status(200).json(economyRecord);

    } catch (error) {
      logger.error(`[userEconomyApi] GET /economy: Error for ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while retrieving the user economy record.',
          requestId
        },
      });
    }
  });

  // POST /credit - Adds credit to user account
  router.post('/credit', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString();

    const { amountUsd, description, transactionType, relatedItems, externalTransactionId } = req.body;
    const requestId = uuidv4();

    logger.info(`[userEconomyApi] POST /users/${masterAccountIdStr}/economy/credit - RequestId: ${requestId}`, { body: req.body });

    if (amountUsd === undefined || amountUsd === null) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required field: amountUsd.', details: { field: 'amountUsd' }, requestId } });
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: description (must be non-empty string).', details: { field: 'description' }, requestId } });
    }
    if (!transactionType || typeof transactionType !== 'string' || transactionType.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: transactionType (must be non-empty string).', details: { field: 'transactionType' }, requestId } });
    }

    let amountUsdDecimal;
    try {
      amountUsdDecimal = Decimal128.fromString(amountUsd.toString());
      if (parseFloat(amountUsdDecimal.toString()) <= 0) { 
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd: must be a positive value for credit operations.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
      }
    } catch (e) {
      logger.warn(`[userEconomyApi] POST /credit: Invalid amountUsd format. Value: ${amountUsd}. RequestId: ${requestId}`, e);
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd format: must be a valid number or numeric string.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
    }

    let client;
    let session;
    let createdTransaction = null;
    let finalEconomyRecord = null;

    try {
      client = await getCachedClient();
      session = client.startSession();
      logger.info(`[userEconomyApi] POST /credit: Starting transaction. RequestId: ${requestId}`);

      await session.withTransaction(async (sess) => {
        let currentEconomy = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        let balanceBeforeUsd;

        if (!currentEconomy) {
          logger.info(`[userEconomyApi] POST /credit: Creating initial economy record for ${masterAccountIdStr}. RequestId: ${requestId}`);
          currentEconomy = await db.userEconomy.createUserEconomyRecord(masterAccountId, '0', 0, sess);
          if (!currentEconomy) throw new Error('Failed to create initial economy record.');
          balanceBeforeUsd = Decimal128.fromString('0'); 
        } else {
          balanceBeforeUsd = currentEconomy.usdCredit;
        }

        const updateResult = await db.userEconomy.updateUsdCredit(masterAccountId, amountUsdDecimal.toString(), sess);
        if (!updateResult || updateResult.matchedCount === 0) throw new Error('Failed to match user economy record for credit update.');
        if (updateResult.modifiedCount === 0) logger.warn(`[userEconomyApi] POST /credit: Matched but not modified during credit update. RequestId: ${requestId}`);
        
        const balanceAfterUsd = Decimal128.fromString((parseFloat(balanceBeforeUsd.toString()) + parseFloat(amountUsdDecimal.toString())).toString());

        const txData = {
          masterAccountId,
          type: transactionType.trim(),
          description: description.trim(),
          amountUsd: amountUsdDecimal,
          balanceBeforeUsd: balanceBeforeUsd,
          balanceAfterUsd: balanceAfterUsd,
          ...(relatedItems && { relatedItems }),
          ...(externalTransactionId && { externalTransactionId })
        };

        createdTransaction = await db.transactions.logTransaction(txData, sess);
        if (!createdTransaction) throw new Error('Failed to log transaction.');

        // Add detailed logging before the final fetch
        logger.info(`[userEconomyApi] POST /credit: Transaction components completed. Attempting final fetch. TxId: ${createdTransaction._id}, SessionId: ${sess.id?.id?.toString('hex')}, InTransaction: ${sess.inTransaction()}`);

        finalEconomyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId, {}, sess); // Explicitly pass empty options {} here too
        if (!finalEconomyRecord) {
             logger.error(`[userEconomyApi] POST /credit: findByMasterAccountId returned null/undefined inside transaction! SessionId: ${sess.id?.id?.toString('hex')}, InTransaction: ${sess.inTransaction()}`);
             throw new Error('Failed to fetch final economy record.');
        }

        logger.info(`[userEconomyApi] POST /credit: Transaction successful. TxId: ${createdTransaction._id}. RequestId: ${requestId}`);
      });

      res.status(200).json({ updatedEconomy: finalEconomyRecord, transaction: createdTransaction });

    } catch (error) {
      logger.error(`[userEconomyApi] POST /credit: Transaction failed for ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      if (error.message.includes('Failed to')) {
           res.status(500).json({ error: { code: 'TRANSACTION_LOGIC_ERROR', message: `Internal error during transaction: ${error.message}`, requestId } });
      } else if (error.hasOwnProperty('errorLabels') && error.errorLabels.includes('TransientTransactionError')) {
          logger.warn(`[userEconomyApi] POST /credit: Transient transaction error for ${masterAccountIdStr}. RequestId: ${requestId}`);
          res.status(503).json({ error: { code: 'TRANSIENT_TRANSACTION_ERROR', message: 'Database conflict, please retry.', requestId } });
      } else {
          res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'Unexpected error during credit operation.', requestId } });
      }
    } finally {
        if (session) await session.endSession();
    }
  });

  // POST /debit - Debits user account
  router.post('/debit', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString();

    const { amountUsd, description, transactionType, relatedItems } = req.body;
    const requestId = uuidv4();

    logger.info(`[userEconomyApi] POST /users/${masterAccountIdStr}/economy/debit - RequestId: ${requestId}`, { body: req.body });

    if (amountUsd === undefined || amountUsd === null) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required field: amountUsd.', details: { field: 'amountUsd' }, requestId } });
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: description.', details: { field: 'description' }, requestId } });
    }
    if (!transactionType || typeof transactionType !== 'string' || transactionType.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: transactionType.', details: { field: 'transactionType' }, requestId } });
    }

    let amountUsdDecimal;
    try {
      amountUsdDecimal = Decimal128.fromString(amountUsd.toString());
      if (parseFloat(amountUsdDecimal.toString()) <= 0) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd: must be positive for debit.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
      }
    } catch (e) {
      logger.warn(`[userEconomyApi] POST /debit: Invalid amountUsd format. Value: ${amountUsd}. RequestId: ${requestId}`, e);
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd format.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
    }

    let client;
    let session;
    let createdTransaction = null;
    let finalEconomyRecord = null;

    try {
      client = await getCachedClient();
      session = client.startSession();
      logger.info(`[userEconomyApi] POST /debit: Starting transaction. RequestId: ${requestId}`);

      await session.withTransaction(async (sess) => {
        const currentEconomy = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        let balanceBeforeUsd = currentEconomy?.usdCredit || Decimal128.fromString('0'); 
        
        const balanceBeforeFloat = parseFloat(balanceBeforeUsd.toString());
        const amountToDebitFloat = parseFloat(amountUsdDecimal.toString());

        if (balanceBeforeFloat < amountToDebitFloat) {
          logger.warn(`[userEconomyApi] POST /debit: Insufficient funds for ${masterAccountIdStr}. Bal: ${balanceBeforeFloat}, Amt: ${amountToDebitFloat}. RequestId: ${requestId}`);
          const insufficientFundsError = new Error('Insufficient funds.');
          insufficientFundsError.code = 'INSUFFICIENT_FUNDS';
          insufficientFundsError.details = { currentBalance: balanceBeforeFloat.toFixed(2), debitAmount: amountToDebitFloat.toFixed(2) };
          throw insufficientFundsError; 
        }

        const negativeAmountStr = (-amountToDebitFloat).toString();
        const updateResult = await db.userEconomy.updateUsdCredit(masterAccountId, negativeAmountStr, sess);
        if (!updateResult || updateResult.matchedCount === 0) throw new Error('Failed to match user economy record for debit update.');
        if (updateResult.modifiedCount === 0) logger.warn(`[userEconomyApi] POST /debit: Matched but not modified during debit update. RequestId: ${requestId}`);

        const balanceAfterUsd = Decimal128.fromString((balanceBeforeFloat - amountToDebitFloat).toString());

        const txData = {
          masterAccountId,
          type: transactionType.trim(),
          description: description.trim(),
          amountUsd: amountUsdDecimal,
          balanceBeforeUsd: balanceBeforeUsd,
          balanceAfterUsd: balanceAfterUsd,
          ...(relatedItems && { relatedItems })
        };

        createdTransaction = await db.transactions.logTransaction(txData, sess);
        if (!createdTransaction) throw new Error('Failed to log transaction.');

        finalEconomyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        if (!finalEconomyRecord) throw new Error('Failed to fetch final economy record.');

        logger.info(`[userEconomyApi] POST /debit: Transaction successful. TxId: ${createdTransaction._id}. RequestId: ${requestId}`);
      });

      res.status(200).json({ updatedEconomy: finalEconomyRecord, transaction: createdTransaction });

    } catch (error) {
      logger.error(`[userEconomyApi] POST /debit: Transaction failed for ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      if (error.code === 'INSUFFICIENT_FUNDS') {
           res.status(400).json({ error: { code: 'INSUFFICIENT_FUNDS', message: error.message, details: error.details, requestId } });
      } else if (error.message.includes('Failed to')) {
           res.status(500).json({ error: { code: 'TRANSACTION_LOGIC_ERROR', message: `Internal error during transaction: ${error.message}`, requestId } });
      } else if (error.hasOwnProperty('errorLabels') && error.errorLabels.includes('TransientTransactionError')) {
           logger.warn(`[userEconomyApi] POST /debit: Transient transaction error for ${masterAccountIdStr}. RequestId: ${requestId}`);
           res.status(503).json({ error: { code: 'TRANSIENT_TRANSACTION_ERROR', message: 'Database conflict, please retry.', requestId } });
      } else {
           res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'Unexpected error during debit operation.', requestId } });
      }
    } finally {
      if (session) await session.endSession();
    }
  });

  // PUT /exp - Updates experience points
  router.put('/exp', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString();

    const { expChange, description } = req.body;
    const requestId = uuidv4();

    logger.info(`[userEconomyApi] PUT /users/${masterAccountIdStr}/economy/exp - RequestId: ${requestId}`, { body: req.body });

    if (expChange === undefined || expChange === null) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required field: expChange.', details: { field: 'expChange' }, requestId } });
    }
    
    let expChangeInt;
    try {
      if (!Number.isInteger(Number(expChange))) throw new Error('expChange must be an integer.');
      expChangeInt = parseInt(expChange, 10);
    } catch (e) {
      logger.warn(`[userEconomyApi] PUT /exp: Invalid expChange format. Value: ${expChange}. RequestId: ${requestId}`, e);
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid expChange format: must be integer.', details: { field: 'expChange', value: expChange }, requestId } });
    }

    try {
      const updateResult = await db.userEconomy.updateExperience(masterAccountId, expChangeInt);

      if (!updateResult || updateResult.matchedCount === 0) {
        logger.warn(`[userEconomyApi] PUT /exp: Economy record not found for ${masterAccountIdStr}. RequestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'ECONOMY_RECORD_NOT_FOUND', message: 'User economy record not found.', details: { masterAccountId: masterAccountIdStr }, requestId }
        });
      }

      if (updateResult.modifiedCount === 0) {
          logger.warn(`[userEconomyApi] PUT /exp: Matched but not modified during EXP update. expChange was ${expChangeInt}. RequestId: ${requestId}`);
      }

      const updatedEconomyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId);
      if (!updatedEconomyRecord) {
          logger.error(`[userEconomyApi] PUT /exp: Failed to fetch economy record post-update for ${masterAccountIdStr}. RequestId: ${requestId}`);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve economy record after update.', requestId } });
      }

      logger.info(`[userEconomyApi] PUT /exp: EXP updated for ${masterAccountIdStr}. New EXP: ${updatedEconomyRecord.exp}. RequestId: ${requestId}`);
      res.status(200).json(updatedEconomyRecord);

    } catch (error) {
      logger.error(`[userEconomyApi] PUT /exp: Error processing EXP update for ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'Unexpected error during EXP update.', requestId } });
    }
  });

  // POST /spend - Deducts points from a user's active deposits in priority order
  router.post('/spend', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString();

    const { pointsToSpend, spendContext, walletAddress } = req.body;
    const requestId = uuidv4();

    logger.info(`[userEconomyApi] POST /users/${masterAccountIdStr}/economy/spend - RequestId: ${requestId}`, { body: req.body });

    if (!Number.isInteger(pointsToSpend) || pointsToSpend <= 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'pointsToSpend must be a positive integer.', requestId } });
    }

    let activeDeposits;
    let spendTarget = 'masterAccountId';
    try {
      // 1. Try by masterAccountId
      activeDeposits = await db.creditLedger.findActiveDepositsForUser(masterAccountId);

      // 2. If none, try by wallet address (from userCore)
      if (!activeDeposits || activeDeposits.length === 0) {
        logger.info(`[userEconomyApi] /spend: No deposits for masterAccountId, attempting wallet fallback.`);
        const userCore = await db.userCore.findUserCoreById(masterAccountId);
        let primaryWallet = null;
        if (userCore && Array.isArray(userCore.wallets)) {
          primaryWallet = userCore.wallets.find(w => w.isPrimary) || userCore.wallets[0];
        }
        if (primaryWallet && primaryWallet.address) {
          logger.info(`[userEconomyApi] /spend: Fallback to wallet-based spend for address ${primaryWallet.address}`);
          activeDeposits = await db.creditLedger.findActiveDepositsForWalletAddress(primaryWallet.address);
          spendTarget = 'walletAddress';
        }
      }

      if (!activeDeposits || activeDeposits.length === 0) {
        return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'User has no active deposits with points remaining.', requestId } });
      }

      // 2. Check if the user has enough total points across all deposits
      const totalPointsRemaining = activeDeposits.reduce((sum, deposit) => sum + (deposit.points_remaining || 0), 0);
      if (totalPointsRemaining < pointsToSpend) {
        return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: `User has insufficient points. Required: ${pointsToSpend}, Available: ${totalPointsRemaining}.`, requestId } });
      }

      // 3. Iterate through sorted deposits and deduct points
      let pointsLeftToDeduct = pointsToSpend;
      const spendSummary = [];

      for (const deposit of activeDeposits) {
        if (pointsLeftToDeduct <= 0) break;

        const pointsBefore = deposit.points_remaining;
        const pointsToDeductFromThisDeposit = Math.min(pointsLeftToDeduct, pointsBefore);

        await db.creditLedger.deductPointsFromDeposit(deposit._id, pointsToDeductFromThisDeposit);

        const deductionRecord = {
          depositId: deposit._id.toString(),
          tokenAddress: deposit.token_address,
          fundingRate: deposit.funding_rate_applied,
          pointsBefore: pointsBefore,
          pointsDeducted: pointsToDeductFromThisDeposit,
          pointsAfter: pointsBefore - pointsToDeductFromThisDeposit,
        };
        spendSummary.push(deductionRecord);

        pointsLeftToDeduct -= pointsToDeductFromThisDeposit;
      }
      
      logger.info(`[userEconomyApi] SPEND_LOG: User ${masterAccountIdStr} spent ${pointsToSpend} points. RequestId: ${requestId} (target: ${spendTarget})`, {
        totalPointsSpent: pointsToSpend,
        spendBreakdown: spendSummary,
        context: spendContext || 'N/A'
      });
      
      res.status(200).json({
        message: `Successfully deducted ${pointsToSpend} points.`,
        totalPointsSpent: pointsToSpend,
        breakdown: spendSummary,
        requestId,
      });

    } catch (error) {
      logger.error(`[userEconomyApi] POST /spend: Error during point deduction for ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during the spend operation.', requestId } });
    }
  });

  // POST /credit-points - Creates a new credit_ledger entry for rewards.
  router.post('/credit-points', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    if (!masterAccountId) return;
    const masterAccountIdStr = masterAccountId.toString();

    const { points, description, rewardType, relatedItems } = req.body;
    const requestId = uuidv4();

    logger.info(`[userEconomyApi] POST /users/${masterAccountIdStr}/economy/credit-points - RequestId: ${requestId}`, { body: req.body });

    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'points must be a positive integer.', requestId } });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'description must be a non-empty string.', requestId } });
    }
     if (!rewardType || typeof rewardType !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'rewardType must be a non-empty string.', requestId } });
    }

    try {
      const rewardDetails = {
        masterAccountId,
        points,
        rewardType,
        description,
        relatedItems
      };
      
      const result = await db.creditLedger.createRewardCreditEntry(rewardDetails);
      if (!result.insertedId) {
        throw new Error('Database operation failed to create reward entry.');
      }

      logger.info(`[userEconomyApi] Successfully created reward credit entry for ${masterAccountIdStr}. RequestId: ${requestId}`);
      res.status(201).json({ success: true, entryId: result.insertedId, requestId });

    } catch (error) {
      logger.error(`[userEconomyApi] POST /credit-points: Error for ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while crediting points.', requestId } });
    }
  });

  // Error handling middleware specific to this router
  router.use((err, req, res, next) => {
    const masterAccountId = req.params.masterAccountId;
    logger.error(`[userEconomyApi] Error in economy route for user ${masterAccountId}: ${err.message}`, { 
        stack: err.stack, 
        masterAccountId,
        requestId: req.id 
    });
    
    if (res.headersSent) {
      return next(err);
    }

    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred in the economy API.'
      }
    });
  });

  logger.info('[userEconomyApi] User Economy API routes initialized.');
  return router;
}; 