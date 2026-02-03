/**
 * Internal Admin API
 *
 * Aggregates admin-only API routers for the internal API.
 */

const express = require('express');
const createRevenueAdminApi = require('./revenueApi');

/**
 * Create the admin API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.creditLedgerDb
 * @param {Object} dependencies.x402PaymentLogDb
 * @returns {express.Router}
 */
function createAdminApi(dependencies) {
  const router = express.Router();

  // Mount revenue API at /revenue
  // x402PaymentLogDb comes from dependencies.db.x402PaymentLog (initialized in db/index.js)
  const revenueRouter = createRevenueAdminApi({
    creditLedgerDb: dependencies.db?.creditLedger,
    x402PaymentLogDb: dependencies.db?.x402PaymentLog
  });

  router.use('/revenue', revenueRouter);

  return router;
}

module.exports = { createAdminApi };
