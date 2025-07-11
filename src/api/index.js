/**
 * API Module Index
 * 
 * Initializes and exports all API services, both internal and external
 */

const initializeInternalServices = require('./internal');
const { initializeExternalApi } = require('./external');
const loraApi = require('./internal/loraApi');
const generationApi = require('./internal/generationApi');
const spellsApi = require('./internal/spellsApi');

// External APIs
const externalAuthApi = require('./external/authApi');
const externalUserApi = require('./external/userApi');
const externalToolsApi = require('./external/toolsApi');
const externalGenerationApi = require('./external/generationApi');
const externalStorageApi = require('./external/storageApi');
const externalConnectApi = require('./external/connectApi');
const externalPointsApi = require('./external/pointsApi');
const externalSpellsApi = require('./external/spellsApi');

/**
 * Initialize all API services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized API services
 */
function initializeAPI(options = {}) {
  // Initialize internal API services. Pass all options down.
  const internalServices = initializeInternalServices(options);
  
  // Pass internal services to external API initialization
  const externalApiRouter = initializeExternalApi({
    ...options,
    statusService: internalServices.status
  });
  
  return {
    internal: internalServices,
    external: {
      router: externalApiRouter
    }
  };
}

module.exports = function(dependencies) {
    const { app } = dependencies;
    // External API routes
    app.use('/api/v1/auth', externalAuthApi(dependencies));
    app.use('/api/v1/user', externalUserApi(dependencies));
    app.use('/api/v1/tools', externalToolsApi(dependencies));
    app.use('/api/v1/generation', externalGenerationApi(dependencies));
    app.use('/api/v1/storage', externalStorageApi(dependencies));
    app.use('/api/v1/connect', externalConnectApi(dependencies));
    app.use('/api/v1/points', externalPointsApi(dependencies));
    app.use('/api/v1/spells', externalSpellsApi(dependencies));

    // Internal API routes
    const internalRouter = express.Router();
    internalRouter.use('/users', usersApi(dependencies));
    internalRouter.use('/loras', loraApi(dependencies));
    internalRouter.use('/generations', generationApi(dependencies));
    internalRouter.use('/spells', spellsApi(dependencies));

    app.use('/internal/v1/data', internalRouter);
};  