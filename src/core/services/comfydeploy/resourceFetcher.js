/**
 * ComfyDeploy Resource Fetcher
 * 
 * Fetches core resources like deployments, workflows, machines, versions, 
 * and details from the ComfyDeploy API.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs'); // Needed for debugging output in getWorkflowContent

// const DEBUG_LOGGING_ENABLED = false; // Removed: We will use logger.debug

// === Internal Helper Functions ===

/**
 * PRIVATE Helper: Attempts to parse workflow JSON from various common locations within API response data.
 * @param {Object} data - The API response data object.
 * @param {string} endpoint - The endpoint the data came from (for logging).
 * @param {object} logger - Logger instance.
 * @returns {Object|null} - Workflow JSON structure with nodes, or null.
 */
function _tryParseWorkflowJson(data, endpoint, logger) {
    let workflowJson = null;
    if (!data) return null;

    if (data.workflow_json && data.workflow_json.nodes) {
      logger.debug('[_tryParseWorkflowJson] Found workflow_json in response');
      workflowJson = data.workflow_json;
    } else if (data.workflow_data && data.workflow_data.nodes) {
      logger.debug('[_tryParseWorkflowJson] Found workflow_data in response');
      workflowJson = data.workflow_data;
    } else if (data.workflow && typeof data.workflow === 'object' && data.workflow.nodes) {
      logger.debug('[_tryParseWorkflowJson] Found workflow object with nodes in response');
      workflowJson = data.workflow;
    } else if (data.nodes) {
      logger.debug('[_tryParseWorkflowJson] Found nodes directly in response root');
      workflowJson = data; 
    } else if (data.content) {
      logger.debug('[_tryParseWorkflowJson] Found content field in response');
      try {
        if (typeof data.content === 'string' && data.content.trim().startsWith('{')) {
          workflowJson = JSON.parse(data.content);
        } else if (typeof data.content === 'object') { 
          workflowJson = data.content;
        }
        if (!workflowJson || !workflowJson.nodes) {
          logger.debug('[_tryParseWorkflowJson] Parsed/assigned content field does not contain nodes.');
          workflowJson = null;
        }
      } catch (error) {
        logger.debug(`[_tryParseWorkflowJson] Failed to parse content field as JSON: ${error.message}`);
        workflowJson = null;
      }
    }

    if (workflowJson && workflowJson.nodes) {
        logger.debug(`[_tryParseWorkflowJson] Found workflow JSON with ${Object.keys(workflowJson.nodes).length} nodes via _tryParseWorkflowJson from endpoint ${endpoint}`);
        return workflowJson;
    } else {
        logger.debug(`[_tryParseWorkflowJson] Response from ${endpoint} did not contain workflow nodes structure in common locations.`);
        return null;
    }
}

/**
 * PRIVATE Helper: Attempts to parse workflow JSON from a version object.
 * @param {Object} version - A workflow version object from an API response.
 * @param {object} logger - Logger instance.
 * @returns {Object|null} - Workflow JSON structure with nodes, or null.
 */
