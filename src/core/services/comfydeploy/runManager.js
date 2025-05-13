/**
 * ComfyDeploy Run Manager
 * 
 * Handles submitting, monitoring, and managing workflow execution runs 
 * via the ComfyDeploy API.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const DEBUG_LOGGING_ENABLED = false; // Set to true for detailed run logging

// Module-level cache for active requests
const activeRequests = new Map();

// === Internal Helper Functions ===

/**
 * Determine if a URL is an image URL (internal helper)
 * @param {string} url - The URL to check
 * @returns {boolean} - Whether the URL is likely an image URL
 */
function isImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    // Check URL extension
    const pattern = /\.(jpeg|jpg|gif|png|bmp|webp)(\?.*)?$/i;
    if (pattern.test(url)) {
      return true;
    }
    
    // Check if URL contains image-like path segments
    if (url.includes('/images/') || 
        url.includes('/image/') || 
        url.includes('/img/')) {
      return true;
    }
    
    return false;
}

/**
 * Extract image outputs from the workflow outputs (internal helper)
 * @param {Object} outputs - Workflow outputs
 * @returns {Array} - List of image URLs
 */
function extractImageOutputs(outputs) {
    if (!outputs || typeof outputs !== 'object') {
      return [];
    }
    
    const images = [];
    
    // Iterate through all outputs
    Object.values(outputs).forEach(value => {
      // Check if the value is a URL string or an object with URL
      if (typeof value === 'string' && isImageUrl(value)) {
        images.push(value);
      } else if (value && typeof value === 'object') {
        // Check if it's an array
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === 'string' && isImageUrl(item)) {
              images.push(item);
            }
          });
        }
        // Check for nested objects with image URLs
        else if (value.url && typeof value.url === 'string' && isImageUrl(value.url)) {
          images.push(value.url);
        }
        // Check for nested arrays with image URLs
        else if (value.images && Array.isArray(value.images)) {
          value.images.forEach(img => {
            if (typeof img === 'string' && isImageUrl(img)) {
              images.push(img);
            } else if (img && img.url && typeof img.url === 'string' && isImageUrl(img.url)) {
              images.push(img.url);
            }
          });
        }
      }
    });
    
    return images;
}

/**
 * Clean up stale requests from the internal map (internal helper)
 * NOTE: This needs to be called periodically. Consider how/where.
 * Maybe return a cleanup function or require manual calls?
 * For now, it's just a helper that could be called internally by other funcs if needed.
 * @param {number} timeout - The timeout threshold for considering a request stale.
 */
function cleanupStaleRequests(timeout) {
    const now = Date.now();
    const staleThreshold = timeout * 2; 
    
    for (const [runId, request] of activeRequests.entries()) {
      const age = now - request.timestamp;
      
      if (age > staleThreshold || 
          request.status === 'completed' || 
          request.status === 'success' || // Added success state
          request.status === 'error' || 
          request.status === 'cancelled') {
        activeRequests.delete(runId);
        // console.log(`[runManager._cleanupStaleRequests] Removed stale/completed request: ${runId}`);
      }
    }
}

// === Exported Run Management Functions ===

/**
 * Submit a workflow execution request
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiUrl
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Class} instanceData.WorkflowsService - The WorkflowsService class constructor.
 * @param {Function} instanceData.getMachineForWorkflow - The utility function.
 * @param {Object} options - Request options (deploymentId, inputs, machineId?, workflowName?, webhookUrl?)
 * @returns {Promise<string>} - Run ID
 */
async function submitRequest(instanceData, options = {}) {
    const { apiUrl, apiKey, logger, API_ENDPOINTS, WorkflowsService, getMachineForWorkflow } = instanceData;

    if (!options.deploymentId) {
      throw new Error('Deployment ID is required');
    }

    // Check if we need to determine the machine ID from the workflow
    let machineId = options.machineId;
    if (!machineId && options.workflowName) {
      try {
        // If we have a WorkflowsService class and workflowName, use it for machine routing
        const workflows = new WorkflowsService({ logger: logger }); // Use passed-in logger
        // TODO: Still creates a temporary WorkflowsService instance. Address later.
        machineId = await getMachineForWorkflow(workflows, options.workflowName);
        
        if (machineId) {
          if (DEBUG_LOGGING_ENABLED) logger.info(`[runManager.submitRequest] Using machine ${machineId} for workflow "${options.workflowName}"`);
        } else {
          if (DEBUG_LOGGING_ENABLED) logger.info(`[runManager.submitRequest] No suitable machine found for workflow "${options.workflowName}", using default or API-selected machine`);
        }
      } catch (error) {
        logger.error(`[runManager.submitRequest] Error determining machine for workflow "${options.workflowName}": ${error.message}`);
      }
    }

    const payload = {
      deployment_id: options.deploymentId,
      inputs: options.inputs || {}
    };
    if (machineId) payload.machine_id = machineId;
    if (options.webhook) payload.webhook = options.webhook;

    const url = `${apiUrl}${API_ENDPOINTS.RUN_QUEUE}`;
    if (DEBUG_LOGGING_ENABLED) logger.info(`[runManager.submitRequest] Submitting to ${url} for deployment ${options.deploymentId}${machineId ? ` on machine ${machineId}` : ''}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
          const errorText = await response.text();
          logger.error(`[runManager.submitRequest] Failed submission (${response.status}): ${errorText}`);
          throw new Error(`Failed to submit request: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      const runId = result.run_id;

      logger.info(`[runManager.submitRequest] Submitted successfully. Run ID: ${runId}`);
      
      // Track the request using the module-level map
      activeRequests.set(runId, {
        options,
        timestamp: Date.now(),
        status: 'processing' // Initial status
      });
      
      return runId;
    } catch (error) {
      logger.error(`[runManager.submitRequest] Error: ${error.message}`);
      throw error;
    }
}

