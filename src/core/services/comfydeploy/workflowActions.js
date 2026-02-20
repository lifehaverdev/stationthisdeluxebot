/**
 * Workflow Actions
 * 
 * Functions for modifying ComfyDeploy state (creating deployments, uploading workflows)
 * or manipulating the WorkflowsService cache.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Import necessary utilities
const { standardizeWorkflowName } = require('./workflowUtils');

/**
 * Create a new deployment in ComfyUI Deploy
 * 
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {Object} options - Deployment options
 * @param {string} options.workflowVersionId - Workflow version ID to deploy
 * @param {string} options.machineId - Machine ID to deploy to
 * @param {string} options.name - (Optional) Name for the deployment
 * @returns {Promise<Object>} - The created deployment
 */
async function createDeployment(serviceInstance, options = {}) {
  const { workflowVersionId, machineId, name } = options;
  const { apiUrl, apiKey, logger } = serviceInstance;
  
  if (!workflowVersionId) {
    throw new Error('Workflow version ID is required');
  }
  
  if (!machineId) {
    throw new Error('Machine ID is required');
  }
  
  try {
    const payload = {
      workflow_version_id: workflowVersionId,
      machine_id: machineId
    };
    
    if (name) {
      payload.name = name;
    }
    
    // Assuming API_ENDPOINTS might be needed, though '/deployment' is hardcoded here
    // Let's add it for consistency if other actions use it.
    const response = await fetch(`${apiUrl}/deployment`, { // Endpoint was hardcoded
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create deployment: ${response.status}, message: ${errorText}`);
    }
    
    const deployment = await response.json();
    
    // Update the cache by calling the instance's internal method
    await serviceInstance._fetchAndProcessDeployments(); 
    
    return deployment;
  } catch (error) {
    logger.error(`Error creating deployment: ${error.message}`);
    throw error;
  }
}

/**
 * Invalidate cache for a specific workflow
 * 
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {string} name - Name of the workflow to invalidate
 */
function invalidateWorkflowCache(serviceInstance, name) {
  const { cache, logger } = serviceInstance;
  const standardName = standardizeWorkflowName(name); // Use imported utility function directly
  
  logger.debug(`[invalidateWorkflowCache] Attempting to invalidate cache for: ${name} (Standard: ${standardName})`);

  if (name && cache.byName.has(standardName)) {
    const workflow = cache.byName.get(standardName);
    logger.debug(`[invalidateWorkflowCache] Found workflow in cache to invalidate: ${workflow.name} (ID: ${workflow.id})`);

    // Remove from byName index
    const deletedByName = cache.byName.delete(standardName);
    logger.debug(`[invalidateWorkflowCache] Deleted from byName cache: ${deletedByName}`);

    // Remove from workflows array
    const initialLength = cache.workflows.length;
    const originalIndex = cache.workflows.findIndex(w => w.standardName === standardName);
    if (originalIndex !== -1) {
      cache.workflows.splice(originalIndex, 1);
      logger.debug(`[invalidateWorkflowCache] Spliced workflow from workflows array. New length: ${cache.workflows.length}`);
    } else {
        logger.debug(`[invalidateWorkflowCache] Workflow not found in workflows array by standard name ${standardName}.`);
    }

    // Remove deployment IDs from byDeploymentId index
    if (workflow.deploymentIds && Array.isArray(workflow.deploymentIds)) {
       let deletedCount = 0;
       workflow.deploymentIds.forEach(id => {
          if(cache.byDeploymentId.delete(id)) {
            deletedCount++;
          }
       });
       logger.debug(`[invalidateWorkflowCache] Removed ${deletedCount} associated deployment IDs from byDeploymentId cache.`);
    } else {
        logger.debug(`[invalidateWorkflowCache] No deployment IDs found on workflow object to remove from byDeploymentId cache.`);
    }
    logger.debug(`[invalidateWorkflowCache] Cache invalidated for workflow: ${name}`);

  } else {
    logger.warn(`[invalidateWorkflowCache] Workflow named "${name}" (Standard: "${standardName}") not found in byName cache. Cannot invalidate.`);
  }
}


/**
 * Upload a workflow to ComfyUI Deploy
 * 
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {Object} options - Workflow options
 * @param {Object} options.workflow - The workflow definition
 * @param {Object} options.workflowApi - API definition for the workflow (optional)
 * @param {string} options.workflowName - Name for the workflow (optional)
 * @param {string} options.workflowId - Existing workflow ID to update (optional)
 * @returns {Promise<Object>} - Workflow ID and version
 */
async function uploadWorkflow(serviceInstance, options = {}) {
  const { workflow, workflowApi, workflowName, workflowId } = options;
  const { apiUrl, apiKey, logger } = serviceInstance;
  
  if (!workflow) {
    throw new Error('Workflow definition is required');
  }
  
  try {
    const payload = {
      workflow
    };
    
    if (workflowApi) {
      payload.workflow_api = workflowApi;
    }
    
    if (workflowName) {
      payload.workflow_name = workflowName;
    }
    
    if (workflowId) {
      payload.workflow_id = workflowId;
    }
    
    // Assuming API_ENDPOINTS might be needed, though '/api/workflow' is hardcoded here
    const response = await fetch(`${apiUrl}/api/workflow`, { // Endpoint was hardcoded
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload workflow: ${response.status}, message: ${errorText}`);
    }
    
    const result = await response.json();
    
    // Clear relevant cache entries using the extracted utility function
    if (workflowName) {
      invalidateWorkflowCache(serviceInstance, workflowName);
    }
    
    return {
      workflowId: result.workflow_id,
      version: result.version
    };
  } catch (error) {
    logger.error(`Error uploading workflow: ${error.message}`);
    throw error;
  }
}

/**
 * Force a reload of all workflows from ComfyUI Deploy
 * 
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @returns {Promise<Array>} - Updated list of workflows
 */
async function reloadWorkflows(serviceInstance) {
  serviceInstance.logger.debug('[reloadWorkflows] Forcing reload...');
  // Call internal methods on the instance
  serviceInstance._clearCache(); 
  // Note: _fetchAndProcessDeployments now only fetches deployments.
  // Initialization logic needs _fetchWorkflows and _buildIndexes too.
  // This reload might be incomplete now. Consider calling serviceInstance.initialize() instead?
  // For now, sticking to the original logic which only called _fetchAndProcessDeployments.
  // Let's call initialize() as it seems more correct for a full reload.
  // return await serviceInstance._fetchAndProcessDeployments(); 
  return await serviceInstance.initialize(); // Re-initialize completely
}

module.exports = {
  createDeployment,
  uploadWorkflow,
  reloadWorkflows,
  invalidateWorkflowCache
}; 