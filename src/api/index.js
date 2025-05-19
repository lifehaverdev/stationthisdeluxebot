/**
 * API Module Index
 * 
 * Initializes and exports all API services, both internal and external
 */

const initializeInternalServices = require('./internal');

/**
 * Initialize all API services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized API services
 */
function initializeAPI(options = {}) {
  const { 
    logger = console,
    appStartTime = new Date(),
    version = process.env.APP_VERSION || '1.0.0'
  } = options;
  
  // Initialize internal API services
  const internalServices = initializeInternalServices({
    logger,
    appStartTime,
    version,
    db: options.db
  });
  
  return {
    internal: internalServices
  };
}

module.exports = {
  initializeAPI
}; 