function _tryParseVersionData(version, logger) {
    if (!version || !version.workflow || typeof version.workflow !== 'object') {
        return null;
    }
    logger.debug(`[_tryParseVersionData] Examining version ${version.id}`);
    logger.debug(`[_tryParseVersionData] Found workflow object in version, checking for nodes. Keys: ${Object.keys(version.workflow).join(', ')}`);
              
    let versionWorkflowJson = null;
    if (version.workflow.workflow_json && version.workflow.workflow_json.nodes) {
        versionWorkflowJson = version.workflow.workflow_json;
    } else if (version.workflow.workflow_data && version.workflow.workflow_data.nodes) {
        versionWorkflowJson = version.workflow.workflow_data;
    } else if (version.workflow.nodes) { 
        versionWorkflowJson = version.workflow;
    } else if (version.workflow.json && version.workflow.json.nodes) { 
        versionWorkflowJson = version.workflow.json;
    }
              
    if (versionWorkflowJson && versionWorkflowJson.nodes) {
        logger.debug(`[_tryParseVersionData] Found workflow JSON with ${Object.keys(versionWorkflowJson.nodes).length} nodes directly in version data (version ${version.id})`);
        return versionWorkflowJson;
    }
              
    if (version.workflow.data) {
        logger.debug(`[_tryParseVersionData] Examining version.workflow.data for version ${version.id}`);
        let dataField = version.workflow.data;
        let parsedDataField = null;

        if (typeof dataField === 'string' && dataField.trim().startsWith('{')) {
            try {
                parsedDataField = JSON.parse(dataField);
                logger.debug('[_tryParseVersionData] Successfully parsed workflow.data as JSON');
            } catch (error) {
                logger.debug(`[_tryParseVersionData] Failed to parse workflow.data as JSON: ${error.message}`);
            }
        } else if (typeof dataField === 'object') {
             parsedDataField = dataField; 
        }

        if (parsedDataField && parsedDataField.nodes) {
            logger.debug(`[_tryParseVersionData] Found workflow JSON with ${Object.keys(parsedDataField.nodes).length} nodes in workflow.data`);
            return parsedDataField;
        }
    }
              
    const potentialLocations = [
        'content', 'extra', 'structure'
    ];
              
    for (const location of potentialLocations) {
        if (version.workflow[location]) {
            const locationData = version.workflow[location];
            logger.debug(`[_tryParseVersionData] Examining version.workflow.${location} for version ${version.id}`);
                          
            if (typeof locationData === 'object' && locationData.nodes) {
                logger.debug(`[_tryParseVersionData] Found workflow JSON with ${Object.keys(locationData.nodes).length} nodes in workflow.${location}`);
                return locationData;
            }
                          
            if (typeof locationData === 'string' && locationData.includes('nodes') && locationData.trim().startsWith('{')) {
                 try {
                    const parsed = JSON.parse(locationData);
                    if (parsed && parsed.nodes) {
                        logger.debug(`[_tryParseVersionData] Found workflow JSON with ${Object.keys(parsed.nodes).length} nodes in parsed workflow.${location}`);
                        return parsed;
                    }
                } catch (error) {
                    logger.debug(`[_tryParseVersionData] Failed to parse workflow.${location} as JSON`);
                }
            }
        }
    }
    return null; 
}

// === Exported Resource Fetching Functions ===

/**
 * Get all deployments available to the current user
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Function} instanceData._makeApiRequest - Function to make API requests.
 * @returns {Promise<Array>} - Returns array of deployments
 */
