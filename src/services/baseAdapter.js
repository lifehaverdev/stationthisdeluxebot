/**
 * Base Service Adapter
 * 
 * Defines the contract that all service adapters must implement.
 * This provides a consistent interface for the internal API to interact with
 * various external services without knowing their implementation details.
 */

const { AppError } = require('../core/shared/errors/AppError');
const { createLogger } = require('../utils/logger');

/**
 * Base class for all service adapters
 */
class ServiceAdapter {
  /**
   * Create a new service adapter
   * @param {Object} options - Adapter options
   * @param {string} options.serviceName - Name of the service
   * @param {Object} options.config - Service configuration
   */
  constructor(options = {}) {
    if (!options.serviceName) {
      throw new Error('serviceName is required for ServiceAdapter');
    }

    this.serviceName = options.serviceName;
    this.config = options.config || {};
    this.logger = createLogger(`service:${this.serviceName}`);

    this.initialized = false;
  }

  /**
   * Initialize the service adapter
   * This should be called before using the adapter
   * @returns {Promise<void>}
   */
  async init() {
    this.logger.info('Initializing service adapter', {
      service: this.serviceName
    });
    
    // Base implementation just marks as initialized
    // Subclasses should override this method to perform actual initialization
    this.initialized = true;
    
    this.logger.info('Service adapter initialized', {
      service: this.serviceName
    });
  }

  /**
   * Shutdown the service adapter
   * This should be called when the adapter is no longer needed
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info('Shutting down service adapter', {
      service: this.serviceName
    });
    
    // Base implementation just marks as not initialized
    // Subclasses should override this method to perform actual cleanup
    this.initialized = false;
    
    this.logger.info('Service adapter shut down', {
      service: this.serviceName
    });
  }

  /**
   * Check if the adapter is initialized
   * @private
   */
  _checkInitialized() {
    if (!this.initialized) {
      throw new AppError(`Service adapter ${this.serviceName} is not initialized`, {
        code: 'SERVICE_NOT_INITIALIZED'
      });
    }
  }

  /**
   * Execute a service request
   * @param {Object} params - Service parameters
   * @param {Object} context - Execution context
   * @param {Object} context.user - User information
   * @param {string} context.user.id - User ID
   * @returns {Promise<Object>} - Service response
   */
  async execute(params = {}, context = {}) {
    this._checkInitialized();
    
    // This method must be implemented by subclasses
    throw new AppError('execute() method must be implemented by subclass', {
      code: 'METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Get the estimated cost of executing the service with the given parameters
   * @param {Object} params - Service parameters
   * @returns {Promise<number>} - Estimated cost in points
   */
  async getEstimatedCost(params = {}) {
    this._checkInitialized();
    
    // This method must be implemented by subclasses
    throw new AppError('getEstimatedCost() method must be implemented by subclass', {
      code: 'METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Validate service parameters
   * @param {Object} params - Service parameters
   * @returns {Promise<boolean>} - True if parameters are valid
   * @throws {AppError} - If parameters are invalid
   */
  async validateParams(params = {}) {
    this._checkInitialized();
    
    // This method must be implemented by subclasses
    throw new AppError('validateParams() method must be implemented by subclass', {
      code: 'METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Check if the service is healthy
   * @returns {Promise<boolean>} - True if the service is healthy
   */
  async healthCheck() {
    this._checkInitialized();
    
    // Default implementation just returns true
    // Subclasses should override this method to perform actual health checks
    return true;
  }

  /**
   * Get metadata about the service
   * @returns {Object} - Service metadata
   */
  getMetadata() {
    return {
      name: this.serviceName,
      initialized: this.initialized,
      // Subclasses should override this method to provide additional metadata
    };
  }

  /**
   * Get service capabilities
   * @returns {Object} - Service capabilities
   */
  getCapabilities() {
    // Subclasses should override this method to provide actual capabilities
    return {
      maxConcurrentRequests: 1,
      supportsAsyncExecution: false,
      supportsBatchRequests: false
    };
  }

  /**
   * Handle error from service execution
   * @param {Error} error - The error that occurred
   * @param {Object} params - The parameters that were used
   * @param {Object} context - The context that was used
   * @returns {AppError} - Standardized error
   */
  _handleError(error, params, context) {
    // Log the error
    this.logger.error('Service execution error', {
      service: this.serviceName,
      error,
      userId: context?.user?.id
    });

    // Convert to AppError if it's not already
    if (!(error instanceof AppError)) {
      return new AppError(error.message || 'Service execution failed', {
        code: 'SERVICE_EXECUTION_ERROR',
        cause: error,
        service: this.serviceName
      });
    }

    return error;
  }
}

module.exports = {
  ServiceAdapter
}; 