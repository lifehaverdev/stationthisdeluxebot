const express = require('express');
const crypto = require('crypto');
const { ObjectId, Decimal128 } = require('mongodb');

// Conversion rate: 1 point = $0.00037 USD
const USD_CREDIT_TO_POINTS_RATE = 0.00037;

// Non-terminal task statuses
const LIVE_TASK_STATUSES = ['pending', 'processing', 'running', 'queued', 'waiting']; // Added queued, waiting based on common patterns

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

      // 1. Fetch User Economy Data (Points & EXP)
      const economyRecord = await db.userEconomy.findByMasterAccountId(masterAccountObjId);
      let points = 0;
      let exp = 0;
      if (economyRecord && economyRecord.usdCredit) {
        // Convert usdCredit (Decimal128) to number before calculation
        const usdCreditAsNumber = parseFloat(economyRecord.usdCredit.toString());
        points = Math.floor(usdCreditAsNumber / USD_CREDIT_TO_POINTS_RATE);
        exp = economyRecord.exp || 0; // Assuming exp is a direct number field
      } else {
        logger.warn(`[userStatusReportApi] Economy record not found or usdCredit missing for masterAccountId: ${masterAccountId}, requestId: ${requestId}`);
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
      

      // 3. Fetch Live Generation Tasks
      let liveTasks = [];
      try {
        const generationRecords = await db.generationOutputs.findGenerationsByMasterAccount(masterAccountObjId);
        if (generationRecords && generationRecords.length > 0) {
          liveTasks = generationRecords
            .filter(task => LIVE_TASK_STATUSES.includes(task.status ? task.status.toLowerCase() : ''))
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