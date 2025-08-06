const express = require('express');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('SystemApi');

/**
 * Creates a router for system-level information and actions.
 * @param {object} dependencies - Service dependencies.
 * @returns {express.Router}
 */
function createSystemApi(dependencies) {
  const router = express.Router();

  // Example endpoint
  router.get('/status', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'system-api' });
  });

  return router;
}

module.exports = { createSystemApi }; 