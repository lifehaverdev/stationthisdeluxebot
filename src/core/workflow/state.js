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
 * Workflow State Class
 * Manages the state of a workflow
 */
class WorkflowState {
  /**
   * Create a new workflow state
   * @param {Object} options - Workflow options
   * @param {string} [options.id] - Unique identifier
   * @param {string} [options.name] - Human-readable name
   * @param {Object} options.steps - Step definitions keyed by step ID
   * @param {string} [options.startStep] - Starting step ID (or initialStep for backward compatibility)
   * @param {string} [options.currentStep] - Current step ID (defaults to startStep)
   * @param {Object} [options.data] - Initial data
   * @param {Array} [options.history] - Initial history
   * @param {Object} [options.context] - Additional context
   */
  constructor(options = {}) {
    // Support legacy 'initialStep' parameter
    const startStep = options.startStep || options.initialStep;
    
    // Get ID from options.id or options.context.workflowId
    const id = options.id || (options.context && options.context.workflowId);
    
    if (!id) {
      throw new Error('Workflow ID is required');
    }
    if (!options.steps || Object.keys(options.steps).length === 0) {
      throw new Error('Workflow steps are required');
    }
    if (!startStep) {
      throw new Error('Start step is required');
    }
    if (startStep && !options.steps[startStep]) {
      throw new Error(`Start step '${startStep}' not found in step definitions`);
    }

    this.id = id;
    this.name = options.name || id;
    this.steps = options.steps;
    this.startStep = startStep;
    this.currentStep = options.currentStep || startStep;
    this.data = options.data || {};
    this.history = options.history || [];
    this.context = options.context || {};
  }

  /**
   * Get the current step object
   * @returns {WorkflowStep|null} Current step or null if not found
   */
  getCurrentStep() {
    return this.steps[this.currentStep] || null;
  }

  /**
   * Move to the next step in the workflow
   * @returns {boolean} True if moved to next step, false otherwise
   */
  moveToNextStep() {
    const currentStep = this.getCurrentStep();
    if (!currentStep || !currentStep.nextStep) {
      return false;
    }

    const nextStepId = currentStep.nextStep;
    if (!this.steps[nextStepId]) {
      return false;
    }

    // Add current step to history
    this.history.push(this.currentStep);
    
    // Move to next step
    this.currentStep = nextStepId;
    
    return true;
  }

  /**
   * Move to a specific step
   * @param {string} stepId - Step ID to move to
   * @param {boolean} [addToHistory=true] - Whether to add current step to history
   * @returns {boolean} True if moved to step, false if step not found
   */
  moveToStep(stepId, addToHistory = true) {
    if (!this.steps[stepId]) {
      return false;
    }

    // Add current step to history if requested
    if (addToHistory) {
      this.history.push(this.currentStep);
    }
    
    // Move to specified step
    this.currentStep = stepId;
    
    return true;
  }

  /**
   * Move to the previous step in history
   * @returns {boolean} True if moved to previous step, false otherwise
   */
  moveToPreviousStep() {
    if (this.history.length === 0) {
      return false;
    }

    const previousStepId = this.history.pop();
    if (!this.steps[previousStepId]) {
      return false;
    }

    this.currentStep = previousStepId;
    return true;
  }

  /**
   * Process input for the current step
   * @param {*} input - Input to process
   * @param {boolean} [moveToNext=true] - Whether to move to next step if valid
   * @returns {Object} Processing result { valid: true/false, error: string }
   */
  processInput(input, moveToNext = true) {
    const step = this.getCurrentStep();
    if (!step) {
      return {
        valid: false,
        error: 'No current step'
      };
    }

    // Preprocess input
    const preprocessed = step.preProcess(input);
    
    // Validate input
    const validation = step.validate(preprocessed);
    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error || 'Invalid input'
      };
    }

    // Store input in data
    const value = validation.value !== undefined ? validation.value : preprocessed;
    this.data[step.id] = step.postProcess(value);
    
    // Move to next step if requested and valid
    if (moveToNext) {
      this.moveToNextStep();
    }
    
    return { valid: true };
  }
  
  /**
   * Legacy support: store input for current step
   * @param {string} stepId - Step ID
   * @param {*} input - Input value
   */
  storeInput(stepId, input) {
    this.data[stepId] = input;
  }
  
  /**
   * Legacy support: get input for a specific step
   * @param {string} stepId - Step ID
   * @returns {*} Input value
   */
  getInput(stepId) {
    return this.data[stepId];
  }
  
  /**
   * Legacy support: transition to next step
   */
  goToNextStep() {
    return this.moveToNextStep();
  }

  /**
   * Restart the workflow
   * @param {boolean} [keepData=false] - Whether to keep current data
   */
  restart(keepData = false) {
    this.currentStep = this.startStep;
    this.history = [];
    if (!keepData) {
      this.data = {};
    }
  }

  /**
   * Check if the workflow is complete (at a step with no next step)
   * @returns {boolean} True if workflow is complete
   */
  isComplete() {
    const step = this.getCurrentStep();
    return step ? !step.nextStep : false;
  }
  
  /**
   * Custom JSON serialization to handle circular references
   * @returns {Object} Serializable version of this workflow state
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      startStep: this.startStep,
      currentStep: this.currentStep,
      data: this.data,
      history: this.history,
      context: this.context
      // Steps will be serialized using their toJSON methods
    };
  }
  
  /**
   * Legacy support: get full workflow state (for compatibility)
   * @returns {Object} Workflow state
   */
  getState() {
    return {
      currentStepId: this.currentStep,
      inputs: this.data,
      errors: {},
      completed: this.isComplete(),
      startedAt: Date.now(),
      lastUpdatedAt: Date.now()
    };
  }
}

module.exports = {
  WorkflowStep,
  WorkflowState
}; 