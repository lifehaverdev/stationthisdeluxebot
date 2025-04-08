/**
 * Workflow Sequence Management
 * 
 * Defines the structure of workflow sequences and manages the creation
 * and execution of multi-step interactions.
 */

const { WorkflowState, WorkflowStep } = require('./state');
const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const crypto = require('crypto');

/**
 * Generate a unique workflow ID
 * @private
 * @returns {string} Generated ID
 */
function generateWorkflowId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * WorkflowSequence 
 * Defines a sequence of steps and provides methods to create and manage workflow instances
 */
class WorkflowSequence {
  /**
   * Create a new workflow sequence
   * @param {Object} options - Sequence configuration
   * @param {string} options.name - Workflow name
   * @param {Object} options.steps - Step definitions keyed by step ID
   * @param {string} options.initialStep - Starting step ID
   * @param {Object} [options.metadata={}] - Additional metadata for the workflow
   */
  constructor(options = {}) {
    this.name = options.name;
    this.steps = {};
    this.initialStep = options.initialStep;
    this.metadata = options.metadata || {};
    
    // Initialize steps
    if (options.steps) {
      this.registerSteps(options.steps);
    }
    
    // Validate sequence on initialization
    this.validate();
  }
  
  /**
   * Register steps in the sequence
   * @param {Object} steps - Step configuration objects keyed by step ID
   * @returns {WorkflowSequence} This workflow sequence for chaining
   */
  registerSteps(steps) {
    if (!steps || typeof steps !== 'object') {
      throw new AppError('Steps must be an object with step IDs as keys', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_INVALID_STEPS'
      });
    }
    
    // Convert each step config to a WorkflowStep instance
    Object.entries(steps).forEach(([stepId, stepConfig]) => {
      // If already a WorkflowStep instance, use it
      if (stepConfig instanceof WorkflowStep) {
        this.steps[stepId] = stepConfig;
        return;
      }
      
      // Otherwise, create a new WorkflowStep
      this.steps[stepId] = new WorkflowStep({
        id: stepId, 
        ...stepConfig
      });
    });
    
