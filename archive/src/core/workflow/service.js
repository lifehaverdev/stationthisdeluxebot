/**
 * Workflow Service
 * 
 * Manages workflow persistence and orchestrates workflow operations.
 */

const WorkflowEngine = require('./engine');

class WorkflowService {
  /**
   * Create a new workflow service
   * 
   * @param {Object} options - Service options
   * @param {Object} options.workflowRepository - Repository for workflow persistence
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    if (!options.workflowRepository) {
      throw new Error('workflowRepository is required');
    }
    
    this.repository = options.workflowRepository;
    this.logger = options.logger || {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {}
    };
    
    // Create workflow engine
    this.engine = new WorkflowEngine({
      logger: this.logger
    });
  }
  
  /**
   * Register a workflow type with the engine
   * 
   * @param {Object} workflowDefinition - The workflow definition
   */
  registerWorkflowType(workflowDefinition) {
    this.engine.registerWorkflow(workflowDefinition);
  }
  
  /**
   * Create a new workflow instance
   * 
   * @param {string} workflowType - Type of workflow to create
   * @param {string} userId - User ID associated with the workflow
   * @param {Object} [initialData={}] - Initial workflow data
   * @returns {Object} The created workflow
   */
  async createWorkflow(workflowType, userId, initialData = {}) {
    let workflow;
    
    try {
      // Create the workflow instance
      workflow = this.engine.createWorkflow(workflowType, userId, initialData);
      
      // Save the workflow to the repository
      await this.repository.save(workflow.serialize());
      
      return workflow;
    } catch (error) {
      if (error.message.includes('Unknown workflow type')) {
        throw error;
      }
      
      this.logger.error('Error saving workflow', {
        error,
        workflowId: workflow ? workflow.id : undefined,
        userId,
        workflowType
      });
      
      throw new Error(`Failed to save workflow: ${error.message}`);
    }
  }
  
  /**
   * Get a workflow by ID
   * 
   * @param {string} workflowId - ID of the workflow to retrieve
   * @returns {Object|null} The workflow or null if not found
   */
  async getWorkflow(workflowId) {
    try {
      // Get the workflow data from the repository
      const workflowData = await this.repository.findById(workflowId);
      
      if (!workflowData) {
        return null;
      }
      
      // Hydrate the workflow with the engine
      const workflow = this.engine.hydrateWorkflow(workflowData);
      
      return workflow;
    } catch (error) {
      this.logger.error('Error hydrating workflow', {
        error,
        workflowId
      });
      
      throw new Error(`Error hydrating workflow ${workflowId}: ${error.message}`);
    }
  }
  
  /**
   * Get all workflows for a user
   * 
   * @param {string} userId - User ID to get workflows for
   * @returns {Array<Object>} List of workflows
   */
  async getWorkflowsForUser(userId) {
    try {
      // Get workflow data from the repository
      const workflowsData = await this.repository.findByUserId(userId);
      
      if (!workflowsData.length) {
        return [];
      }
      
      // Hydrate each workflow
      const workflows = [];
      
      for (const workflowData of workflowsData) {
        try {
          const workflow = this.engine.hydrateWorkflow(workflowData);
          workflows.push(workflow);
        } catch (error) {
          this.logger.warn('Failed to hydrate workflow', {
            workflowId: workflowData.id,
            userId,
            error: error.message
          });
        }
      }
      
      return workflows;
    } catch (error) {
      this.logger.error('Error getting workflows for user', {
        error,
        userId
      });
      
      throw new Error(`Failed to get workflows for user: ${error.message}`);
    }
  }
  
  /**
   * Get workflows of a specific type for a user
   * 
   * @param {string} userId - User ID to get workflows for
   * @param {string} workflowType - Type of workflow to filter by
   * @returns {Array<Object>} List of workflows
   */
  async getWorkflowsForUserByType(userId, workflowType) {
    try {
      // Get workflow data from the repository
      const workflowsData = await this.repository.findByUserIdAndType(userId, workflowType);
      
      if (!workflowsData.length) {
        return [];
      }
      
      // Hydrate each workflow
      const workflows = [];
      
      for (const workflowData of workflowsData) {
        try {
          const workflow = this.engine.hydrateWorkflow(workflowData);
          workflows.push(workflow);
        } catch (error) {
          this.logger.warn('Failed to hydrate workflow', {
            workflowId: workflowData.id,
            userId,
            workflowType,
            error: error.message
          });
        }
      }
      
      return workflows;
    } catch (error) {
      this.logger.error('Error getting workflows for user by type', {
        error,
        userId,
        workflowType
      });
      
      throw new Error(`Failed to get workflows for user by type: ${error.message}`);
    }
  }
  
