/**
 * Internal API Services
 * 
 * Exports all internal API services for use within the application
 */

const createStatusService = require('./status');

/**
 * Initialize and export all internal API services
 * @param {Object} dependencies - Shared dependencies for services
 * @returns {Object} - Object containing all initialized services
 */
function initializeInternalServices(dependencies = {}) {
  // Common dependencies available to all services
  const commonDependencies = {
    logger: dependencies.logger || console,
    appStartTime: dependencies.appStartTime || new Date()
  };
  
  // Initialize individual services with dependencies
  const statusService = createStatusService({
    ...commonDependencies,
    version: dependencies.version
  });
  
  // Return object with all service methods
  return {
    status: statusService
  };
}

module.exports = initializeInternalServices; 