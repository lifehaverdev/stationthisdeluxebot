/**
 * Workflow Model
 * 
 * Executes workflow logic and maintains workflow state.
 */

const { v4: uuidv4 } = require('uuid');

class WorkflowModel {
  /**
   * Create a new workflow instance
   * 
   * @param {Object} options - Workflow options
   * @param {Object} options.definition - The workflow definition
   * @param {string} options.userId - The user ID associated with the workflow
   * @param {string} [options.id] - The workflow ID (generated if not provided)
   * @param {string} [options.currentStep] - The current step (defaults to initialStep)
   * @param {Object} [options.data={}] - Workflow state data
   * @param {Array<string>} [options.history=[]] - History of visited steps
   * @param {Date} [options.createdAt] - Workflow creation timestamp
   * @param {Date} [options.updatedAt] - Workflow last update timestamp
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    if (!options.definition) {
      throw new Error('Workflow definition is required');
    }
    
    if (!options.userId) {
      throw new Error('userId is required');
    }
    
    this.definition = options.definition;
    this.id = options.id || uuidv4();
    this.userId = options.userId;
    this.workflowType = options.definition.type;
    this.currentStep = options.currentStep || options.definition.initialStep;
    this.data = options.data || {};
    this.history = options.history || [];
    this.createdAt = options.createdAt || new Date();
    this.updatedAt = options.updatedAt || new Date();
    
    this.logger = options.logger || {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {}
    };
  }
  
  /**
   * Process the current step
   * 
   * @returns {Promise<Object>} Result of step processing
   * @throws {Error} If step handler fails or is not defined
   */
  async processStep() {
    const stepId = this.currentStep;
    const stepDefinition = this.definition.steps[stepId];
    
    if (!stepDefinition) {
      const error = new Error(`Step not found: ${stepId}`);
      this.logger.error('Step not found in workflow definition', {
        workflowId: this.id,
        stepId,
        workflowType: this.workflowType
      });
      throw error;
    }
    
    if (!stepDefinition.handlers || !stepDefinition.handlers.processStep) {
      const error = new Error(`No processStep handler defined for step: ${stepId}`);
      this.logger.error('No processStep handler defined', { stepId });
      throw error;
    }
    
    try {
      const result = await stepDefinition.handlers.processStep(
        this.data,
        {
          stepId,
          userId: this.userId
        }
      );
      
      // Update the last modified timestamp
      this.updatedAt = new Date();
      
      return result;
    } catch (error) {
      this.logger.error('Error in processStep handler', {
        workflowId: this.id,
        stepId,
        error
      });
      
      throw new Error(`Error processing step ${stepId}: ${error.message}`);
    }
  }
  
  /**
   * Process user input for the current step
   * 
   * @param {*} input - User input to process
   * @returns {Promise<Object>} Result of input processing
   * @throws {Error} If input handler fails or is not defined
   */
  async processInput(input) {
    const stepId = this.currentStep;
    const stepDefinition = this.definition.steps[stepId];
    
    if (!stepDefinition) {
      const error = new Error(`Step not found: ${stepId}`);
      this.logger.error('Step not found in workflow definition', {
        workflowId: this.id,
        stepId,
        workflowType: this.workflowType
      });
      throw error;
    }
    
    if (!stepDefinition.handlers || !stepDefinition.handlers.processInput) {
      const error = new Error(`No processInput handler defined for step: ${stepId}`);
      this.logger.error('No processInput handler defined', { stepId });
      throw error;
    }
    
    try {
      const result = await stepDefinition.handlers.processInput(
        input,
        this.data,
        {
          stepId,
          userId: this.userId
        }
      );
      
      // Update workflow state based on validation result
      if (result.valid && result.nextStep) {
        // Add current step to history before changing
        if (!this.history.includes(this.currentStep)) {
          this.history.push(this.currentStep);
        }
        
        // Update current step
        this.currentStep = result.nextStep;
        
        // Update data if provided
        if (result.data) {
          this.setData(result.data);
        }
      }
      
      // Update the last modified timestamp
      this.updatedAt = new Date();
      
      return result;
    } catch (error) {
      this.logger.error('Error in processInput handler', {
        workflowId: this.id,
        stepId,
        input,
        error
      });
      
      throw new Error(`Error processing input for step ${stepId}: ${error.message}`);
    }
  }
  
  /**
   * Manually set the current step
   * 
   * @param {string} stepId - ID of the step to set
   * @returns {boolean} True if step was changed
   * @throws {Error} If the step does not exist
   */
  setStep(stepId) {
    if (!this.definition.steps[stepId]) {
      throw new Error(`Invalid step: ${stepId}`);
    }
    
    // Add current step to history before changing, if not already there
    if (!this.history.includes(this.currentStep)) {
      this.history.push(this.currentStep);
    }
    
    this.currentStep = stepId;
    this.updatedAt = new Date();
    
    return true;
  }
  
  /**
   * Update workflow data
   * 
   * @param {Object} data - Data to merge with current data
   */
  setData(data) {
    if (!data) return;
    
    this.data = {
      ...this.data,
      ...data
    };
    
    this.updatedAt = new Date();
  }
  
  /**
   * Check if workflow is complete
   * 
   * @returns {boolean} True if workflow is complete
   */
  isComplete() {
    const currentStepDef = this.definition.steps[this.currentStep];
    return currentStepDef && currentStepDef.final === true;
  }
  
  /**
   * Serialize workflow for storage
   * 
   * @returns {Object} Serialized workflow
   */
  serialize() {
    return {
      id: this.id,
      userId: this.userId,
      workflowType: this.workflowType,
      currentStep: this.currentStep,
      data: JSON.parse(JSON.stringify(this.data)), // Deep copy
      history: [...this.history],
      createdAt: this.createdAt instanceof Date ? this.createdAt.toISOString() : this.createdAt,
      updatedAt: this.updatedAt instanceof Date ? this.updatedAt.toISOString() : this.updatedAt
    };
  }
}

module.exports = WorkflowModel; 