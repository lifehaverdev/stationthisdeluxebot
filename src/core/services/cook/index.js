const CookJobStore = require('./CookJobStore');
const TraitEngine = require('./TraitEngine');
const CookOrchestratorService = require('./CookOrchestratorService');
const CookProjectionUpdater = require('./CookProjectionUpdater');
const { createLogger } = require('../../../utils/logger');

async function initializeCookServices(logger = console) {
  const log = logger.child ? logger.child({ service: 'Cook' }) : logger;
  try {
    await CookProjectionUpdater.rebuild();
    await CookProjectionUpdater.watch();
    log.info('[CookServices] Projection rebuilt & watcher started');
  } catch (err) {
    log.error('[CookServices] initialization error', err);
  }
}

module.exports = {
  CookJobStore,
  TraitEngine,
  CookOrchestratorService,
  CookProjectionUpdater,
  initializeCookServices,
}; 