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
const trainModelWorkflow = require('./trainModel');
const { CollectionsWorkflow } = require('./collections');
const settingsWorkflow = require('./settings');

module.exports = {
  // Media Processing Workflows
  processImageWorkflow,
  removeBackgroundWorkflow,
  upscaleImageWorkflow,
  
  // Image Generation Workflows
  makeImageWorkflow,
  
  // Model Training Workflows
  trainModelWorkflow,
  
  // Collection Management Workflows
  CollectionsWorkflow,
  
  // Settings Management Workflow
  settingsWorkflow
}; 