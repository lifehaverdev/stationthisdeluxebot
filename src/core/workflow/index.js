/**
 * Workflow Module
 * 
 * Platform-agnostic implementation of multi-step interactions with immutable
 * state transitions, validation, and event emissions.
 */

const { WorkflowState, WorkflowStep } = require('./state');
const { WorkflowSequence, WorkflowBuilder } = require('./sequence');
const sessionIntegration = require('./sessionIntegration');
const { createMakeImageWorkflow } = require('./workflows/MakeImageWorkflow');

module.exports = {
  // Core components
  WorkflowState,
  WorkflowStep,
  WorkflowSequence,
  WorkflowBuilder,
  
  // Factory functions
  createWorkflow: (options) => {
    return new WorkflowSequence(options);
  },
  createLinearWorkflow: WorkflowBuilder.createLinearWorkflow,
  createFormWorkflow: WorkflowBuilder.createFormWorkflow,
  
  // Session integration
  session: sessionIntegration,

  createMakeImageWorkflow,
}; 