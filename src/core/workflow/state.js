/**
 * Workflow State Management
 * 
 * Provides a state container for managing workflow state with immutable updates,
 * history tracking, and event emission.
 */

/**
 * Workflow Step Class
 * Represents a single step in a workflow
 */
class WorkflowStep {
  /**
   * Create a new workflow step
   * @param {Object} options - Step configuration
   * @param {string} options.id - Unique identifier for this step
   * @param {string} options.name - Human-readable name
   * @param {string} [options.nextStep] - Default next step
   * @param {Object} [options.ui] - UI configuration for this step (platform agnostic)
   * @param {Function} [options.validate] - Validation function for step input
   * @param {Function} [options.preProcess] - Function to preprocess input before validation
   * @param {Function} [options.postProcess] - Function to process input after validation
   */
  constructor(options = {}) {
    if (!options.id) {
      throw new Error('Step ID is required');
    }
    if (!options.name) {
      throw new Error('Step name is required');
    }
    // UI configuration is optional in integration code but required in test
    
    this.id = options.id;
    this.name = options.name;
    this.nextStep = options.nextStep || null;
    this.ui = options.ui || { type: 'text' }; // Default UI type if not provided
    
    // Function properties
    this.validate = options.validate || this._defaultValidate;
    this.preProcess = options.preProcess || this._defaultProcess;
    this.postProcess = options.postProcess || this._defaultProcess;
  }

  /**
   * Default validation function
   * @param {*} input - Input to validate
   * @returns {Object} Validation result { valid: true/false, error: string, value: any }
   */
  _defaultValidate(input) {
    return { valid: true };
  }

  /**
   * Default processing function (returns input unchanged)
   * @param {*} input - Input to process
   * @returns {*} Processed input
   */
  _defaultProcess(input) {
    return input;
  }
  
  /**
   * Custom JSON serialization to handle circular references 
   * and to exclude function properties
   * @returns {Object} Serializable version of this step
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      nextStep: this.nextStep,
      ui: this.ui
      // Deliberately exclude function properties and avoid circular references
    };
  }
}

/**
 * Workflow State
 * 
 * Represents the state of a workflow instance.
 * Handles state transitions, step processing, and serialization.
 */

const { AppError } = require('../shared/errors/AppError');

/**
 * WorkflowState class
 * 
 * Manages the state and execution of a workflow instance.
 */
class WorkflowState {
  /**
   * Create a new WorkflowState
   * @param {Object} definition - Workflow definition
   * @param {Object} [context={}] - Initial context
   */
  constructor(definition, context = {}) {
    // Validate required parameters
    if (!definition) {
      throw new Error('Workflow definition is required');
    }
    
    if (!definition.id) {
      throw new Error('Workflow ID is required');
    }
    
    if (!definition.steps || Object.keys(definition.steps).length === 0) {
      throw new Error('Steps are required and cannot be empty');
    }
    
    if (definition.startStep && !definition.steps[definition.startStep]) {
      throw new Error(`Start step '${definition.startStep}' not found in steps`);
    }
    
    this.definition = definition;
    this.id = definition.id;
    this.name = definition.name || definition.id;
    this.description = definition.description;
    this.context = { ...context };
    
    // Handle data from definition or create empty object
    this.data = definition.data || {};
    
    // Direct steps access for tests
    this.steps = definition.steps || {};
    
    // Support both currentStep and startStep in definition
    this.currentStep = definition.currentStep || definition.startStep || null;
    
    // Support history from definition
    this.history = definition.history || [];
    
    this.errors = [];
    this.completed = !!definition.completed;
    this.startedAt = context.startedAt || Date.now();
    this.updatedAt = this.startedAt;
    this.completedAt = null;
    
    // For serialization
    this.startStep = definition.startStep || null;
  }

  /**
   * Get the current step definition
   * @returns {Object|null} Current step definition or null
   */
  getCurrentStep() {
    if (!this.currentStep) return null;
    return this.steps[this.currentStep] || null;
  }

  /**
   * Get the current step ID
   * @returns {string|null} Current step ID or null
   */
  getCurrentStepId() {
    return this.currentStep;
  }

  /**
   * Set the current step
   * @param {string} stepId - Step ID
   * @returns {WorkflowState} This workflow state
   */
  setCurrentStep(stepId) {
    if (!this.definition.steps[stepId]) {
      throw new AppError(`Step '${stepId}' not found in workflow definition`, 'INVALID_STEP');
    }

    // Add to history if changing steps
    if (this.currentStep && this.currentStep !== stepId) {
      this.history.push({
        stepId: this.currentStep,
        timestamp: Date.now()
      });
    }

    this.currentStep = stepId;
    this.updatedAt = Date.now();
    return this;
  }

