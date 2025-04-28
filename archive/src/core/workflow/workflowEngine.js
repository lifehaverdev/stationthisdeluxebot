/**
 * Workflow Engine
 * 
 * Provides factory functions and tools for creating and managing workflows.
 */

/**
 * Create a workflow step
 * 
 * @param {Object} options - Step options
 * @param {string} options.id - Step identifier
 * @param {Function} options.process - Step processing function
 * @param {Function} [options.handleInput] - Input handling function
 * @returns {Object} The workflow step
 */
function createWorkflowStep(options) {
  if (!options.id) {
    throw new Error('Step ID is required');
  }
  
  if (!options.process || typeof options.process !== 'function') {
    throw new Error('Step process function is required');
  }
  
  return {
    id: options.id,
    process: options.process,
    handleInput: options.handleInput || ((input, state) => Promise.resolve(state)),
    ui: options.ui || null
  };
}

/**
 * Workflow step class
 */
class WorkflowStep {
  /**
   * Create a new workflow step
   * 
   * @param {Object} options - Step options
   * @param {string} options.id - Step identifier
   * @param {Function} options.process - Step processing function
   * @param {Function} [options.handleInput] - Input handling function
   */
  constructor(options) {
    if (!options.id) {
      throw new Error('Step ID is required');
    }
    
    if (!options.process || typeof options.process !== 'function') {
      throw new Error('Step process function is required');
    }
    
    this.id = options.id;
    this.process = options.process;
    this.handleInput = options.handleInput || ((input, state) => Promise.resolve(state));
    this.ui = options.ui || null;
  }
}

/**
 * Create a workflow
 * 
 * @param {Object} options - Workflow options
 * @param {Object} options.steps - Object mapping step IDs to step definitions
 * @param {string} options.initialStep - ID of the initial step
 * @param {Object} [options.context={}] - Initial workflow context
 * @returns {Object} The workflow
 */
function createWorkflow(options) {
  if (!options.steps || typeof options.steps !== 'object') {
    throw new Error('Workflow steps are required');
  }
  
  if (!options.initialStep) {
    throw new Error('Initial step is required');
  }
  
  const steps = options.steps;
  const context = options.context || {};
  let currentStepId = options.initialStep;
  
  return {
    id: context.workflowId || `workflow-${Date.now()}`,
    
    /**
     * Get the current step
     * 
     * @returns {Object} The current step
     */
    getCurrentStep() {
      return steps[currentStepId];
    },
    
    /**
     * Process the current step
     * 
     * @returns {Promise<Object>} The step result
     */
    async processStep() {
      const step = steps[currentStepId];
      if (!step) {
        throw new Error(`Step "${currentStepId}" not found`);
      }
      
      const result = await step.process(context);
      
      // Update the context with the result
      if (result) {
        Object.assign(context, result);
        
        // Update the step's UI with the UI from the result
        if (result.ui) {
          step.ui = result.ui;
        }
      }
      
      return result;
    },
    
    /**
     * Process user input
     * 
     * @param {*} input - User input
     * @returns {Promise<Object>} The step result
     */
    async processInput(input) {
      const step = steps[currentStepId];
      if (!step) {
        throw new Error(`Step "${currentStepId}" not found`);
      }
      
      if (!step.handleInput) {
        throw new Error(`Step "${currentStepId}" does not handle input`);
      }
      
      const result = await step.handleInput(input, context);
      
      if (result) {
        // Update state if provided
        if (result.state) {
          Object.assign(context, result.state);
        }
        
        // Change step if specified
        if (result.nextStep) {
          currentStepId = result.nextStep;
          
          // Process the new step automatically
          await this.processStep();
        }
      }
      
      return result;
    },
    
    /**
     * Serialize the workflow state
     * 
     * @returns {Object} The serialized state
     */
    serialize() {
      return {
        id: this.id,
        currentStepId,
        context: JSON.parse(JSON.stringify(context))
      };
    },
    
    /**
     * Deserialize the workflow state
     * 
     * @param {Object} state - The serialized state
     * @returns {Object} The workflow
     */
    deserialize(state) {
      currentStepId = state.currentStepId;
      Object.assign(context, state.context);
      return this;
    },
    
    /**
     * Check if the workflow is completed
     * 
     * @returns {boolean} True if completed
     */
    isCompleted() {
      return context.completed === true;
    },
    
    /**
     * Get the workflow result
     * 
     * @returns {*} The workflow result
     */
    getResult() {
      return context.result;
    }
  };
}

module.exports = {
  createWorkflow,
  createWorkflowStep,
  WorkflowStep
}; 