/**
 * API Module Index
 * 
 * Initializes and exports all API services, both internal and external
 */

const initializeInternalServices = require('./internal');
const { initializeExternalApi } = require('./external');

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

module.exports = {
  initializeAPI
};  