  /**
   * Get active (non-completed) workflows for a user
   * 
   * @param {string} userId - User ID to get workflows for
   * @returns {Array<Object>} List of active workflows
   */
  async getActiveWorkflowsForUser(userId) {
    try {
      // Get workflow data from the repository
      const workflowsData = await this.repository.findActive(userId);
      
      if (!workflowsData.length) {
        return [];
      }
      
      // Hydrate each workflow and filter out completed ones
      const workflows = [];
      
      for (const workflowData of workflowsData) {
        try {
          const workflow = this.engine.hydrateWorkflow(workflowData);
          
          // Only include non-completed workflows
          if (!workflow.isComplete()) {
            workflows.push(workflow);
          }
        } catch (error) {
          this.logger.warn('Failed to hydrate workflow', {
            workflowId: workflowData.id,
            userId,
            error: error.message
          });
        }
      }
      
      return workflows;
    } catch (error) {
      this.logger.error('Error getting active workflows for user', {
        error,
        userId
      });
      
      throw new Error(`Failed to get active workflows for user: ${error.message}`);
    }
  }
  
  /**
   * Process the current step of a workflow
   * 
   * @param {string} workflowId - ID of the workflow to process
   * @returns {Object} Result of step processing
   */
  async processWorkflowStep(workflowId) {
    let workflow;
    
    try {
      // Get the workflow
      workflow = await this.getWorkflow(workflowId);
      
      if (!workflow) {
        throw new Error('Workflow not found');
      }
      
      // Process the current step
      const result = await workflow.processStep();
      
      // Save the updated workflow
      await this.repository.save(workflow.serialize());
      
      return result;
    } catch (error) {
      if (error.message === 'Workflow not found') {
        throw error;
      }
      
      this.logger.error('Error processing workflow step', {
        error,
        workflowId
      });
      
      throw new Error(`Error processing workflow step: ${error.message}`);
    }
  }
  
  /**
   * Process user input for a workflow
   * 
   * @param {string} workflowId - ID of the workflow to process input for
   * @param {*} input - User input to process
   * @returns {Object} Result of input processing
   */
  async processWorkflowInput(workflowId, input) {
    if (input === undefined) {
      throw new Error('Input is required');
    }
    
    let workflow;
    
    try {
      // Get the workflow
      workflow = await this.getWorkflow(workflowId);
      
      if (!workflow) {
        throw new Error('Workflow not found');
      }
      
      // Process the input
      const result = await workflow.processInput(input);
      
      // Save the updated workflow
      await this.repository.save(workflow.serialize());
      
      return result;
    } catch (error) {
      if (error.message === 'Workflow not found' || 
          error.message === 'Input is required') {
        throw error;
      }
      
      this.logger.error('Error processing workflow input', {
        error,
        workflowId,
        input
      });
      
      throw new Error(`Error processing workflow input: ${error.message}`);
    }
  }
  
  /**
   * Save a workflow to the repository
   * 
   * @param {Object} workflow - The workflow to save
   */
  async saveWorkflow(workflow) {
    try {
      const serialized = workflow.serialize();
      await this.repository.save(serialized);
    } catch (error) {
      this.logger.error('Error saving workflow', {
        error,
        workflowId: workflow.id
      });
      
      throw new Error(`Failed to save workflow: ${error.message}`);
    }
  }
  
  /**
   * Delete a workflow from the repository
   * 
   * @param {string} workflowId - ID of the workflow to delete
   * @returns {boolean} True if workflow was deleted
   */
  async deleteWorkflow(workflowId) {
    try {
      const result = await this.repository.deleteById(workflowId);
      
      if (result) {
        this.logger.info('Workflow deleted', { workflowId });
      }
      
      return result;
    } catch (error) {
      this.logger.error('Error deleting workflow', {
        error,
        workflowId
      });
      
      throw new Error(`Failed to delete workflow: ${error.message}`);
    }
  }
  
  /**
   * Get list of available workflow types
   * 
   * @returns {Array<string>} List of workflow type identifiers
   */
  getAvailableWorkflowTypes() {
    return this.engine.listWorkflowTypes();
  }
}

module.exports = WorkflowService; 