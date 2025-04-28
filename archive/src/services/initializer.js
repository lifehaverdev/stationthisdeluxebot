/**
 * Service Initializer
 * 
 * Initializes and registers all services with the service registry.
 * This module provides a single place to configure and start all services
 * needed for the application to function.
 */

const { ServiceRegistry } = require('./registry');
const { ComfyDeployAdapter } = require('./comfyDeployAdapter');
const { getWorkflowService } = require('./comfydeploy/WorkflowService');
const { Logger } = require('../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'serviceInitializer'
});

// Get registry instance
const serviceRegistry = ServiceRegistry.getInstance();

/**
 * Initialize ComfyDeploy service
 * @param {Object} options - Service options
 * @returns {Promise<ComfyDeployAdapter>} - Initialized ComfyDeploy adapter
 */
async function initializeComfyDeployService(options = {}) {
  logger.info('Initializing ComfyDeploy service');
  
  try {
    // Create and configure workflow service
    const workflowService = getWorkflowService({
      cacheRefreshInterval: options.workflowRefreshInterval || 3600000,
      logger
    });
    
    // Initialize the workflow service
    await workflowService.initialize();
    
    // Create ComfyDeploy adapter with workflow service
    const adapter = new ComfyDeployAdapter({
      serviceName: 'comfydeploy',
      workflowService,
      config: {
        apiKey: process.env.COMFY_DEPLOY_API_KEY,
        baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
        webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL,
        // Any additional configuration
        ...options.config
      }
    });
    
    // Initialize adapter
    await adapter.init();
    
    // Register adapter with service registry
    serviceRegistry.register(adapter, options.override);
    
    logger.info('ComfyDeploy service initialized and registered', {
      workflowCount: workflowService.workflows.length
    });
    
    return adapter;
  } catch (error) {
    logger.error('Failed to initialize ComfyDeploy service', { error });
    throw error;
  }
}

/**
 * Initialize all services
 * @param {Object} options - Initialization options
 * @returns {Promise<Object>} - Initialized services
 */
async function initializeAllServices(options = {}) {
  logger.info('Initializing all services');
  
  try {
    // Initialize ComfyDeploy service
    const comfyDeployAdapter = await initializeComfyDeployService(options.comfyDeploy || {});
    
    // Initialize all services in the registry
    await serviceRegistry.initializeAll();
    
    logger.info('All services initialized', {
      serviceCount: serviceRegistry.getServiceNames().length
    });
    
    return {
      comfyDeploy: comfyDeployAdapter,
      registry: serviceRegistry
    };
  } catch (error) {
    logger.error('Failed to initialize all services', { error });
    throw error;
  }
}

/**
 * Shutdown all services
 * @returns {Promise<void>}
 */
async function shutdownAllServices() {
  logger.info('Shutting down all services');
  
  try {
    // Shutdown workflow service
    const workflowService = getWorkflowService();
    workflowService.shutdown();
    
    // Shutdown all services in the registry
    await serviceRegistry.shutdownAll();
    
    logger.info('All services shut down');
  } catch (error) {
    logger.error('Error shutting down services', { error });
    throw error;
  }
}

module.exports = {
  initializeComfyDeployService,
  initializeAllServices,
  shutdownAllServices
}; 