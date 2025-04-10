/**
 * Workflow Manager
 * 
 * Manages workflow instances and their lifecycle.
 * Provides methods for creating, retrieving, and processing workflows.
 */

const { WorkflowState } = require('./state');
const { AppError } = require('../shared/errors/AppError');

/**
 * WorkflowManager class
 * 
 * Central manager for all workflow instances in the system.
 */
class WorkflowManager {
  /**
   * Create a new WorkflowManager
   * @param {Object} options - Options
   * @param {Object} options.sessionManager - Session manager for persisting workflows
   * @param {Object} options.logger - Logger instance
   */
  constructor({ sessionManager, logger }) {
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.workflowDefinitions = new Map();
  }

  /**
   * Register a workflow definition
   * @param {string} id - Workflow ID
   * @param {Object} definition - Workflow definition
   * @returns {boolean} Success status
   */
  registerWorkflowDefinition(id, definition) {
    if (this.workflowDefinitions.has(id)) {
      this.logger.warn(`Workflow definition '${id}' already exists. Overwriting.`);
    }
    
    this.workflowDefinitions.set(id, definition);
    this.logger.debug(`Registered workflow definition: ${id}`);
    return true;
  }

  /**
   * Get a workflow definition
   * @param {string} id - Workflow ID
   * @returns {Object|null} Workflow definition or null if not found
   */
  getWorkflowDefinition(id) {
    return this.workflowDefinitions.get(id) || null;
  }

  /**
   * Start a new workflow instance
   * @param {string} userId - User ID
   * @param {string} workflowId - Workflow definition ID
   * @param {Object} [context={}] - Initial context
   * @returns {Promise<Object|null>} Workflow instance or null if failed
   */
  async startWorkflow(userId, workflowId, context = {}) {
    try {
      const definition = this.getWorkflowDefinition(workflowId);
      if (!definition) {
        throw new AppError(`Workflow definition '${workflowId}' not found`, 'WORKFLOW_NOT_FOUND');
      }

      // Create the workflow state
      const workflowState = new WorkflowState(definition, {
        userId,
        workflowId,
        startedAt: Date.now(),
        ...context
      });

      // Process initial step
      const initialStepId = definition.initialStep;
      if (!initialStepId) {
        throw new AppError('Workflow has no initial step', 'INVALID_WORKFLOW');
      }

      // Initialize workflow with first step
      const firstStep = definition.steps[initialStepId];
      if (!firstStep) {
        throw new AppError(`Initial step '${initialStepId}' not found`, 'INVALID_WORKFLOW');
      }

      // Set current step
      workflowState.setCurrentStep(initialStepId);

      // Save the workflow in user session
      await this.sessionManager.updateUserData(userId, {
        workflows: {
          [workflowId]: workflowState.serialize()
        }
      });

      this.logger.info(`Started workflow: ${workflowId} for user: ${userId}`);
      return workflowState;
    } catch (error) {
      this.logger.error(`Failed to start workflow: ${workflowId}`, { error });
      throw error;
    }
  }

  /**
   * Get a workflow instance
   * @param {string} userId - User ID
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object|null>} Workflow instance or null if not found
   */
  async getWorkflow(userId, workflowId) {
    try {
      const userData = await this.sessionManager.getUserData(userId);
      if (!userData || !userData.workflows || !userData.workflows[workflowId]) {
        return null;
      }

      const serializedWorkflow = userData.workflows[workflowId];
      const definition = this.getWorkflowDefinition(workflowId);
      if (!definition) {
        this.logger.warn(`Workflow definition '${workflowId}' not found for existing workflow`);
        return null;
      }

      return WorkflowState.deserialize(serializedWorkflow, definition);
    } catch (error) {
      this.logger.error(`Failed to get workflow: ${workflowId}`, { error });
      return null;
    }
  }

  /**
   * Process a workflow step
   * @param {string} userId - User ID
   * @param {string} workflowId - Workflow ID
   * @param {string|Object} input - Step input
   * @returns {Promise<Object|null>} Updated workflow instance or null if failed
   */
  async processWorkflowStep(userId, workflowId, input) {
    try {
      const workflow = await this.getWorkflow(userId, workflowId);
      if (!workflow) {
        throw new AppError(`Workflow '${workflowId}' not found for user: ${userId}`, 'WORKFLOW_NOT_FOUND');
      }

      // Get current step
      const currentStepId = workflow.getCurrentStepId();
      if (!currentStepId) {
        throw new AppError('Workflow has no current step', 'INVALID_WORKFLOW_STATE');
      }

      // Process the step
      const updatedWorkflow = await workflow.processStep(input);
      
      // Save the updated workflow
      await this.sessionManager.updateUserData(userId, {
        workflows: {
          [workflowId]: updatedWorkflow.serialize()
        }
      });

      this.logger.debug(`Processed workflow step: ${currentStepId} for workflow: ${workflowId}`);
      return updatedWorkflow;
    } catch (error) {
      this.logger.error(`Failed to process workflow step for workflow: ${workflowId}`, { error });
      throw error;
    }
  }

  /**
   * End a workflow instance
   * @param {string} userId - User ID
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<boolean>} Success status
   */
  async endWorkflow(userId, workflowId) {
    try {
      const userData = await this.sessionManager.getUserData(userId);
      if (!userData || !userData.workflows || !userData.workflows[workflowId]) {
        return false;
      }

      // Create a new workflows object without the removed workflow
      const { [workflowId]: removed, ...remainingWorkflows } = userData.workflows;
      
      // Update user data
      await this.sessionManager.updateUserData(userId, {
        workflows: remainingWorkflows
      });

      this.logger.info(`Ended workflow: ${workflowId} for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to end workflow: ${workflowId}`, { error });
      return false;
    }
  }

  /**
   * Get all active workflows for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object[]>} Array of workflow instances
   */
  async getUserWorkflows(userId) {
    try {
      const userData = await this.sessionManager.getUserData(userId);
      if (!userData || !userData.workflows) {
        return [];
      }

      const workflows = [];
      for (const [workflowId, serializedWorkflow] of Object.entries(userData.workflows)) {
        const definition = this.getWorkflowDefinition(workflowId);
        if (definition) {
          workflows.push(WorkflowState.deserialize(serializedWorkflow, definition));
        }
      }

      return workflows;
    } catch (error) {
      this.logger.error(`Failed to get user workflows for user: ${userId}`, { error });
      return [];
    }
  }
}

module.exports = {
  WorkflowManager
}; 