/**
 * Workflow Engine
 * 
 * Responsible for registering workflow types and creating workflow instances.
 */

const { v4: uuidv4 } = require('uuid');
const WorkflowModel = require('./model');

class WorkflowEngine {
  /**
   * Create a new WorkflowEngine
   * 
   * @param {Object} options
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.workflowTypes = new Map();
    this.logger = options.logger || {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {}
    };
  }

  /**
   * Register a new workflow type
   * 
   * @param {Object} workflowDefinition - The workflow definition
   * @param {string} workflowDefinition.type - The unique workflow type identifier
   * @param {string} workflowDefinition.initialStep - The initial step of the workflow
   * @param {Object} workflowDefinition.steps - The workflow steps
   * @throws {Error} If required properties are missing
   */
  registerWorkflow(workflowDefinition) {
    if (!workflowDefinition.type) {
      throw new Error('Workflow type is required');
    }

    if (!workflowDefinition.steps) {
      throw new Error('Workflow steps are required');
    }

    if (!workflowDefinition.initialStep) {
      throw new Error('Initial step is required');
    }

    const type = workflowDefinition.type;
    const alreadyExists = this.workflowTypes.has(type);

    this.workflowTypes.set(type, workflowDefinition);
    
    if (alreadyExists) {
      this.logger.warn(`Workflow type "${type}" was overridden`, { type });
    } else {
      this.logger.info(`Registered workflow type "${type}"`, { type });
    }
  }

  /**
   * Get a workflow type definition
   * 
   * @param {string} type - The workflow type to get
   * @returns {Object|null} The workflow definition or null if not found
   */
  getWorkflowType(type) {
    // Case-insensitive lookup
    const normalizedType = type.toLowerCase();
    
    for (const [key, definition] of this.workflowTypes.entries()) {
      if (key.toLowerCase() === normalizedType) {
        return definition;
      }
    }
    
    return null;
  }

  /**
   * List all registered workflow types
   * 
   * @returns {string[]} Array of workflow type identifiers
   */
  listWorkflowTypes() {
    return Array.from(this.workflowTypes.keys());
  }

  /**
   * Create a new workflow instance
   * 
   * @param {string} workflowType - The type of workflow to create
   * @param {string} userId - The user ID associated with this workflow
   * @param {Object} [initialData={}] - Initial data for the workflow
   * @returns {WorkflowModel} The created workflow instance
   * @throws {Error} If workflow type is not found or userId is not provided
   */
  createWorkflow(workflowType, userId, initialData = {}) {
    if (!workflowType) {
      throw new Error('Workflow type is required');
    }
    
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const definition = this.getWorkflowType(workflowType);
    
    if (!definition) {
      throw new Error(`Unknown workflow type "${workflowType}"`);
    }
    
    const workflow = new WorkflowModel({
      definition,
      userId,
      id: uuidv4(),
      data: initialData,
      currentStep: definition.initialStep,
      logger: this.logger
    });
    
    this.logger.info(`Created new workflow instance of type "${workflowType}"`, {
      workflowId: workflow.id,
      userId,
      workflowType
    });
    
    return workflow;
  }

  /**
   * Hydrate a workflow from stored data
   * 
   * @param {Object} data - The workflow data
   * @returns {WorkflowModel} The hydrated workflow
   * @throws {Error} If workflow type definition is not found
   */
  hydrateWorkflow(data) {
    if (!data.workflowType) {
      throw new Error('Workflow type is required in workflow data');
    }
    
    const definition = this.getWorkflowType(data.workflowType);
    
    if (!definition) {
      throw new Error(`Unknown workflow type "${data.workflowType}"`);
    }
    
    // Parse dates if they're stored as strings
    const createdAt = typeof data.createdAt === 'string' 
      ? new Date(data.createdAt) 
      : data.createdAt;
    
    const updatedAt = typeof data.updatedAt === 'string' 
      ? new Date(data.updatedAt) 
      : data.updatedAt;
    
    const workflow = new WorkflowModel({
      definition,
      id: data.id,
      userId: data.userId,
      currentStep: data.currentStep,
      data: data.data || {},
      history: data.history || [],
      createdAt,
      updatedAt,
      logger: this.logger
    });
    
    this.logger.debug(`Hydrated workflow instance of type "${data.workflowType}"`, {
      workflowId: workflow.id,
      workflowType: data.workflowType
    });
    
    return workflow;
  }
}

module.exports = WorkflowEngine; 