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
  // Initialize internal API services. Pass all options down.
  const internalServices = initializeInternalServices(options);
  
  return {
    internal: internalServices
  };
}

module.exports = {
  initializeAPI
};  