const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the Transactions API
module.exports = function transactionsApi(dependencies) {
  const { logger, db } = dependencies;
  // Use mergeParams to access masterAccountId from parent routers
  const router = express.Router({ mergeParams: true });

  // Check for essential dependencies
  if (!db || !db.transactions) {
    logger.error('[transactionsApi] Critical dependency failure: db.transactions service is missing!');
    // Return a router that always responds with an error
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Transactions database service is not available.' } });
    };
  }

  logger.info('[transactionsApi] Initializing Transactions API routes...');

  // Middleware for validating ObjectId in path parameters
  const validateObjectId = (paramName) => (req, res, next) => {
    const id = req.params[paramName];
    if (!ObjectId.isValid(id)) {
      logger.warn(`[transactionsApi] Invalid ObjectId format for param '${paramName}': ${id}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: `Invalid format for ${paramName}. Must be a valid ObjectId.` }
      });
    }
    // Store the validated ObjectId in request locals for the handler to use
    if (!req.locals) req.locals = {};
    req.locals[paramName] = new ObjectId(id);
    next();
  };

  // Helper to safely get masterAccountId from merged params
  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.warn(`[transactionsApi] Invalid or missing masterAccountId (${masterAccountIdStr}) in params.`);
        if (res && !res.headersSent) {
             res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId parameter.' } });
        }
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  //-------------------------------------------------------------------------
  // --- API Endpoint Implementations ---
  //-------------------------------------------------------------------------

  // GET / - List transactions for a user (mounted under /users/:masterAccountId/transactions)
  router.get('/', async (req, res) => {
    const masterAccountId = getMasterAccountId(req, res);
    // This route is only for user-specific listing. If no masterAccountId, it's a bad request.
    if (!masterAccountId) return;

    logger.info(`[transactionsApi] GET / (user list) for masterAccountId ${masterAccountId.toString()} with query:`, req.query);
    
    const { startDate, endDate, transactionType, limit, offset } = req.query;

    try {
      // 1. Build Filter
      const filter = { masterAccountId };
      
      if (transactionType) {
        filter.type = transactionType;
      }

      const timestampFilter = {};
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Invalid startDate format: ${startDate}` } });
        }
        timestampFilter.$gte = parsedStartDate;
      }
      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Invalid endDate format: ${endDate}` } });
        }
        timestampFilter.$lte = parsedEndDate;
      }

      if (Object.keys(timestampFilter).length > 0) {
        filter.timestamp = timestampFilter;
      }

      // 2. Build Options
      const options = {
        sort: { timestamp: -1 } // Default sort
      };

      if (limit) {
        const parsedLimit = parseInt(limit, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          options.limit = parsedLimit;
        }
      }

      if (offset) {
        const parsedOffset = parseInt(offset, 10);
        if (!isNaN(parsedOffset) && parsedOffset >= 0) {
          options.skip = parsedOffset;
        }
      }

      logger.debug(`[transactionsApi] Querying transactions with filter and options`, { filter, options });
      
      // Using findMany which is available in BaseDB and thus in transactionsDb
      const transactions = await db.transactions.findMany(filter, options);
      
      const formattedTransactions = transactions.map(tx => ({
        _id: tx._id,
        transactionType: tx.type,
        amountUsd: tx.amountUsd.toString(),
        createdAt: tx.timestamp,
        source: tx.description, // Mapping description to source as requested
        relatedItems: tx.relatedItems,
        externalTransactionId: tx.externalTransactionId,
        balanceBeforeUsd: tx.balanceBeforeUsd.toString(),
        balanceAfterUsd: tx.balanceAfterUsd.toString(),
      }));

      res.status(200).json(formattedTransactions);

    } catch (error) {
      logger.error(`[transactionsApi] Error fetching transactions for ${masterAccountId.toString()}:`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while retrieving transactions.' }
      });
    }
  });

  // GET /:transactionId - Retrieve a specific transaction (mounted under /transactions/:transactionId)
  router.get('/:transactionId', validateObjectId('transactionId'), async (req, res, next) => {
    // If masterAccountId is present, this request came via the user-scoped route. We can ignore it.
    // If not, it came via the top-level /transactions route.
    const { masterAccountId } = req.params;
    if (masterAccountId) {
      // This logic prevents /users/{id}/transactions/{id} from being misinterpreted by this handler.
      // A more robust solution might use separate routers if complexity grows.
      return next();
    }

    const { transactionId } = req.locals; // Get the validated ObjectId
    logger.info(`[transactionsApi] GET /transactions/${transactionId} - Received request`);

    try {
      // Use the findTransactionById method from transactionsDb service
      // Note: This method already accepts an optional session, but we don't need one for a simple find.
      const transaction = await db.transactions.findTransactionById(transactionId);

      if (!transaction) {
        logger.warn(`[transactionsApi] GET /transactions/${transactionId}: Transaction not found.`);
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Transaction not found.', details: { transactionId: transactionId.toString() } }
        });
      }

      logger.info(`[transactionsApi] GET /transactions/${transactionId}: Transaction found.`);
      res.status(200).json(transaction); // ADR: Response: TransactionObject

    } catch (error) {
      logger.error(`[transactionsApi] GET /transactions/${transactionId}: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving the transaction.' }
      });
    }
  });

  // Other transaction-specific endpoints (if any) would go here.

  logger.info('[transactionsApi] Transactions API routes initialized.');
  return router;
}; 