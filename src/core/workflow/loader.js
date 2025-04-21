/**
 * WorkflowLoader - Responsible for loading workflow definitions from the database
 * 
 * This module fetches workflow definitions, validates their structure,
 * and prepares them for registration with the WorkflowManager.
 */

const { AppError } = require('../shared/errors/AppError');

class WorkflowLoader {
  /**
   * Create a new WorkflowLoader instance
   * 
   * @param {Object} options Configuration options
   * @param {Object} options.workflowRepository Repository for workflow data
   * @param {Object} options.logger Logger instance
   */
  constructor({ workflowRepository, logger }) {
    this.repository = workflowRepository;
    this.logger = logger;
  }

  /**
   * Load all workflows from the database
   * 
   * @returns {Promise<Array>} Array of workflow definitions
   */
  async loadAllWorkflows() {
    try {
      this.logger.info('Loading all workflows from database');
      const workflows = await this.repository.findAll();
      this.logger.info(`Found ${workflows.length} workflows in database`);
      return workflows;
    } catch (error) {
      this.logger.error('Failed to load workflows from database', { error });
      throw new AppError('Failed to load workflows from database', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load active workflows
   * 
   * @returns {Promise<Array>} Array of active workflow definitions
   */
  async loadActiveWorkflows() {
    try {
      this.logger.info('Loading active workflows from database');
      const workflows = await this.repository.findActive();
      this.logger.info(`Found ${workflows.length} active workflows in database`);
      return workflows;
    } catch (error) {
      this.logger.error('Failed to load active workflows from database', { error });
      throw new AppError('Failed to load active workflows from database', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load a specific workflow by name
   * 
   * @param {string} name Workflow name
   * @returns {Promise<Object>} Workflow definition
   */
  async loadWorkflowByName(name) {
    try {
      this.logger.info(`Loading workflow by name: ${name}`);
      const workflow = await this.repository.findByName(name);
      
      if (!workflow) {
        throw new AppError(`Workflow not found: ${name}`, 'NOT_FOUND');
      }
      
      return workflow;
    } catch (error) {
      this.logger.error(`Failed to load workflow: ${name}`, { error });
      throw new AppError(`Failed to load workflow: ${name}`, 'DATABASE_ERROR', error);
    }
  }

  /**
   * Load featured workflows
   * 
   * @param {number} limit Maximum number of workflows to load
   * @returns {Promise<Array>} Array of featured workflow definitions
   */
  async loadFeaturedWorkflows(limit = 10) {
    try {
      this.logger.info(`Loading featured workflows (limit: ${limit})`);
      const workflows = await this.repository.findFeatured(limit);
      this.logger.info(`Found ${workflows.length} featured workflows`);
      return workflows;
    } catch (error) {
      this.logger.error('Failed to load featured workflows', { error });
      throw new AppError('Failed to load featured workflows', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Validate a workflow definition
   * 
   * @param {Object} workflow Workflow definition to validate
   * @returns {boolean} True if valid, throws error otherwise
   */
  validateWorkflow(workflow) {
    if (!workflow.name) {
      throw new AppError('Workflow name is required', 'VALIDATION_ERROR');
    }
    
    if (!Array.isArray(workflow.inputs)) {
      throw new AppError('Workflow inputs must be an array', 'VALIDATION_ERROR');
    }
    
    // Additional validation could be added here
    
    return true;
  }

  /**
   * Register a workflow with the workflow manager
   * 
   * @param {Object} workflowManager Workflow manager instance 
   * @param {Object} workflow Workflow definition
   * @returns {boolean} True if registration was successful
   */
  registerWorkflow(workflowManager, workflow) {
    try {
      this.validateWorkflow(workflow);
      
      // Create a standardized workflow definition
      const workflowDefinition = {
        name: workflow.name,
        inputs: workflow.inputs,
        // Add any additional properties needed for the workflow definition
        metadata: {
          comfyIds: workflow.ids,
          layout: workflow.layout
        }
      };
      
      // Register the workflow
      workflowManager.registerWorkflowDefinition(workflow.name, workflowDefinition);
      return true;
    } catch (error) {
      this.logger.error(`Failed to register workflow: ${workflow.name || 'unnamed'}`, { error });
      return false;
    }
  }
}

module.exports = { WorkflowLoader }; 