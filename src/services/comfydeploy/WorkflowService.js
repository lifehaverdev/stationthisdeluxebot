/**
 * WorkflowService
 * 
 * Provides a service layer for managing ComfyDeploy workflows.
 * Handles loading workflows from the database, caching them, and providing
 * access to them for the ComfyDeploy adapter and internal API.
 */

const WorkflowRepository = require('../../db/models/workflows');
const { loadWorkflows } = require('./workflowLoader');
const { Logger } = require('../../utils/logger');
const eventBus = require('../../core/shared/events').default;

/**
 * Workflow Service for managing ComfyDeploy workflows
 */
class WorkflowService {
  /**
   * Create a new WorkflowService
   * @param {Object} options - Service options
   * @param {number} [options.cacheRefreshInterval=3600000] - Cache refresh interval in ms (default: 1 hour)
   * @param {Logger} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.workflows = [];
    this.workflowRepository = new WorkflowRepository();
    this.lastRefresh = 0;
    this.refreshInterval = options.cacheRefreshInterval || 3600000; // 1 hour
    this.isRefreshing = false;
    this.logger = options.logger || new Logger({
      level: process.env.LOG_LEVEL || 'info',
      name: 'workflowService'
    });
  }

  /**
   * Initialize the workflow service
   * @returns {Promise<void>}
   */
  async initialize() {
    this.logger.info('Initializing workflow service');
    await this.refreshWorkflows();
    
    // Setup refresh interval
    this._setupRefreshInterval();
    
    this.logger.info('Workflow service initialized successfully', {
      workflowCount: this.workflows.length
    });
    
    // Publish event for monitoring
    eventBus.publish('workflows:initialized', {
      timestamp: new Date(),
      count: this.workflows.length
    });
  }

  /**
   * Set up the refresh interval for workflows
   * @private
   */
  _setupRefreshInterval() {
    // Clear any existing interval
    if (this._refreshIntervalId) {
      clearInterval(this._refreshIntervalId);
    }
    
    // Set up new interval
    this._refreshIntervalId = setInterval(async () => {
      try {
        await this.refreshWorkflows();
      } catch (error) {
        this.logger.error('Error refreshing workflows on interval', { error });
      }
    }, this.refreshInterval);
    
    // Make sure it doesn't prevent the process from exiting
    this._refreshIntervalId.unref();
  }

  /**
   * Refresh workflows from the database
   * @returns {Promise<boolean>} - True if workflows were refreshed
   */
  async refreshWorkflows() {
    // Prevent concurrent refreshes
    if (this.isRefreshing) {
      this.logger.debug('Skipping workflow refresh - already in progress');
      return false;
    }
    
    this.isRefreshing = true;
    
    try {
      this.logger.info('Refreshing workflows from database');
      
      // Load workflows using the loader
      const freshWorkflows = await loadWorkflows();
      
      if (freshWorkflows && freshWorkflows.length > 0) {
        this.workflows = freshWorkflows;
        this.lastRefresh = Date.now();
        
        this.logger.info('Workflows refreshed successfully', {
          count: this.workflows.length,
          timestamp: new Date(this.lastRefresh)
        });
        
        // Publish event for monitoring
        eventBus.publish('workflows:refreshed', {
          timestamp: new Date(),
          count: this.workflows.length
        });
        
        return true;
      } else {
        this.logger.warn('No workflows found in database during refresh');
        
        // Only clear workflows if we're sure the database is empty
        // This prevents losing workflows if there's a temporary database connection issue
        const exists = await this.workflowRepository.exists({});
        if (!exists) {
          this.workflows = [];
        }
        
        return false;
      }
    } catch (error) {
      this.logger.error('Error refreshing workflows', { error });
      
      // Publish error event
      eventBus.publish('workflows:refreshError', {
        timestamp: new Date(),
        error: error.message
      });
      
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Get all workflows
   * @returns {Array} - Array of workflows
   */
  getAllWorkflows() {
    return this.workflows;
  }

  /**
   * Get a workflow by name
   * @param {string} name - Workflow name
   * @returns {Object|null} - Workflow object or null if not found
   */
  getWorkflowByName(name) {
    return this.workflows.find(workflow => workflow.name === name) || null;
  }

  /**
   * Check if workflows need to be refreshed and do so if needed
   * @returns {Promise<boolean>} - True if workflows were refreshed
   */
  async checkAndRefreshIfNeeded() {
    const now = Date.now();
    
    // If it's been longer than the refresh interval, refresh workflows
    if (now - this.lastRefresh > this.refreshInterval) {
      this.logger.info('Workflow refresh interval reached, refreshing workflows');
      return await this.refreshWorkflows();
    }
    
    return false;
  }
  
  /**
   * Get service statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      workflowCount: this.workflows.length,
      lastRefresh: this.lastRefresh ? new Date(this.lastRefresh) : null,
      isRefreshing: this.isRefreshing,
      refreshInterval: this.refreshInterval
    };
  }
  
  /**
   * Shutdown the service
   */
  shutdown() {
    if (this._refreshIntervalId) {
      clearInterval(this._refreshIntervalId);
      this._refreshIntervalId = null;
    }
    
    this.logger.info('Workflow service shut down');
  }
}

// Create a singleton instance
let serviceInstance = null;

/**
 * Get the singleton instance of the WorkflowService
 * @param {Object} options - Service options
 * @returns {WorkflowService} The singleton instance
 */
function getWorkflowService(options = {}) {
  if (!serviceInstance) {
    serviceInstance = new WorkflowService(options);
  }
  return serviceInstance;
}

module.exports = {
  WorkflowService,
  getWorkflowService
}; 