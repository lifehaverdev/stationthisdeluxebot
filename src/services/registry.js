/**
 * Service Registry
 * 
 * Manages registration and access to service adapters.
 * Provides a centralized registry for all service adapters in the application.
 */

const { AppError } = require('../core/shared/errors/AppError');
const { createLogger } = require('../utils/logger');
const { ServiceAdapter } = require('./baseAdapter');

// Singleton instance
let instance = null;

/**
 * Service Registry class
 */
class ServiceRegistry {
  /**
   * Get the singleton instance of the ServiceRegistry
   * @returns {ServiceRegistry} The singleton instance
   */
  static getInstance() {
    if (!instance) {
      instance = new ServiceRegistry();
    }
    return instance;
  }

  /**
   * Create a new Service Registry
   */
  constructor() {
    this.services = new Map();
    this.logger = createLogger('serviceRegistry');
  }

  /**
   * Register a service adapter
   * @param {ServiceAdapter} serviceAdapter - The service adapter to register
   * @param {boolean} [override=false] - Whether to override an existing service with the same name
   * @returns {ServiceRegistry} The registry instance for chaining
   * @throws {AppError} If a service with the same name already exists and override is false
   */
  register(serviceAdapter, override = false) {
    // Validate adapter
    if (!(serviceAdapter instanceof ServiceAdapter)) {
      throw new AppError('Service adapter must be an instance of ServiceAdapter', {
        code: 'INVALID_SERVICE_ADAPTER'
      });
    }

    const serviceName = serviceAdapter.serviceName;

    // Check if service already exists
    if (this.services.has(serviceName) && !override) {
      throw new AppError(`Service with name '${serviceName}' already registered`, {
        code: 'SERVICE_ALREADY_REGISTERED'
      });
    }

    // Register the service
    this.services.set(serviceName, serviceAdapter);
    
    this.logger.info('Service registered', {
      service: serviceName
    });

    return this;
  }

  /**
   * Unregister a service adapter
   * @param {string} serviceName - The name of the service to unregister
   * @returns {boolean} True if the service was unregistered, false if it didn't exist
   */
  unregister(serviceName) {
    if (!this.services.has(serviceName)) {
      return false;
    }

    // Get the service adapter
    const serviceAdapter = this.services.get(serviceName);
    
    // Shutdown the service if it's initialized
    if (serviceAdapter.initialized) {
      try {
        serviceAdapter.shutdown();
      } catch (error) {
        this.logger.warn('Error shutting down service during unregister', {
          service: serviceName,
          error
        });
      }
    }

    // Remove the service
    this.services.delete(serviceName);
    
    this.logger.info('Service unregistered', {
      service: serviceName
    });

    return true;
  }

  /**
   * Get a service adapter by name
   * @param {string} serviceName - The name of the service to get
   * @returns {ServiceAdapter} The service adapter
   * @throws {AppError} If the service doesn't exist
   */
  get(serviceName) {
    if (!this.services.has(serviceName)) {
      throw new AppError(`Service with name '${serviceName}' not found`, {
        code: 'SERVICE_NOT_FOUND'
      });
    }

    return this.services.get(serviceName);
  }

  /**
   * Check if a service exists
   * @param {string} serviceName - The name of the service to check
   * @returns {boolean} True if the service exists, false otherwise
   */
  has(serviceName) {
    return this.services.has(serviceName);
  }

  /**
   * Get all registered services
   * @returns {Map<string, ServiceAdapter>} Map of service name to adapter
   */
  getAll() {
    return this.services;
  }

  /**
   * Get a list of all registered service names
   * @returns {string[]} Array of service names
   */
  getServiceNames() {
    return Array.from(this.services.keys());
  }

  /**
   * Get service metadata for all registered services
   * @returns {Object[]} Array of service metadata objects
   */
  getServicesMetadata() {
    const metadata = [];
    
    for (const [name, adapter] of this.services.entries()) {
      try {
        metadata.push(adapter.getMetadata());
      } catch (error) {
        this.logger.warn('Error getting service metadata', {
          service: name,
          error
        });
        
        // Include basic metadata even if there was an error
        metadata.push({
          name,
          initialized: adapter.initialized || false,
          error: error.message
        });
      }
    }
    
    return metadata;
  }

  /**
   * Initialize all registered services
   * @returns {Promise<void>}
   */
  async initializeAll() {
    const initPromises = [];
    
    for (const [name, adapter] of this.services.entries()) {
      this.logger.info('Initializing service', {
        service: name
      });
      
      // Create a promise that resolves even if initialization fails
      const initPromise = adapter.init()
        .catch(error => {
          this.logger.error('Service initialization failed', {
            service: name,
            error
          });
          // Return the adapter anyway so we can continue
          return adapter;
        });
      
      initPromises.push(initPromise);
    }
    
    // Wait for all services to initialize
    await Promise.all(initPromises);
    
    this.logger.info('All services initialized', {
      serviceCount: this.services.size
    });
  }

  /**
   * Shutdown all registered services
   * @returns {Promise<void>}
   */
  async shutdownAll() {
    const shutdownPromises = [];
    
    for (const [name, adapter] of this.services.entries()) {
      if (adapter.initialized) {
        this.logger.info('Shutting down service', {
          service: name
        });
        
        // Create a promise that resolves even if shutdown fails
        const shutdownPromise = adapter.shutdown()
          .catch(error => {
            this.logger.error('Service shutdown failed', {
              service: name,
              error
            });
            // Return the adapter anyway so we can continue
            return adapter;
          });
        
        shutdownPromises.push(shutdownPromise);
      }
    }
    
    // Wait for all services to shutdown
    await Promise.all(shutdownPromises);
    
    this.logger.info('All services shut down', {
      serviceCount: this.services.size
    });
  }

  /**
   * Execute a service
   * @param {string} serviceName - The name of the service to execute
   * @param {Object} params - The parameters to pass to the service
   * @param {Object} context - The context to pass to the service
   * @returns {Promise<Object>} The service response
   */
  async executeService(serviceName, params = {}, context = {}) {
    // Get the service adapter
    const serviceAdapter = this.get(serviceName);
    
    try {
      // Validate parameters
      await serviceAdapter.validateParams(params);
      
      // Execute the service
      const result = await serviceAdapter.execute(params, context);
      
      this.logger.info('Service executed successfully', {
        service: serviceName,
        userId: context?.user?.id
      });
      
      return result;
    } catch (error) {
      // Convert to AppError if it's not already
      const appError = serviceAdapter._handleError(error, params, context);
      
      throw appError;
    }
  }

  /**
   * Get the estimated cost of executing a service
   * @param {string} serviceName - The name of the service
   * @param {Object} params - The parameters to pass to the service
   * @returns {Promise<number>} The estimated cost
   */
  async getServiceCost(serviceName, params = {}) {
    // Get the service adapter
    const serviceAdapter = this.get(serviceName);
    
    try {
      // Get the estimated cost
      const cost = await serviceAdapter.getEstimatedCost(params);
      
      return cost;
    } catch (error) {
      // Convert to AppError if it's not already
      if (!(error instanceof AppError)) {
        throw new AppError('Failed to get service cost', {
          code: 'SERVICE_COST_ERROR',
          cause: error,
          service: serviceName
        });
      }
      
      throw error;
    }
  }
}

module.exports = {
  ServiceRegistry
}; 