async function getDeployments(instanceData) {
    const { logger, API_ENDPOINTS, _makeApiRequest } = instanceData;
    logger.debug('[resourceFetcher.getDeployments] Fetching deployments...');
    try {
      const response = await _makeApiRequest(`${API_ENDPOINTS.DEPLOYMENTS}?is_deleted=false`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get deployments: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      logger.debug(`[resourceFetcher.getDeployments] Fetched ${data.length} deployments.`);
      return data;
    } catch (error) {
      logger.error(`[resourceFetcher.getDeployments] Error: ${error.message}`);
      throw error;
    }
}

/**
 * Get list of workflows from ComfyUI Deploy API
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Function} instanceData._makeApiRequest - Function to make API requests.
 * @returns {Promise<Array>} - List of workflows
 */
async function getWorkflows(instanceData) {
    const { logger, API_ENDPOINTS, _makeApiRequest } = instanceData;
    logger.debug('[resourceFetcher.getWorkflows] Fetching workflows list...');
    try {
      const response = await _makeApiRequest(API_ENDPOINTS.WORKFLOWS, {
        headers: { 'Accept': 'application/json' } 
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get workflows: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
       logger.info(`[resourceFetcher.getWorkflows] Fetched ${data.length} workflow summaries.`);
      return data;
    } catch (error) {
      logger.error(`[resourceFetcher.getWorkflows] Error: ${error.message}`);
      throw error;
    }
}

/**
 * Get list of machines available in ComfyUI Deploy
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Function} instanceData._makeApiRequest - Function to make API requests.
 * @returns {Promise<Array>} - List of machines
 */
async function getMachines(instanceData) {
    const { logger, API_ENDPOINTS, _makeApiRequest } = instanceData;
    logger.debug('[resourceFetcher.getMachines] Fetching machines...');
    try {
      const response = await _makeApiRequest(`${API_ENDPOINTS.MACHINES}?is_deleted=false`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get machines: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      logger.debug(`[resourceFetcher.getMachines] Fetched ${data.length} machines.`);
      return data;
    } catch (error) {
      logger.error(`[resourceFetcher.getMachines] Error: ${error.message}`);
      throw error;
    }
}

/**
 * Get a workflow version from ComfyUI Deploy
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Function} instanceData._makeApiRequest - Function to make API requests.
 * @param {string} versionId - The workflow version ID
 * @returns {Promise<Object>} - Returns workflow version
 */
async function getWorkflowVersion(instanceData, versionId) {
    const { logger, API_ENDPOINTS, _makeApiRequest } = instanceData;
    logger.debug(`[resourceFetcher.getWorkflowVersion] Fetching version: ${versionId}`);
    if (!versionId) {
      throw new Error('Version ID is required for getWorkflowVersion');
    }
    
    try {
      const response = await _makeApiRequest(API_ENDPOINTS.WORKFLOW_VERSION(versionId), {
        headers: { 'Accept': 'application/json' } 
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        // Handle 404 specifically maybe?
        throw new Error(`Failed to get workflow version ${versionId}: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      logger.debug(`[resourceFetcher.getWorkflowVersion] Fetched version ${versionId}. Keys: ${Object.keys(data).join(', ')}`);
      
      // Ensure we have the complete workflow JSON (copied logic from comfyui.js)
      if (!data.workflow_json && data.workflow_data) {
        logger.debug('[resourceFetcher.getWorkflowVersion] Using workflow_data as workflow_json');
        data.workflow_json = data.workflow_data;
      }
      if (!data.workflow_json && data.workflow) {
        logger.debug('[resourceFetcher.getWorkflowVersion] Using workflow as workflow_json');
        data.workflow_json = data.workflow;
      }
      
      return data;
    } catch (error) {
      logger.error(`[resourceFetcher.getWorkflowVersion] Error getting version ${versionId}: ${error.message}`);
      throw error;
    }
}

/**
 * Get detailed workflow information including complete workflow JSON structure
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Function} instanceData._makeApiRequest - Function to make API requests.
 * @param {string} workflowId - The workflow ID
 * @returns {Promise<Object>} - Returns workflow details with complete JSON structure
 */
async function getWorkflowDetails(instanceData, workflowId) {
     const { logger, API_ENDPOINTS, _makeApiRequest } = instanceData;
    logger.debug(`[resourceFetcher.getWorkflowDetails] Fetching details for ID: ${workflowId}`);
    if (!workflowId) {
      throw new Error('Workflow ID is required for getWorkflowDetails');
    }
    
    try {
      const response = await _makeApiRequest(API_ENDPOINTS.WORKFLOW_BY_ID(workflowId), {
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get workflow details ${workflowId}: ${response.status} ${errorText}`);
      }
      
      const workflowData = await response.json();
      logger.debug(`[resourceFetcher.getWorkflowDetails] Fetched base details for ${workflowId}. Has versions: ${workflowData.workflow_versions ? 'Yes' : 'No'}`);
      
      // If we have versions, get the latest version details to get the full workflow JSON
      if (workflowData.workflow_versions && workflowData.workflow_versions.length > 0) {
        const sortedVersions = [...workflowData.workflow_versions].sort((a, b) => b.version_number - a.version_number);
        const latestVersion = sortedVersions[0];
        logger.debug(`[resourceFetcher.getWorkflowDetails] Getting details for latest version ${latestVersion.id} (v${latestVersion.version_number}) of workflow ${workflowId}`);
        
        // Call the exported getWorkflowVersion function
        const versionDetails = await getWorkflowVersion(instanceData, latestVersion.id);
        
        if (versionDetails) {
          logger.debug(`[resourceFetcher.getWorkflowDetails] Version details fetched. Has workflow_json: ${!!versionDetails.workflow_json}, Has workflow_data: ${!!versionDetails.workflow_data}`);
          workflowData.workflow_json = versionDetails.workflow_json || versionDetails.workflow_data || {}; // Prefer workflow_json
          
          if (workflowData.workflow_json && workflowData.workflow_json.nodes) {
            logger.debug(`[resourceFetcher.getWorkflowDetails] Workflow JSON contains ${Object.keys(workflowData.workflow_json.nodes).length} nodes`);
          } else {
            logger.debug('[resourceFetcher.getWorkflowDetails] Workflow JSON structure does not contain nodes after fetching version details.');
            // Fallback logic copied from comfyui.js - check version.workflow or workflowData.workflow
             if (versionDetails.workflow && typeof versionDetails.workflow === 'object') {
               workflowData.workflow_json = versionDetails.workflow;
               logger.debug('[resourceFetcher.getWorkflowDetails] Using version.workflow as fallback for workflow_json');
             } else if (workflowData.workflow && typeof workflowData.workflow === 'object') {
               workflowData.workflow_json = workflowData.workflow;
               logger.debug('[resourceFetcher.getWorkflowDetails] Using workflowData.workflow as fallback for workflow_json');
             }
          }
        } else {
          logger.debug(`[resourceFetcher.getWorkflowDetails] Failed to fetch version details for ${latestVersion.id}`);
        }
      } else {
        logger.debug('[resourceFetcher.getWorkflowDetails] No workflow versions available in base details.');
        // Try to find workflow JSON directly in the workflow data
        if (workflowData.workflow && typeof workflowData.workflow === 'object') {
          logger.debug('[resourceFetcher.getWorkflowDetails] Found workflow object directly in workflowData');
          workflowData.workflow_json = workflowData.workflow;
        }
      }
      
      return workflowData;
    } catch (error) {
      logger.error(`[resourceFetcher.getWorkflowDetails] Error getting details for ${workflowId}: ${error.message}`);
      throw error;
    }
}

/**
 * Attempt to fetch a workflow's content/JSON directly from various API endpoints
 * This is a more aggressive approach that tries multiple potential endpoints.
 * 
 * @param {object} instanceData - Data from the ComfyUIService instance.
 * @param {string} instanceData.apiKey
 * @param {object} instanceData.logger
 * @param {object} instanceData.API_ENDPOINTS
 * @param {Function} instanceData._makeApiRequest - Function to make API requests.
 * @param {string} workflowId - The workflow ID
 * @returns {Promise<Object|null>} - Returns workflow JSON structure or null if not found
 */
async function getWorkflowContent(instanceData, workflowId) {
    const { logger, API_ENDPOINTS, _makeApiRequest } = instanceData;
    logger.debug(`[resourceFetcher.getWorkflowContent] Fetching full content for workflow: ${workflowId}`);
    
    if (!workflowId) {
      throw new Error('Workflow ID is required for getWorkflowContent');
    }
    
    const potentialEndpoints = [
      `/api/workflow/${workflowId}`,
      `/api/workflow/${workflowId}/content`,
      `/api/workflow/${workflowId}/json`,
      `/api/workflow/${workflowId}/data`,
      `/api/workflow_content/${workflowId}`,
      `/workflow/${workflowId}/content`,
      `/workflow_content/${workflowId}`,
      `/workflow_json/${workflowId}`,

      `/workflow/${workflowId}`
    ];
    
    let versionIds = [];
    let workflowData = null;
    let fullRawResponse = null; 
    
    for (const endpoint of potentialEndpoints) {
      try {
        logger.debug(`[resourceFetcher.getWorkflowContent] Trying endpoint: ${endpoint}`);
        const response = await _makeApiRequest(endpoint, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          logger.debug(`[resourceFetcher.getWorkflowContent] Endpoint ${endpoint} returned status ${response.status}`);
          continue;
        }
        
        logger.debug(`[resourceFetcher.getWorkflowContent] Got OK response from endpoint: ${endpoint}`);
        const data = await response.json();
        workflowData = data; 
        fullRawResponse = JSON.stringify(data); 

        logger.debug(`[resourceFetcher.getWorkflowContent] Response data keys from ${endpoint}: ${Object.keys(data).join(', ')}`);
        
        // Attempt 1: Try parsing common locations using helper
        let workflowJson = _tryParseWorkflowJson(data, endpoint, logger);
        if (workflowJson) {
          return workflowJson; 
        }

        // Attempt 2: Check versions using helper
        if (data.versions && Array.isArray(data.versions) && data.versions.length > 0) {
            versionIds = data.versions.map(v => v.id);
            logger.debug(`[resourceFetcher.getWorkflowContent] Found ${versionIds.length} version IDs from ${endpoint}: ${versionIds.join(', ')}`);
            
            for (const version of data.versions) {
               workflowJson = _tryParseVersionData(version, logger);
               if (workflowJson) {
                  logger.debug(`[resourceFetcher.getWorkflowContent] Found valid workflow JSON in version ${version.id} data from endpoint ${endpoint}`);
                  return workflowJson; 
               }
            }
            logger.debug(`[resourceFetcher.getWorkflowContent] Checked ${data.versions.length} versions from ${endpoint}, no direct workflow JSON found.`);
        } else {
            logger.debug(`[resourceFetcher.getWorkflowContent] No versions array found in response from ${endpoint}.`);
        }
 
      } catch (error) {
        logger.debug(`[resourceFetcher.getWorkflowContent] Error trying endpoint ${endpoint}: ${error.message}`);
      }
    }
    
    // Fallback: If no direct content found, try getting details (which fetches latest version)
    logger.debug(`[resourceFetcher.getWorkflowContent] Failed to find direct content for ${workflowId}, trying getWorkflowDetails as fallback.`);
    try {
      // We need getWorkflowVersion available here for the details fallback
      const detailsInstanceData = { ...instanceData, getWorkflowVersion: (id) => getWorkflowVersion(instanceData, id) };
      const workflowDetails = await getWorkflowDetails(detailsInstanceData, workflowId);
      
      if (workflowDetails.workflow_json && workflowDetails.workflow_json.nodes) {
        logger.debug('[resourceFetcher.getWorkflowContent] Found workflow JSON via getWorkflowDetails fallback.');
        return workflowDetails.workflow_json;
      }
    } catch (error) {
      logger.error(`[resourceFetcher.getWorkflowContent] Error during getWorkflowDetails fallback: ${error.message}`);
    }

    // Fallback: Save debug file if we had a response at some point
     if (fullRawResponse) {
      try {
        const debugFile = `./debug-workflow-${workflowId}.json`;
        fs.writeFileSync(debugFile, fullRawResponse);
        logger.debug(`[resourceFetcher.getWorkflowContent] Saved full raw response to ${debugFile} for debugging`);
      } catch (error) {
        logger.debug(`[resourceFetcher.getWorkflowContent] Error saving debug file: ${error.message}`);
      }
    } 
    
    logger.error(`[resourceFetcher.getWorkflowContent] Failed to find workflow content for ${workflowId} after trying all methods.`);
    return null;
}

module.exports = {
    getDeployments,
    getWorkflows,
    getMachines,
    getWorkflowVersion,
    getWorkflowDetails,
    getWorkflowContent
}; 