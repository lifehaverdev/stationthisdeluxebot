// ✅ DEPRECATED COMPONENTS REMOVED:
// - CookJobStore (deprecated - replaced by CookOrchestratorService in-memory state)
// - CookEmbeddedWorker (deprecated - auto-start disabled, no longer needed)

const TraitEngine = require('./TraitEngine');
const CookOrchestratorService = require('./CookOrchestratorService');
const CookProjectionUpdater = require('./CookProjectionUpdater');
const CollectionExportService = require('./CollectionExportService');
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
  TraitEngine,
  CookOrchestratorService,
  CookProjectionUpdater,
  CollectionExportService,
  initializeCookServices,
}; 
