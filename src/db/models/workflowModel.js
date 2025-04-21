/**
 * WorkflowModel - Schema definition and validation for workflows
 * 
 * This module defines the expected structure of workflow documents
 * and provides validation methods.
 */

const Joi = require('joi');

// Define workflow schema using Joi
const workflowSchema = Joi.object({
  _id: Joi.any().optional(),
  name: Joi.string().required().min(1).max(100),
  description: Joi.string().optional().allow('').max(1000),
  inputs: Joi.array().required().items(
    Joi.object({
      name: Joi.string().required(),
      type: Joi.string().required(),
      description: Joi.string().optional().allow(''),
      required: Joi.boolean().default(true),
      defaultValue: Joi.any().optional(),
      validation: Joi.object().optional()
    })
  ),
  steps: Joi.array().required().items(
    Joi.object({
      id: Joi.string().required(),
      type: Joi.string().required(),
      name: Joi.string().optional(),
      config: Joi.object().optional(),
      nextSteps: Joi.array().items(Joi.string()).optional()
    })
  ),
  outputs: Joi.array().optional().items(
    Joi.object({
      name: Joi.string().required(),
      type: Joi.string().required(),
      description: Joi.string().optional().allow('')
    })
  ),
  metadata: Joi.object({
    category: Joi.string().optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    featured: Joi.boolean().default(false),
    public: Joi.boolean().default(false),
    version: Joi.string().optional(),
    createdAt: Joi.date().optional(),
    updatedAt: Joi.date().optional(),
    author: Joi.string().optional()
  }).optional(),
  createdAt: Joi.date().default(() => new Date()),
  updatedAt: Joi.date().default(() => new Date())
});

/**
 * Validate a workflow object against the schema
 * 
 * @param {Object} workflow The workflow to validate
 * @returns {Object} The validation result { error, value }
 */
function validateWorkflow(workflow) {
  return workflowSchema.validate(workflow, { abortEarly: false });
}

/**
 * Create a new workflow with defaults
 * 
 * @param {Object} workflowData Partial workflow data
 * @returns {Object} A new workflow object with defaults applied
 */
function createWorkflow(workflowData = {}) {
  const now = new Date();
  const defaultWorkflow = {
    inputs: [],
    steps: [],
    outputs: [],
    metadata: {
      featured: false,
      public: false
    },
    createdAt: now,
    updatedAt: now
  };
  
  return { ...defaultWorkflow, ...workflowData };
}

/**
 * Create a workflow input
 * 
 * @param {Object} inputData Input data
 * @returns {Object} Workflow input object
 */
function createWorkflowInput(inputData) {
  const defaultInput = {
    required: true
  };
  
  return { ...defaultInput, ...inputData };
}

/**
 * Create a workflow step
 * 
 * @param {Object} stepData Step data
 * @returns {Object} Workflow step object
 */
function createWorkflowStep(stepData) {
  const defaultStep = {
    nextSteps: [],
    config: {}
  };
  
  return { ...defaultStep, ...stepData };
}

// Schema for the workflows collection document that contains all workflows
const workflowsDocumentSchema = Joi.object({
  _id: Joi.any().optional(),
  flows: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      ids: Joi.array().items(Joi.string()).optional(),
      layout: Joi.alternatives().try(
        Joi.string(),
        Joi.object()
      ).required(),
      active: Joi.boolean().default(true).optional(),
    }).unknown(true) // Allow other fields in flows
  ).default([]),
}).unknown(true); // Allow other fields at root level

/**
 * Validate workflow document
 * 
 * @param {Object} doc Document to validate
 * @param {Object} logger Logger instance for detailed validation logs
 * @returns {Object} Validation result { error, value }
 */
function validateWorkflowDocument(doc, logger = console) {
  logger.debug('Validating workflow document', { 
    hasDoc: !!doc,
    hasFlows: doc && !!doc.flows,
    flowsType: doc && doc.flows ? typeof doc.flows : 'undefined',
    flowsLength: doc && Array.isArray(doc.flows) ? doc.flows.length : 0
  });
  
  const result = workflowsDocumentSchema.validate(doc);
  
  if (result.error) {
    logger.error('Workflow document validation failed', { 
      error: result.error.message, 
      details: result.error.details
    });
  } else {
    logger.debug('Workflow document validation passed');
  }
  
  return result;
}

module.exports = {
  workflowSchema,
  validateWorkflow,
  createWorkflow,
  createWorkflowInput,
  createWorkflowStep,
  validateWorkflowDocument,
  workflowsDocumentSchema
}; 