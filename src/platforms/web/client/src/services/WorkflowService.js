/**
 * WorkflowService
 * 
 * Handles all API interactions for workflow operations in the web client.
 * Integrates with server-side services for workflow execution, configuration,
 * and result management.
 */

import { EventBus } from '../stores/EventBus.js';

export class WorkflowService {
  constructor() {
    this.apiBase = '/api';
    this.endpoints = {
      WORKFLOWS: '/workflows',
      WORKFLOW_EXECUTE: '/workflows/execute',
      WORKFLOW_CONFIG: '/workflows/config',
      WORKFLOW_TYPES: '/workflows/types',
      POINTS_CHECK: '/points/check',
      POINTS_DEDUCT: '/points/deduct'
    };
  }

  /**
   * Get the authentication token from localStorage
   * @returns {string|null} Auth token or null if not authenticated
   * @private
   */
  _getAuthToken() {
    return localStorage.getItem('auth_token');
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Response data
   * @private
   */
  async _apiRequest(endpoint, options = {}) {
    const token = this._getAuthToken();
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    
    const fetchOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...(options.headers || {})
      }
    };
    
    try {
      const response = await fetch(`${this.apiBase}${endpoint}`, fetchOptions);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      EventBus.publish('notification', {
        type: 'error',
        message: `API Error: ${error.message}`
      });
      throw error;
    }
  }
  
  /**
   * Get available workflow types
   * @returns {Promise<Array>} List of workflow types
   */
  async getWorkflowTypes() {
    try {
      const response = await this._apiRequest(this.endpoints.WORKFLOW_TYPES, {
        method: 'GET'
      });
      return response.data || [];
    } catch (error) {
      console.error('Failed to fetch workflow types:', error);
      return [];
    }
  }
  
  /**
   * Get workflow configuration options
   * @param {string} workflowType - Type of workflow
   * @returns {Promise<Object>} Workflow configuration
   */
  async getWorkflowConfig(workflowType) {
    return await this._apiRequest(`${this.endpoints.WORKFLOW_CONFIG}/${workflowType}`, {
      method: 'GET'
    });
  }
  
  /**
   * Execute a workflow
   * @param {Object} options - Execution options
   * @param {string} options.workflowType - Type of workflow to execute
   * @param {Object} options.parameters - Workflow parameters
   * @param {string} options.tileId - ID of the tile executing the workflow
   * @param {Object} options.inputData - Optional input data from connected tiles
   * @returns {Promise<Object>} Workflow execution result
   */
  async executeWorkflow({ workflowType, parameters, tileId, inputData = {} }) {
    // First check if user has enough points
    const pointCost = await this.calculatePointCost(workflowType, parameters);
    
    const hasPoints = await this.checkPointBalance(pointCost);
    if (!hasPoints) {
      throw new Error(`Not enough points. This workflow requires ${pointCost} points.`);
    }
    
    // Execute the workflow
    const result = await this._apiRequest(this.endpoints.WORKFLOW_EXECUTE, {
      method: 'POST',
      body: JSON.stringify({
        workflowType,
        parameters,
        tileId,
        platform: 'web',
        inputData
      })
    });
    
    // Deduct points after successful execution
    await this.deductPoints(pointCost, {
      workflowType,
      tileId,
      executionId: result.executionId
    });
    
    return result;
  }
  
  /**
   * Calculate point cost for workflow execution
   * @param {string} workflowType - Type of workflow
   * @param {Object} parameters - Workflow parameters
   * @returns {Promise<number>} Point cost
   */
  async calculatePointCost(workflowType, parameters) {
    try {
      const response = await this._apiRequest(`${this.endpoints.POINTS_CHECK}`, {
        method: 'POST',
        body: JSON.stringify({
          workflowType,
          parameters
        })
      });
      
      return response.cost || 0;
    } catch (error) {
      console.error('Failed to calculate point cost:', error);
      return 0;
    }
  }
  
  /**
   * Check if user has enough points for an operation
   * @param {number} cost - Point cost
   * @returns {Promise<boolean>} Whether user has enough points
   */
  async checkPointBalance(cost) {
    try {
      const response = await this._apiRequest(`${this.endpoints.POINTS_CHECK}/balance`, {
        method: 'POST',
        body: JSON.stringify({ cost })
      });
      
      return response.hasEnough || false;
    } catch (error) {
      console.error('Failed to check point balance:', error);
      return false;
    }
  }
  
  /**
   * Deduct points for workflow execution
   * @param {number} amount - Points to deduct
   * @param {Object} metadata - Transaction metadata
   * @returns {Promise<Object>} Updated point balance
   */
  async deductPoints(amount, metadata = {}) {
    return await this._apiRequest(this.endpoints.POINTS_DEDUCT, {
      method: 'POST',
      body: JSON.stringify({
        amount,
        source: 'workflow_execution',
        metadata
      })
    });
  }
  
  /**
   * Save workflow result to collection
   * @param {Object} result - Workflow result
   * @param {string} collectionId - Collection ID or 'new' to create a new collection
   * @returns {Promise<Object>} Saved result information
   */
  async saveToCollection(result, collectionId = 'new') {
    return await this._apiRequest('/collections/add', {
      method: 'POST',
      body: JSON.stringify({
        item: result,
        collectionId
      })
    });
  }
}

// Create singleton instance
export const workflowService = new WorkflowService(); 