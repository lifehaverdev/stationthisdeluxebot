/**
 * Workflow Diagnostics Utility
 * 
 * Provides utilities for diagnosing workflow synchronization issues
 * and monitoring workflow availability across different services.
 */

const { getWorkflowService } = require('../services/comfydeploy/WorkflowService');
const { comfyDeployService } = require('../services/comfydeploy/service');
const { Logger } = require('./logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'workflowDiagnostics'
});

/**
 * Get diagnostic information about workflows across different services
 * 
 * @param {Object} options - Diagnostic options
 * @param {Object} options.workflowManager - Workflow manager instance
 * @returns {Object} Diagnostic information and recommendations
 */
async function getWorkflowDiagnostics(options = {}) {
  const { workflowManager } = options;
  const workflowService = getWorkflowService();
  
  // Basic availability check
  const servicesAvailable = {
    workflowManager: !!workflowManager,
    workflowService: !!workflowService,
    comfyDeployService: !!comfyDeployService
  };
  
  // Get workflows from each service
  const managerWorkflows = workflowManager ? workflowManager.getWorkflowDefinitions() : {};
  const serviceWorkflows = workflowService ? workflowService.getAllWorkflows() || [] : [];
  const comfyWorkflows = comfyDeployService && comfyDeployService.workflows ? 
                         comfyDeployService.workflows : [];
  
  // Create a map of all workflow names from all sources
  const allWorkflowNames = new Set();
  
  // Add workflow names from manager
  Object.keys(managerWorkflows).forEach(name => allWorkflowNames.add(name));
  
  // Add workflow names from service
  serviceWorkflows.forEach(workflow => allWorkflowNames.add(workflow.name));
  
  // Add workflow names from comfyDeploy
  comfyWorkflows.forEach(workflow => allWorkflowNames.add(workflow.name));
  
  // Create diagnostic entries for each workflow
  const workflows = Array.from(allWorkflowNames).map(name => {
    const inManager = !!managerWorkflows[name];
    const inService = serviceWorkflows.some(w => w.name === name);
    const inComfyDeploy = comfyWorkflows.some(w => w.name === name);
    
    // Determine synchronization status
    let status = 'unknown';
    if (inManager && inService && inComfyDeploy) {
      status = 'fully_synchronized';
    } else if (inManager && inService) {
      status = 'core_synchronized';
    } else if (inManager && inComfyDeploy) {
      status = 'manager_comfy_only';
    } else if (inService && inComfyDeploy) {
      status = 'service_comfy_only';
    } else if (inManager) {
      status = 'manager_only';
    } else if (inService) {
      status = 'service_only';
    } else if (inComfyDeploy) {
      status = 'comfy_only';
    }
    
    return {
      name,
      inManager,
      inService,
      inComfyDeploy,
      status
    };
  });
  
  // Generate summary
  const summary = {
    total: workflows.length,
    fullySynchronized: workflows.filter(w => w.status === 'fully_synchronized').length,
    coreSynchronized: workflows.filter(w => w.status === 'core_synchronized').length,
    managerOnly: workflows.filter(w => w.status === 'manager_only').length,
    serviceOnly: workflows.filter(w => w.status === 'service_only').length,
    comfyOnly: workflows.filter(w => w.status === 'comfy_only').length,
    managerComfyOnly: workflows.filter(w => w.status === 'manager_comfy_only').length,
    serviceComfyOnly: workflows.filter(w => w.status === 'service_comfy_only').length
  };
  
  // Generate recommendations
  const recommendations = [];
  
  if (summary.managerOnly > 0) {
    recommendations.push({
      type: 'sync_to_service',
      message: `${summary.managerOnly} workflows found only in manager - synchronize to service`,
      workflows: workflows.filter(w => w.status === 'manager_only').map(w => w.name)
    });
  }
  
  if (summary.serviceOnly > 0) {
    recommendations.push({
      type: 'sync_to_manager',
      message: `${summary.serviceOnly} workflows found only in service - synchronize to manager`,
      workflows: workflows.filter(w => w.status === 'service_only').map(w => w.name)
    });
  }
  
  if (summary.comfyOnly > 0) {
    recommendations.push({
      type: 'sync_from_comfy',
      message: `${summary.comfyOnly} workflows found only in ComfyDeploy - synchronize to core services`,
      workflows: workflows.filter(w => w.status === 'comfy_only').map(w => w.name)
    });
  }
  
  const diagnostics = {
    timestamp: new Date(),
    servicesAvailable,
    counts: {
      manager: Object.keys(managerWorkflows).length,
      service: serviceWorkflows.length,
      comfyDeploy: comfyWorkflows.length,
      total: allWorkflowNames.size
    },
    summary,
    recommendations,
    workflows
  };
  
  logger.info('Workflow diagnostics generated', {
    totalWorkflows: diagnostics.counts.total,
    fullySynchronized: diagnostics.summary.fullySynchronized,
    recommendations: diagnostics.recommendations.length
  });
  
  return diagnostics;
}

/**
 * Sync all workflows between services
 * 
 * @param {Object} options - Sync options
 * @param {Object} options.workflowManager - Workflow manager instance
 * @param {boolean} options.force - Force full synchronization
 * @returns {Object} Sync results
 */
async function syncAllWorkflows(options = {}) {
  const { workflowManager, force = false } = options;
  
  if (!workflowManager) {
    logger.error('Workflow manager required for synchronization');
    return {
      success: false,
      error: 'Workflow manager required'
    };
  }
  
  try {
    // Generate diagnostics first
    const diagnostics = await getWorkflowDiagnostics({ workflowManager });
    
    // Execute sync operations based on diagnostics
    const syncResults = {
      managerToService: 0,
      serviceToManager: 0,
      comfyToCore: 0,
      errors: []
    };
    
    // Perform synchronization
    if (force || diagnostics.recommendations.length > 0) {
      logger.info('Executing workflow synchronization', {
        force,
        recommendationsCount: diagnostics.recommendations.length
      });
      
      const syncResult = await workflowManager.synchronizeWithWorkflowService(true);
      
      if (syncResult.success) {
        syncResults.managerToService = syncResult.managerToService;
        syncResults.serviceToManager = syncResult.serviceToManager;
      } else {
        syncResults.errors.push({
          operation: 'core_sync',
          error: syncResult.error
        });
      }
    } else {
      logger.info('No synchronization needed - all workflows already in sync');
    }
    
    // Return the results
    return {
      success: syncResults.errors.length === 0,
      timestamp: new Date(),
      syncResults,
      diagnostics: {
        before: diagnostics,
        after: force ? await getWorkflowDiagnostics({ workflowManager }) : null
      }
    };
  } catch (error) {
    logger.error('Error during workflow synchronization', { error });
    return {
      success: false,
      error: error.message,
      timestamp: new Date()
    };
  }
}

module.exports = {
  getWorkflowDiagnostics,
  syncAllWorkflows
}; 