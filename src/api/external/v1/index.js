const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { authenticateUserOrApiKey } = require('../../../platforms/web/middleware/auth');

const apiModules = {
  admin: { path: './admin', auth: 'apiKey' },
  auth: { path: './auth', auth: 'none' },
  economy: { path: './economy', auth: 'userOrApiKey' },
  generations: { path: './generations', auth: 'apiKey' },
  spells: { path: './spells', auth: 'flexible' },
  storage: { path: './storage', auth: 'none' },
  system: { path: './system', auth: 'none' },
  tools: { path: './tools', auth: 'none' },
  users: { path: './users', auth: 'userOrApiKey' },
  webhooks: { path: './webhooks', auth: 'none' },
  datasets: { path: '../datasetsApi', auth: 'userOrApiKey' },
};

function initializeV1Api(dependencies) {
  const router = express.Router();
  const logger = createLogger('ExternalV1API');

  const authMiddleware = {
    apiKey: async (req, res, next) => { /* ... API key auth logic ... */ },
    userOrApiKey: authenticateUserOrApiKey,
    flexible: async (req, res, next) => { /* ... flexible auth logic ... */ },
  };

  for (const [name, module] of Object.entries(apiModules)) {
    const api = require(module.path);
    const middleware = authMiddleware[module.auth] || ((req, res, next) => next());
    
    if(module.auth === 'flexible') {
      router.use(`/${name}`, api(dependencies, authMiddleware));
    } else {
      router.use(`/${name}`, middleware, api(dependencies));
    }
    
    logger.info(`External ${name} API router mounted at /${name}. (Auth: ${module.auth})`);
  }

  return router;
}

module.exports = { initializeV1Api }; 