/**
 * Check the status of a generation request
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiUrl
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {string} runId - The run ID to check
 * @returns {Promise<Object>} - Returns status information
 */
async function checkStatus(instanceData, runId) {
    const { apiUrl, apiKey, logger, API_ENDPOINTS } = instanceData;
    const url = `${apiUrl}${API_ENDPOINTS.RUN_STATUS(runId)}`;

    try {
      if (!runId) {
        logger.warn('[runManager.checkStatus] Invalid run ID provided.');
        return { status: 'error', error: 'Invalid run ID' };
      }
      
      if (DEBUG_LOGGING_ENABLED) logger.debug(`[runManager.checkStatus] Checking status for run ${runId} at ${url}`);
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[runManager.checkStatus] Failed status check for ${runId} (${response.status}): ${errorText}`);
        return { 
          status: 'error', 
          error: `Failed to check status: ${response.status}, message: ${errorText}` 
        };
      }
      
      const data = await response.json();
      if (DEBUG_LOGGING_ENABLED) logger.debug(`[runManager.checkStatus] Status for ${runId}: ${data.status}`);
      
      // Update active request status if we're tracking it
      if (activeRequests.has(runId)) {
        const request = activeRequests.get(runId);
        request.status = data.status;
        activeRequests.set(runId, request);
      }
      
      let mappedStatus = data.status;
      let progress = 0;
      
      if (data.status === 'running' && data.progress) {
        progress = data.progress;
      } else if (data.status === 'success') {
        mappedStatus = 'completed';
      }
      
      return {
        status: mappedStatus,
        progress: progress,
        outputs: data.workflow_outputs || {},
        error: data.error || null,
        raw: data // Include raw API response
      };
    } catch (error) {
      logger.error(`[runManager.checkStatus] Error checking status for run ${runId}: ${error.message}`);
      return { status: 'error', error: error.message };
    }
}

/**
 * Get the results of a completed generation
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiUrl
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {string} runId - The run ID to get results for
 * @returns {Promise<Object>} - Returns generation results
 */
async function getResults(instanceData, runId) {
    const { logger } = instanceData;
    if (DEBUG_LOGGING_ENABLED) logger.debug(`[runManager.getResults] Attempting to get results for run ${runId}`);
    try {
      // Use the exported checkStatus function
      const statusResult = await checkStatus(instanceData, runId);
      
      if (statusResult.status === 'error') {
        logger.warn(`[runManager.getResults] Status check failed for ${runId}: ${statusResult.error}`);
        return { success: false, error: statusResult.error };
      }
      
      if (statusResult.status !== 'completed') { // Check against mapped 'completed' status
        if (DEBUG_LOGGING_ENABLED) logger.info(`[runManager.getResults] Generation not completed for ${runId}. Status: ${statusResult.status}`);
        return { 
          success: false, 
          error: 'Generation not completed',
          progress: statusResult.progress || 0,
          status: statusResult.status
        };
      }
      
      // Use internal helper
      const images = extractImageOutputs(statusResult.outputs);
      logger.info(`[runManager.getResults] Successfully retrieved results for ${runId}. Found ${images.length} images.`);
      
      return { 
        success: true,
        outputs: statusResult.outputs,
        images: images
      };
    } catch (error) {
      logger.error(`[runManager.getResults] Error getting results for run ${runId}: ${error.message}`);
      return { success: false, error: error.message };
    }
}

/**
 * Cancel a running generation request
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiUrl
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {string} runId - The run ID to cancel
 * @returns {Promise<Object>} - Returns cancellation result
 */
async function cancelRequest(instanceData, runId) {
    const { apiUrl, apiKey, logger, API_ENDPOINTS } = instanceData;
    const url = `${apiUrl}${API_ENDPOINTS.RUN_CANCEL(runId)}`;

    try {
      if (!runId) {
        logger.warn('[runManager.cancelRequest] Invalid run ID provided.');
        return { success: false, error: 'Invalid run ID' };
      }
      
      if (DEBUG_LOGGING_ENABLED) logger.info(`[runManager.cancelRequest] Attempting to cancel run ${runId} at ${url}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[runManager.cancelRequest] Failed to cancel run ${runId} (${response.status}): ${errorText}`);
        return { success: false, error: `Failed to cancel run: ${response.status} ${errorText}` };
      }
      
      logger.info(`[runManager.cancelRequest] Successfully cancelled run ${runId}.`);
      // Update active request status if we're tracking it
      if (activeRequests.has(runId)) {
        const request = activeRequests.get(runId);
        request.status = 'cancelled';
        activeRequests.set(runId, request);
      }
      
      return { success: true };
    } catch (error) {
      logger.error(`[runManager.cancelRequest] Error cancelling request for run ${runId}: ${error.message}`);
      // Don't re-throw here, return structured error
      return { success: false, error: error.message }; 
    }
}

module.exports = {
    submitRequest,
    checkStatus,
    getResults,
    cancelRequest,
    // We don't export the helpers like cleanupStaleRequests
}; 