    return this;
  }
  
  /**
   * Validate the workflow sequence
   * @returns {Object} Validation result {valid, errors}
   */
  validate() {
    const errors = [];
    
    // Check if initial step exists
    if (!this.initialStep) {
      errors.push('Initial step is required');
    } else if (!this.steps[this.initialStep]) {
      errors.push(`Initial step '${this.initialStep}' not found in step definitions`);
    }
    
    // Check if there are steps
    if (Object.keys(this.steps).length === 0) {
      errors.push('At least one step is required');
    }
    
    // Validate each step's transitions
    Object.entries(this.steps).forEach(([stepId, step]) => {
      // Skip validation if the next step is null (end of workflow)
      if (step.nextStep === null) {
        return;
      }
      
      // Check if the default next step exists
      if (step.nextStep && !this.steps[step.nextStep]) {
        errors.push(`Step '${stepId}' has invalid next step '${step.nextStep}'`);
      }
      
      // Check if all transition targets exist
      if (typeof step.transitions === 'object') {
        Object.values(step.transitions).forEach(targetStepId => {
          if (targetStepId !== null && !this.steps[targetStepId]) {
            errors.push(`Step '${stepId}' has invalid transition target '${targetStepId}'`);
          }
        });
      }
    });
    
    const valid = errors.length === 0;
    
    if (!valid) {
      throw new AppError(`Invalid workflow sequence: ${errors.join(', ')}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_INVALID_SEQUENCE',
        details: { errors }
      });
    }
    
    return { valid, errors };
  }
  
  /**
   * Create a new workflow instance
   * @param {Object} [context={}] - Context data for this workflow instance
   * @returns {WorkflowState} New workflow state instance
   */
  createWorkflow(context = {}) {
    // Generate a unique ID for this workflow instance
    const workflowId = context.workflowId || generateWorkflowId();
    
    // Create the workflow context with metadata
    const workflowContext = {
      ...context,
      workflowId,
      sequenceName: this.name,
      metadata: this.metadata,
      createdAt: Date.now()
    };
    
    // Create a new workflow state
    return new WorkflowState({
      steps: this.steps,
      initialStep: this.initialStep,
      context: workflowContext
    });
  }
  
  /**
   * Get step by ID
   * @param {string} stepId - Step ID to retrieve
   * @returns {WorkflowStep} Step definition
   */
  getStep(stepId) {
    return this.steps[stepId] || null;
  }
  
  /**
   * Get all steps
   * @returns {Object} All steps keyed by ID
   */
  getAllSteps() {
    return { ...this.steps };
  }
  
  /**
   * Create a serializable representation of this sequence
   * (without functions, for storage/transmission)
   * @returns {Object} Serializable workflow definition
   */
  toJSON() {
    // Convert steps to plain objects without functions
    const serializedSteps = Object.entries(this.steps).reduce((acc, [stepId, step]) => {
      // Create a serializable version of the step
      acc[stepId] = {
        id: step.id,
        name: step.name,
        nextStep: step.nextStep,
        ui: step.ui,
        // Don't include functions - they'll need to be re-attached when deserializing
      };
      return acc;
    }, {});
    
    return {
      name: this.name,
      initialStep: this.initialStep,
      steps: serializedSteps,
      metadata: this.metadata
    };
  }
}

/**
 * A factory class for creating common workflow sequences
 */
class WorkflowBuilder {
  /**
   * Create a linear workflow sequence
   * @param {Object} options - Workflow options
   * @param {string} options.name - Workflow name
   * @param {Array} options.steps - Array of step configurations in sequence order
   * @param {Object} [options.metadata={}] - Additional metadata
   * @returns {WorkflowSequence} New workflow sequence
   */
  static createLinearWorkflow(options) {
    const { name, steps = [], metadata = {} } = options;
    
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new AppError('Steps must be a non-empty array', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_INVALID_STEPS'
      });
    }
    
    // Create step definitions with next steps set up in sequence
    const stepDefinitions = {};
    
    steps.forEach((stepConfig, index) => {
      const stepId = stepConfig.id || `step_${index + 1}`;
      const isLastStep = index === steps.length - 1;
      
      stepDefinitions[stepId] = {
        ...stepConfig,
        id: stepId,
        // Set next step for all but the last step
        nextStep: isLastStep ? null : (steps[index + 1].id || `step_${index + 2}`)
      };
    });
    
    return new WorkflowSequence({
      name,
      steps: stepDefinitions,
      initialStep: steps[0].id || 'step_1',
      metadata
    });
  }
  
  /**
   * Create a form-style workflow with validation
   * @param {Object} options - Form workflow options
   * @param {string} options.name - Workflow name
   * @param {Array} options.fields - Array of form field configurations
   * @param {Function} [options.onSubmit] - Submission handler
   * @param {Object} [options.metadata={}] - Additional metadata
   * @returns {WorkflowSequence} New workflow sequence
   */
  static createFormWorkflow(options) {
    const { name, fields = [], onSubmit, metadata = {} } = options;
    
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new AppError('Fields must be a non-empty array', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_INVALID_FIELDS'
      });
    }
    
    // Create steps for each field plus a confirmation step
    const stepDefinitions = {};
    
    // Create steps for each field
    fields.forEach((field, index) => {
      const stepId = field.id || `field_${index + 1}`;
      const isLastField = index === fields.length - 1;
      
      stepDefinitions[stepId] = {
        id: stepId,
        name: field.name || `Field ${index + 1}`,
        validate: field.validate,
        nextStep: isLastField ? 'confirmation' : (fields[index + 1].id || `field_${index + 2}`),
        ui: field.ui || {}
      };
    });
    
    // Add confirmation step
    stepDefinitions.confirmation = {
      id: 'confirmation',
      name: 'Confirmation',
      process: (input, workflowState) => {
        // If onSubmit provided, call it with all collected inputs
        if (typeof onSubmit === 'function') {
          return onSubmit(workflowState.getAllInputs());
        }
        return true;
      },
      nextStep: null, // End of workflow
      ui: {
        type: 'confirmation',
        message: 'Please confirm your submission'
      }
    };
    
    return new WorkflowSequence({
      name,
      steps: stepDefinitions,
      initialStep: fields[0].id || 'field_1',
      metadata
    });
  }
}

module.exports = {
  WorkflowSequence,
  WorkflowBuilder
}; 