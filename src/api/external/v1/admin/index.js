const createAdminApi = require('./adminApi');

function initialize(dependencies) {
  const router = require('express').Router();
  router.use('/', createAdminApi(dependencies));
  return router;
}

module.exports = initialize; 