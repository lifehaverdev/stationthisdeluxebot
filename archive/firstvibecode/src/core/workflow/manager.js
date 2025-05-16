/**
 * Workflow Manager
 * 
 * Manages workflow instances and their lifecycle.
 * Provides methods for creating, retrieving, and processing workflows.
 */

const { WorkflowState } = require('./state');
const { AppError } = require('../shared/errors/AppError');
const { getWorkflowService } = require('../../services/comfydeploy/WorkflowService');

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
   * Get all workflow definitions
   * @returns {Object} Map of all workflow definitions
   */
  getWorkflowDefinitions() {
    // Convert Map to a plain object for easier serialization
    const definitions = {};
    this.workflowDefinitions.forEach((value, key) => {
      definitions[key] = value;
    });
    return definitions;
  }

  /**
   * Synchronize workflow definitions with the WorkflowService
   * This ensures that both the WorkflowManager and WorkflowService
   * have the same workflow definitions available.
   * 
   * @param {boolean} [bidirectional=true] - If true, synchronize in both directions
   * @returns {Promise<Object>} Result with counts of synchronized workflows
   */
  async synchronizeWithWorkflowService(bidirectional = true) {
    try {
      const { comfyDeployService } = require('../../services/comfydeploy/service');
      const workflowService = getWorkflowService();
      let managerToServiceCount = 0;
      let serviceToManagerCount = 0;
      
      // Step 1: Get all workflow definitions from both sources
      const managerWorkflows = this.getWorkflowDefinitions();
      const serviceWorkflows = workflowService ? workflowService.getAllWorkflows() || [] : [];
      
      // Step 2: Sync manager workflows to service (if missing)
      if (bidirectional) {
        const serviceWorkflowNames = serviceWorkflows.map(w => w.name);
        
        for (const [name, workflow] of Object.entries(managerWorkflows)) {
          if (!serviceWorkflowNames.includes(name)) {
            if (comfyDeployService && typeof comfyDeployService.registerExternalWorkflow === 'function') {
              // Use the direct registration method if available
              const registered = comfyDeployService.registerExternalWorkflow({
                name: workflow.name || name,
                inputs: workflow.inputs || [],
                active: workflow.active !== false
              });
              
              if (registered) {
                managerToServiceCount++;
                this.logger.info(`Registered workflow from manager to service: ${name}`);
              }
            } else if (workflowService) {
              // Otherwise add to service's workflow array
              serviceWorkflows.push({
                name: workflow.name || name,
                inputs: workflow.inputs || [],
                active: workflow.active !== false
              });
              managerToServiceCount++;
              this.logger.info(`Synchronized workflow from manager to service: ${name}`);
            }
          }
        }
      }
      
      // Step 3: Sync service workflows to manager (always do this)
      for (const workflow of serviceWorkflows) {
        const workflowName = workflow.name;
        if (!this.workflowDefinitions.has(workflowName)) {
          this.registerWorkflowDefinition(workflowName, workflow);
          serviceToManagerCount++;
          this.logger.info(`Synchronized workflow from service to manager: ${workflowName}`);
        }
      }
      
      this.logger.info('Workflow synchronization completed', {
        managerToService: managerToServiceCount,
        serviceToManager: serviceToManagerCount,
        bidirectional
      });
      
      return {
        success: true,
        managerToService: managerToServiceCount,
        serviceToManager: serviceToManagerCount
      };
    } catch (error) {
      this.logger.error('Failed to synchronize workflows', { error });
      return { 
        success: false, 
        error: error.message,
        managerToService: 0,
        serviceToManager: 0
      };
    }
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

  /**
   * Get diagnostic information about workflow registrations
   * Shows which workflows are registered in which services
   * 
   * @returns {Promise<Object>} Diagnostic information
   */
  async getDiagnostics() {
    try {
      const workflowService = getWorkflowService();
      const managerWorkflows = this.getWorkflowDefinitions();
      
      // Create a map of all workflow names from both sources
      const allWorkflowNames = new Set();
      
      // Add workflow names from manager
      Object.keys(managerWorkflows).forEach(name => allWorkflowNames.add(name));
      
      // Add workflow names from service
      if (workflowService) {
        const serviceWorkflows = workflowService.getAllWorkflows() || [];
        serviceWorkflows.forEach(workflow => allWorkflowNames.add(workflow.name));
      }
      
      // Create diagnostic entries for each workflow
      const workflows = Array.from(allWorkflowNames).map(name => {
        const inManager = !!managerWorkflows[name];
        const inService = workflowService ? 
          !!workflowService.getWorkflowByName(name) : 
          false;
        
        return {
          name,
          inManager,
          inService,
          status: inManager && inService ? 'synchronized' : 
                 inManager ? 'manager-only' :
                 inService ? 'service-only' : 'unknown'
        };
      });
      
      const diagnostics = {
        timestamp: new Date(),
        workflowCount: workflows.length,
        managerCount: Object.keys(managerWorkflows).length,
        serviceCount: workflowService ? 
          (workflowService.getAllWorkflows() || []).length : 
          0,
        serviceAvailable: !!workflowService,
        workflows: workflows,
        summary: {
          synchronized: workflows.filter(w => w.status === 'synchronized').length,
          managerOnly: workflows.filter(w => w.status === 'manager-only').length,
          serviceOnly: workflows.filter(w => w.status === 'service-only').length
        }
      };
      
      this.logger.debug('Workflow diagnostics generated', {
        workflowCount: diagnostics.workflowCount,
        synchronized: diagnostics.summary.synchronized
      });
      
      return diagnostics;
    } catch (error) {
      this.logger.error('Failed to generate workflow diagnostics', { error });
      return {
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

module.exports = {
  WorkflowManager
}; 