  /**
   * Process the current step with input
   * @param {*} input - Step input
   * @returns {Promise<WorkflowState>} Updated workflow state
   */
  async processStep(input) {
    try {
      if (!this.currentStep) {
        throw new AppError('No current step to process', 'INVALID_WORKFLOW_STATE');
      }

      const stepDef = this.getCurrentStep();
      if (!stepDef) {
        throw new AppError(`Current step '${this.currentStep}' not found in definition`, 'INVALID_WORKFLOW_STATE');
      }

      // Validate input if validation function exists
      if (typeof stepDef.validate === 'function') {
        try {
          await stepDef.validate(input, this);
        } catch (validationError) {
          this.errors.push({
            step: this.currentStep,
            message: validationError.message,
            timestamp: Date.now()
          });
          throw validationError;
        }
      }

      // Process step if process function exists
      if (typeof stepDef.process === 'function') {
        const updatedState = await stepDef.process(input, this);
        if (updatedState) {
          // Copy context and other state from the updated state
          this.context = { ...updatedState.context };
          this.errors = [...updatedState.errors];
          this.completed = updatedState.completed;
          this.updatedAt = Date.now();
        }
      }

      // Determine next step
      let nextStepId = null;

      if (typeof stepDef.nextStep === 'function') {
        nextStepId = await stepDef.nextStep(input, this);
      } else if (typeof stepDef.nextStep === 'string') {
        nextStepId = stepDef.nextStep;
      }

      // Special case for exit
      if (nextStepId === 'exit') {
        this.completed = true;
        this.completedAt = Date.now();
        return this;
      }

      // If there's a next step, set it
      if (nextStepId && nextStepId !== this.currentStep) {
        this.setCurrentStep(nextStepId);
      }

      return this;
    } catch (error) {
      // Add error to the errors array
      this.errors.push({
        step: this.currentStep,
        message: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
  }

  /**
   * Serialize the workflow state for storage
   * @returns {Object} Serialized workflow state
   */
  serialize() {
    return {
      id: this.id,
      name: this.name,
      startStep: this.startStep,
      currentStep: this.currentStep,
      data: this.data,
      context: this.context,
      history: this.history,
      errors: this.errors,
      completed: this.completed,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt
    };
  }

  /**
   * Deserialize a workflow state from storage
   * @param {Object} serialized - Serialized workflow state
   * @param {Object} definition - Workflow definition
   * @returns {WorkflowState} Deserialized workflow state
   * @static
   */
  static deserialize(serialized, definition) {
    const state = new WorkflowState(definition);
    
    state.currentStep = serialized.currentStep;
    state.context = { ...serialized.context };
    state.history = [...serialized.history];
    state.errors = [...serialized.errors];
    state.completed = serialized.completed;
    state.startedAt = serialized.startedAt;
    state.updatedAt = serialized.updatedAt;
    state.completedAt = serialized.completedAt;
    
    return state;
  }

  /**
   * Create a workflow from a definition
   * @param {Object} definition - Workflow definition
   * @param {Object} [context={}] - Initial context
   * @returns {WorkflowState} New workflow state
   * @static
   */
  static createWorkflow(definition, context = {}) {
    return new WorkflowState(definition, context);
  }

  /**
   * Move to the next step defined in the current step
   * @returns {boolean} Whether the move was successful
   */
  moveToNextStep() {
    if (!this.currentStep) return false;
    
    const currentStep = this.getCurrentStep();
    if (!currentStep || !currentStep.nextStep) return false;
    
    const nextStepId = currentStep.nextStep;
    if (!this.steps[nextStepId]) return false;
    
    // Add current step to history
    this.history.push({
      stepId: this.currentStep,
      timestamp: Date.now()
    });
    
    this.currentStep = nextStepId;
    this.updatedAt = Date.now();
    return true;
  }
  
  /**
   * Move to a specific step
   * @param {string} stepId - The step ID to move to
   * @param {boolean} [addToHistory=true] - Whether to add current step to history
   * @returns {boolean} Whether the move was successful
   */
  moveToStep(stepId, addToHistory = true) {
    if (!this.steps[stepId]) return false;
    
    // Optionally add current step to history
    if (addToHistory && this.currentStep) {
      this.history.push({
        stepId: this.currentStep,
        timestamp: Date.now()
      });
    }
    
    this.currentStep = stepId;
    this.updatedAt = Date.now();
    return true;
  }
  
  /**
   * Move to the previous step from history
   * @returns {boolean} Whether the move was successful
   */
  moveToPreviousStep() {
    if (!this.history || this.history.length === 0) return false;
    
    const previousStep = this.history.pop();
    if (!previousStep || !previousStep.stepId || !this.steps[previousStep.stepId]) return false;
    
    this.currentStep = previousStep.stepId;
    this.updatedAt = Date.now();
    return true;
  }
  
  /**
   * Process input for the current step
   * @param {*} input - The input to process
   * @param {boolean} [moveToNext=true] - Whether to move to the next step if valid
   * @returns {Object} The result of processing
   */
  processInput(input, moveToNext = true) {
    if (!this.currentStep) {
      return { valid: false, error: 'No current step' };
    }
    
    const step = this.getCurrentStep();
    if (!step) {
      return { valid: false, error: 'Current step not found in definition' };
    }
    
    // Validate input
    if (typeof step.validate === 'function') {
      const validation = step.validate(input);
      if (!validation.valid) {
        return validation;
      }
    }
    
    // Store input in data
    this.data[this.currentStep] = input;
    
    // Move to next step if requested
    if (moveToNext && step.nextStep) {
      this.moveToNextStep();
    }
    
    return { valid: true, value: input };
  }
  
  /**
   * Restart the workflow
   * @param {boolean} [keepData=false] - Whether to keep data when restarting
   */
  restart(keepData = false) {
    const startStep = this.definition.startStep;
    if (!startStep) return;
    
    this.currentStep = startStep;
    this.history = [];
    
    if (!keepData) {
      this.data = {};
    }
    
    this.errors = [];
    this.completed = false;
    this.updatedAt = Date.now();
  }
  
  /**
   * Check if the workflow is complete
   * @returns {boolean} Whether the workflow is complete
   */
  isComplete() {
    if (!this.currentStep) return false;
    
    const step = this.getCurrentStep();
    if (!step) return false;
    
    return !step.nextStep;
  }

  /**
   * Custom JSON serialization for stringifying workflow state
   * @returns {Object} Serialized workflow state
   */
  toJSON() {
    return this.serialize();
  }
}

module.exports = {
  WorkflowStep,
  WorkflowState
}; 