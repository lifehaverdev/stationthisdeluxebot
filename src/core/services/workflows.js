/**
 * Workflows Service
 * 
 * Manages access to workflow templates and their configurations.
 * Provides interface for ComfyUI Deploy workflow management.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Constants
const DEFAULT_TIMEOUT = 60000; // 60 seconds
const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com/api';

class WorkflowsService {
  /**
   * Initialize Workflows Service
   * 
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - ComfyUI Deploy API URL (optional)
   * @param {string} options.apiKey - ComfyUI Deploy API key (optional)
   * @param {Object} options.cache - Cache configuration (optional)
   * @param {boolean} options.cache.enabled - Whether to enable caching (default: true)
   * @param {number} options.cache.ttl - Cache TTL in milliseconds (default: 5 minutes)
   * @param {Function} options.logger - Logger function (optional)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || COMFY_DEPLOY_API_URL;
    this.apiKey = options.apiKey || process.env.COMFY_DEPLOY_API_KEY;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.logger = options.logger || console.log;
    
    // Caching configuration
    this.cache = {
      enabled: options.cache?.enabled !== false,
      ttl: options.cache?.ttl || 5 * 60 * 1000, // 5 minutes default
      lastUpdated: null,
      workflows: []
    };
    
    // Validate API key
    if (!this.apiKey) {
      this.logger('WARNING: ComfyUI Deploy API key not configured. Service will be inoperable.');
    }
    
    this.isInitialized = false;
    this.isLoading = false;
  }

  /**
   * Initialize the service by loading all workflows
   * 
   * @returns {Promise<Array>} - Loaded workflows
   */
  async initialize() {
    if (this.isLoading) {
      this.logger('Workflows already being loaded');
      return this.cache.workflows;
    }

    this.isLoading = true;
    this.logger('Loading workflows from ComfyUI Deploy...');

    try {
      await this._fetchWorkflows();
      this.isInitialized = true;
      this.logger('Workflows loaded successfully');
      return this.cache.workflows;
    } catch (error) {
      this.logger(`Error initializing workflows: ${error.message}`);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Get all available workflows
   * 
   * @returns {Promise<Array>} - List of all workflows
   */
  async getWorkflows() {
    await this._ensureInitialized();
    
    // Check if cache needs refreshing
    if (this._isCacheStale()) {
      await this._fetchWorkflows();
    }
    
    return this.cache.workflows;
  }

  /**
   * Get a workflow by its name
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object|null>} - Workflow object or null if not found
   */
  async getWorkflowByName(name) {
    const workflows = await this.getWorkflows();
    return workflows.find(flow => flow.name === name) || null;
  }

  /**
   * Get deployment IDs for a specific workflow type
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Array|null>} - Array of deployment IDs or null if not found
   */
  async getDeploymentIdsByName(name) {
    const workflow = await this.getWorkflowByName(name);
    return workflow ? workflow.deploymentIds : null;
  }

  /**
   * Get required inputs for a specific workflow
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Array|null>} - Array of required input names or null if not found
   */
  async getWorkflowInputs(name) {
    const workflow = await this.getWorkflowByName(name);
    return workflow ? workflow.inputs : null;
  }

  /**
   * Check if workflow exists
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<boolean>} - True if workflow exists
   */
  async hasWorkflow(name) {
    return await this.getWorkflowByName(name) !== null;
  }

  /**
   * Get a workflow version by its ID
   * 
   * @param {string} versionId - Workflow version ID
   * @returns {Promise<Object|null>} - Workflow version object or null if not found
   */
  async getWorkflowVersion(versionId) {
    if (!this.apiKey) {
      throw new Error('ComfyUI Deploy API key not configured');
    }

    try {
      const response = await fetch(`${this.apiUrl}/workflow-version/${versionId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch workflow version: ${response.status}, message: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger(`Error fetching workflow version: ${error.message}`);
      return null;
    }
  }

  /**
   * Reload all workflows from the API
   * 
   * @returns {Promise<Array>} - Updated workflows
   */
  async reloadWorkflows() {
    this.isInitialized = false;
    return await this.initialize();
  }

  /**
   * Parse workflow JSON to extract required inputs
   * 
   * @private
   * @param {Object} workflow - Workflow JSON object
   * @returns {Array} - List of required inputs
   */
  _parseWorkflow(workflow) {
    const workflowInputs = [];
    
    try {
      // Parse the workflow JSON if it's a string
      const workflowData = typeof workflow === 'string' ? JSON.parse(workflow) : workflow;
      
      if (workflowData.nodes) {
        // Filter nodes that start with 'ComfyUIDeploy'
        const deployNodes = workflowData.nodes.filter(node => 
          node.type && node.type.startsWith('ComfyUIDeploy'));
  
        deployNodes.forEach(node => {
          if (node.widgets_values && node.widgets_values.length > 0) {
            // Collect relevant inputs from widgets_values
            node.widgets_values.forEach(value => {
              if (typeof value === 'string' && value.startsWith('input_')) {
                workflowInputs.push(value);
              }
            });
          }
        });
      }
    } catch (error) {
      this.logger(`Error parsing workflow: ${error.message}`);
    }
    
    return workflowInputs;
  }

  /**
   * Fetch workflows from ComfyUI Deploy API
   * 
   * @private
   * @returns {Promise<void>}
   */
  async _fetchWorkflows() {
    if (!this.apiKey) {
      throw new Error('ComfyUI Deploy API key not configured');
    }

    try {
      // Fetch deployments from the API
      const response = await fetch(`${this.apiUrl}/deployment`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch deployments: ${response.status}, message: ${errorText}`);
      }

      const deployments = await response.json();
      const workflowMap = new Map();

      // Process each deployment
      for (const deployment of deployments) {
        try {
          // Get the workflow details if it has a workflow version
          if (deployment.workflow_version_id) {
            // Get the workflow version
            const workflowVersion = await this.getWorkflowVersion(deployment.workflow_version_id);
            
            if (workflowVersion && workflowVersion.workflow) {
              // Parse the inputs from the workflow
              const inputs = this._parseWorkflow(workflowVersion.workflow);
              
              // Get or create the workflow entry
              const workflowName = deployment.name || `workflow_${deployment.id}`;
              const existingWorkflow = workflowMap.get(workflowName);
              
              if (existingWorkflow) {
                // Add deployment ID to existing workflow
                existingWorkflow.deploymentIds.push(deployment.id);
              } else {
                // Create new workflow entry
                workflowMap.set(workflowName, {
                  name: workflowName,
                  deploymentIds: [deployment.id],
                  inputs: inputs,
                  workflowId: workflowVersion.workflow_id,
                  versionId: deployment.workflow_version_id,
                  metadata: {
                    description: deployment.description || '',
                    createdAt: deployment.created_at,
                    updatedAt: deployment.updated_at
                  }
                });
              }
            }
          }
        } catch (error) {
          this.logger(`Error processing deployment ${deployment.id}: ${error.message}`);
        }
      }

      // Update cache
      this.cache.workflows = Array.from(workflowMap.values());
      this.cache.lastUpdated = Date.now();
      
      this.logger(`Loaded ${this.cache.workflows.length} workflows from ComfyUI Deploy`);
    } catch (error) {
      this.logger(`Error fetching workflows: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if cache is stale and needs refreshing
   * 
   * @private
   * @returns {boolean} - True if cache is stale
   */
  _isCacheStale() {
    if (!this.cache.enabled) {
      return true;
    }
    
    if (!this.cache.lastUpdated) {
      return true;
    }
    
    return (Date.now() - this.cache.lastUpdated) > this.cache.ttl;
  }

  /**
   * Ensure the service has been initialized
   * 
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If service not initialized
   */
  async _ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}

module.exports = WorkflowsService; 