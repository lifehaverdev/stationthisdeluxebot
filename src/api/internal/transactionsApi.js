const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the Transactions API
module.exports = function transactionsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

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

  //-------------------------------------------------------------------------
  // --- API Endpoint Implementations ---
  //-------------------------------------------------------------------------

  // GET /transactions/{transactionId} - Retrieve a specific transaction
  router.get('/:transactionId', validateObjectId('transactionId'), async (req, res, next) => {
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