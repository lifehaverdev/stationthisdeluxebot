const express = require('express');
const crypto = require('crypto');
const { ObjectId, Decimal128 } = require('mongodb');

// Conversion rate: 1 point = $0.00037 USD
const USD_CREDIT_TO_POINTS_RATE = 0.00037;

// Non-terminal task statuses
const LIVE_TASK_STATUSES = ['pending', 'processing', 'running', 'queued', 'waiting']; // Added queued, waiting based on common patterns
const PENDING_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours for pending tasks

/**
 * Creates and configures an Express router for User Status Report API endpoints.
 * @param {Object} dependencies - Dependencies for the service.
 * @param {Object} dependencies.logger - Logger instance.
 * @param {Object} dependencies.db - Database services.
 * @param {Object} dependencies.db.userCore - UserCoreDB service instance.
 * @param {Object} dependencies.db.userEconomy - UserEconomyDB service instance.
 * @param {Object} dependencies.db.generationOutputs - GenerationOutputsDB service instance.
 * @returns {express.Router} Configured Express router.
 */
function createUserStatusReportApiService(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  if (!db || !db.userCore || !db.userEconomy || !db.generationOutputs) {
    logger.error('[userStatusReportApi] Missing one or more required DB services (userCore, userEconomy, generationOutputs). API may not function correctly.');
    router.use((req, res) => {
      res.status(500).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'One or more required database services are not available for status report.',
        },
      });
    });
    return router;
  }

  router.get('/users/:masterAccountId/status-report', async (req, res) => {
    const { masterAccountId } = req.params;
    const requestId = crypto.randomUUID(); // For logging and tracing

    logger.info(`[userStatusReportApi] GET /users/${masterAccountId}/status-report called, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userStatusReportApi] Invalid masterAccountId format: ${masterAccountId}, requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
          requestId,
        },
      });
    }

    try {
      const masterAccountObjId = new ObjectId(masterAccountId);

      // 1. Fetch EXP via User Economy (EXP only, points handled via ledger based on wallet)
      const economyRecord = await db.userEconomy.findByMasterAccountId(masterAccountObjId);
      let points = 0;
      let exp = 0;

      if (economyRecord && economyRecord.exp) {
        if (economyRecord.exp instanceof Decimal128) {
          exp = Math.floor(parseFloat(economyRecord.exp.toString()));
        } else if (typeof economyRecord.exp === 'number') {
          exp = Math.floor(economyRecord.exp);
        } else {
          const parsedExp = parseFloat(economyRecord.exp);
          if (!isNaN(parsedExp)) {
            exp = Math.floor(parsedExp);
          } else {
            logger.warn(`[userStatusReportApi] Non-numeric EXP value found: ${economyRecord.exp} for masterAccountId: ${masterAccountId}, requestId: ${requestId}`);
          }
        }
      }

      // 1b. Fetch Points via CreditLedger using primary wallet (matches UserApi /dashboard)
      const creditLedgerDb = db.creditLedger;
      if (!creditLedgerDb) {
        logger.warn('[userStatusReportApi] creditLedgerDb not available in dependencies – falling back to economy.usdCredit conversion.');
      }

      // 2. Fetch User Core Data (Wallet Address)
      const userCoreRecord = await db.userCore.findUserCoreById(masterAccountObjId);
      let walletAddress = null;
      if (userCoreRecord && userCoreRecord.wallets && Array.isArray(userCoreRecord.wallets)) {
        // Assuming 'isPrimary' or 'active' marks the main wallet. Let's check for 'isPrimary' first, then 'active'.
        // The search results mentioned 'active' in archive and 'isPrimary' in walletsApi.js.
        // Let's prioritize 'isPrimary' as it seems more definitive for a "main" wallet.
        const primaryWallet = userCoreRecord.wallets.find(w => w.isPrimary === true);
        if (primaryWallet) {
          walletAddress = primaryWallet.address;
        } else {
          // Fallback to first 'active' wallet if no 'isPrimary' found
          const activeWallet = userCoreRecord.wallets.find(w => w.active === true);
          if (activeWallet) {
            walletAddress = activeWallet.address;
          } else if (userCoreRecord.wallets.length > 0) {
            // Optional: if no primary/active, consider taking the first one if any logic implies that.
            // For now, strict to primary/active or null if not explicitly set.
            // walletAddress = userCoreRecord.wallets[0].address; // Example if we wanted to take the first one
          }
        }
      } else {
        logger.warn(`[userStatusReportApi] User core record or wallets array not found for masterAccountId: ${masterAccountId}, requestId: ${requestId}`);
      }
      
      // Fetch wallet address (already attempted earlier when userCoreRecord obtained)
      // walletAddress variable already set above.

      if (walletAddress && creditLedgerDb && typeof creditLedgerDb.sumPointsRemainingForWalletAddress === 'function') {
        try {
          const ledgerPoints = await creditLedgerDb.sumPointsRemainingForWalletAddress(walletAddress);
          if (typeof ledgerPoints === 'number' && !isNaN(ledgerPoints)) {
            points = ledgerPoints;
          } else {
            logger.warn(`[userStatusReportApi] Ledger points for wallet ${walletAddress} returned non-numeric value: ${ledgerPoints}. Using fallback. requestId: ${requestId}`);
          }
        } catch (ledgerErr) {
          logger.error(`[userStatusReportApi] Error fetching points from creditLedgerDb for wallet ${walletAddress}: ${ledgerErr.message}. Falling back. requestId: ${requestId}`);
        }
      }

      // Fallback: Legacy USD credit conversion if points still zero
      if (points === 0 && economyRecord && economyRecord.usdCredit) {
        const usdCreditAsNumber = parseFloat(economyRecord.usdCredit.toString());
        if (!isNaN(usdCreditAsNumber)) {
          points = Math.floor(usdCreditAsNumber / USD_CREDIT_TO_POINTS_RATE);
        }
      }

      // 3. Fetch Live Generation Tasks
      let liveTasks = [];
      try {
        const generationRecords = await db.generationOutputs.findGenerationsByMasterAccount(masterAccountObjId);
        if (generationRecords && generationRecords.length > 0) {
          liveTasks = generationRecords
            .filter(task => {
              const taskStatusLower = task.status ? task.status.toLowerCase() : '';
              const isPotentiallyLive = LIVE_TASK_STATUSES.includes(taskStatusLower);

              if (!isPotentiallyLive) return false;

              if (taskStatusLower === 'pending') {
                let taskTimestamp = task.requestTimestamp;
                if (!(taskTimestamp instanceof Date)) {
                  taskTimestamp = new Date(taskTimestamp); 
                }
                if (isNaN(taskTimestamp.getTime())) {
                  logger.warn(`[userStatusReportApi] Task ${task._id} has invalid requestTimestamp: ${task.requestTimestamp}. Including in pending list by default. requestId: ${requestId}`);
                  return true; // Default to including if timestamp is bad, or could choose to exclude
                }
                return (Date.now() - taskTimestamp.getTime()) < PENDING_TASK_MAX_AGE_MS;
              }
              return true; // For other live statuses (processing, running, etc.)
            })
            .map(task => {
              const idHash = crypto.createHash('sha256').update(task._id.toString()).digest('hex').substring(0, 5);
              const progress = (task.metadata && typeof task.metadata.progressPercent === 'number') ? task.metadata.progressPercent : null;
              
              // Ensure costUsd is a number, converting from Decimal128 if necessary
              let costUsd = task.costUsd;
              if (costUsd instanceof Decimal128) {
                costUsd = parseFloat(costUsd.toString());
              } else if (typeof costUsd !== 'number') {
                costUsd = null; // Or some default like 0
              }

              return {
                idHash,
                status: task.status,
                costUsd: costUsd,
                progress,
                sourcePlatform: task.notificationPlatform || task.sourcePlatform || null,
                updatedAt: task.updatedAt || task.responseTimestamp || task.requestTimestamp || null,
                startedAt: task.requestTimestamp || null,
                toolId: task.toolId || null,
              };
            });
        }
      } catch (taskError) {
        logger.error(`[userStatusReportApi] Error fetching or processing generation tasks for masterAccountId: ${masterAccountId}. Error: ${taskError.message}, requestId: ${requestId}`, taskError);
        // As per requirements, return [] for liveTasks on error or if none active
        liveTasks = [];
      }
      
      const statusReport = {
        points,
        exp,
        walletAddress,
        liveTasks,
      };

      logger.info(`[userStatusReportApi] Successfully generated status report for masterAccountId: ${masterAccountId}, requestId: ${requestId}`);
      res.status(200).json(statusReport);

    } catch (error) {
      logger.error(`[userStatusReportApi] Failed to generate status report for masterAccountId: ${masterAccountId}. Error: ${error.message}, requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while generating the status report.',
          requestId,
        },
      });
    }
  });

  return router;
}

module.exports = createUserStatusReportApiService; 