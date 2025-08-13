const CookJobStore = require('./CookJobStore');
const TraitEngine = require('./TraitEngine');
const CookOrchestratorService = require('./CookOrchestratorService');
const CookProjectionUpdater = require('./CookProjectionUpdater');
const { createLogger } = require('../../../utils/logger');
const CookEmbeddedWorker = require('./CookEmbeddedWorker');

// Local toggle: auto-start in-process embedded worker once (single-process dev)
const EMBEDDED_WORKER_AUTO_START = true;

async function initializeCookServices(logger = console) {
  const log = logger.child ? logger.child({ service: 'Cook' }) : logger;
  try {
    await CookProjectionUpdater.rebuild();
    await CookProjectionUpdater.watch();
    log.info('[CookServices] Projection rebuilt & watcher started');

    // In dev/single-process environments, optionally start the embedded worker once
    if (EMBEDDED_WORKER_AUTO_START) {
      try {
        await CookEmbeddedWorker.ensure();
        log.info('[CookServices] Embedded worker auto-started');
      } catch (e) {
        log.warn('[CookServices] Embedded worker start failed', e);
      }
    }
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