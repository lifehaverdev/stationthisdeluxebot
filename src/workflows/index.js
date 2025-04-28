/**
 * Workflows Index
 * 
 * Exports all available platform-agnostic workflows to simplify imports.
 */

const { 
  processImageWorkflow,
  removeBackgroundWorkflow,
  upscaleImageWorkflow
} = require('./mediaProcessing');

const { makeImageWorkflow } = require('./makeImage');

module.exports = {
  // Media Processing Workflows
  processImageWorkflow,
  removeBackgroundWorkflow,
  upscaleImageWorkflow,
  
  // Image Generation Workflows
  makeImageWorkflow
}; 