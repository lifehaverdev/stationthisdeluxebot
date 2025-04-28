/**
 * Service Routes
 * 
 * API routes for handling service registration, execution, and metadata.
 */

const express = require('express');
const { ServiceRegistry } = require('../../services/registry');
const internalAPI = require('../../core/internalAPI');
const { Logger } = require('../../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'serviceRoutes'
});

// Create router
const router = express.Router();

/**
 * Get all available services
 * GET /api/services
 */
router.get('/', async (req, res) => {
  try {
    const result = await internalAPI.getServices();
    res.json(result);
  } catch (error) {
    logger.error('Error getting services', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Register a new service
 * POST /api/services
 */
router.post('/', async (req, res) => {
  try {
    const serviceConfig = req.body;
    const result = await internalAPI.registerService(serviceConfig);
    res.json(result);
  } catch (error) {
    logger.error('Error registering service', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get service metadata
 * GET /api/services/:serviceName/metadata
 */
router.get('/:serviceName/metadata', async (req, res) => {
  try {
    const { serviceName } = req.params;
    
    // Get the service registry
    const serviceRegistry = ServiceRegistry.getInstance();
    
    // Check if service exists
    if (!serviceRegistry.has(serviceName)) {
      return res.status(404).json({
        status: 'error',
        error: `Service '${serviceName}' not found`
      });
    }
    
    // Get the service
    const service = serviceRegistry.get(serviceName);
    
    // Get metadata
    const metadata = service.getMetadata();
    
    // Return metadata
    res.json({
      status: 'ok',
      metadata
    });
  } catch (error) {
    logger.error('Error getting service metadata', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Execute a service
 * POST /api/services/:serviceName/execute
 */
router.post('/:serviceName/execute', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { params = {}, userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        status: 'error',
        error: 'userId is required'
      });
    }

    const result = await internalAPI.executeService(serviceName, params, { userId });
    res.json(result);
  } catch (error) {
    logger.error('Error executing service', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get service cost estimate
 * POST /api/services/:serviceName/cost
 */
router.post('/:serviceName/cost', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const params = req.body;
    const result = await internalAPI.getServiceCost(serviceName, params);
    res.json(result);
  } catch (error) {
    logger.error('Error getting service cost', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get ComfyDeploy workflows
 * GET /api/services/comfydeploy/workflows
 */
router.get('/comfydeploy/workflows', async (req, res) => {
  try {
    // Get the service registry
    const serviceRegistry = ServiceRegistry.getInstance();
    
    // Check if ComfyDeploy service exists
    if (!serviceRegistry.has('comfydeploy')) {
      return res.status(404).json({
        status: 'error',
        error: 'ComfyDeploy service not found'
      });
    }
    
    // Get the ComfyDeploy service
    const comfyAdapter = serviceRegistry.get('comfydeploy');
    
    // Check if workflows need to be reloaded
    if (req.query.reload === 'true') {
      await comfyAdapter.reloadWorkflows();
    }
    
    // Get metadata with workflows
    const metadata = comfyAdapter.getMetadata();
    
    // Extract workflow information
    const workflows = (comfyAdapter.config.workflows || []).map(workflow => ({
      name: workflow.name,
      active: workflow.active !== false,
      inputs: Object.keys(workflow.inputs || {}),
      hasDeploymentIds: Array.isArray(workflow.ids) && workflow.ids.length > 0
    }));
    
    // Return workflows
    res.json({
      status: 'ok',
      workflows,
      lastLoaded: metadata.workflowLastLoaded,
      lastLoadedFormatted: new Date(metadata.workflowLastLoaded).toLocaleString()
    });
  } catch (error) {
    logger.error('Error getting ComfyDeploy workflows', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Force reload ComfyDeploy workflows
 * POST /api/services/comfydeploy/workflows/reload
 */
router.post('/comfydeploy/workflows/reload', async (req, res) => {
  try {
    // Get the service registry
    const serviceRegistry = ServiceRegistry.getInstance();
    
    // Check if ComfyDeploy service exists
    if (!serviceRegistry.has('comfydeploy')) {
      return res.status(404).json({
        status: 'error',
        error: 'ComfyDeploy service not found'
      });
    }
    
    // Get the ComfyDeploy service
    const comfyAdapter = serviceRegistry.get('comfydeploy');
    
    // Reload workflows
    const result = await comfyAdapter.reloadWorkflows();
    
    if (!result) {
      return res.status(500).json({
        status: 'error',
        error: 'Failed to reload workflows'
      });
    }
    
    // Get updated metadata
    const metadata = comfyAdapter.getMetadata();
    
    // Return success
    res.json({
      status: 'ok',
      message: 'Workflows reloaded successfully',
      availableWorkflows: metadata.availableWorkflows,
      lastLoaded: metadata.workflowLastLoaded,
      lastLoadedFormatted: new Date(metadata.workflowLastLoaded).toLocaleString()
    });
  } catch (error) {
    logger.error('Error reloading ComfyDeploy workflows', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Check service task status
 * GET /api/services/:serviceName/tasks/:taskId
 */
router.get('/:serviceName/tasks/:taskId', async (req, res) => {
  try {
    const { serviceName, taskId } = req.params;
    
    // Get the service registry
    const serviceRegistry = ServiceRegistry.getInstance();
    
    // Check if service exists
    if (!serviceRegistry.has(serviceName)) {
      return res.status(404).json({
        status: 'error',
        error: `Service '${serviceName}' not found`
      });
    }
    
    // Get the service
    const service = serviceRegistry.get(serviceName);
    
    // Check if service supports checkStatus
    if (typeof service.checkStatus !== 'function') {
      return res.status(400).json({
        status: 'error',
        error: `Service '${serviceName}' does not support status checking`
      });
    }
    
    // Check status
    const status = await service.checkStatus(taskId);
    
    // Return status
    res.json({
      status: 'ok',
      taskStatus: status
    });
  } catch (error) {
    logger.error('Error checking task status', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Cancel service task
 * POST /api/services/:serviceName/tasks/:taskId/cancel
 */
router.post('/:serviceName/tasks/:taskId/cancel', async (req, res) => {
  try {
    const { serviceName, taskId } = req.params;
    
    // Get the service registry
    const serviceRegistry = ServiceRegistry.getInstance();
    
    // Check if service exists
    if (!serviceRegistry.has(serviceName)) {
      return res.status(404).json({
        status: 'error',
        error: `Service '${serviceName}' not found`
      });
    }
    
    // Get the service
    const service = serviceRegistry.get(serviceName);
    
    // Check if service supports cancelTask
    if (typeof service.cancelTask !== 'function') {
      return res.status(400).json({
        status: 'error',
        error: `Service '${serviceName}' does not support task cancellation`
      });
    }
    
    // Cancel task
    const result = await service.cancelTask(taskId);
    
    // Return result
    res.json({
      status: 'ok',
      result
    });
  } catch (error) {
    logger.error('Error cancelling task', { error });
    res.status(500).json({
      status: 'error',
      error: error.message || 'Internal server error'
    });
  }
});

module.exports = router; 