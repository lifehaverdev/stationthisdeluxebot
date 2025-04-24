/**
 * Generation Routes
 * 
 * Express routes for the ComfyDeploy integration.
 */

const express = require('express');
const router = express.Router();
const { comfyDeployService } = require('../../services/comfydeploy/service');
const { AppError } = require('../../core/shared/errors/AppError');
const { createLogger } = require('../../utils/logger');
const { filterPrimitiveParameters } = require('../../services/comfydeploy/utils/normalizeParameters');

const logger = createLogger('generationRoutes');

// Get available workflows
router.get('/workflows', async (req, res) => {
  try {
    const workflows = await comfyDeployService.getAvailableWorkflows();
    res.json({
      success: true,
      workflows: workflows || []
    });
  } catch (error) {
    logger.error('Failed to fetch workflows', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch workflows'
    });
  }
});

// Execute generation request
router.post('/execute', async (req, res) => {
  try {
    const { workflowId, parameters, userId } = req.body;
    
    // PARAMETER TRACING: Log the initial web request parameters
    console.log('PARAMETER TRACE [0. Web Request]:', {
      workflowId,
      parameterCount: parameters ? Object.keys(parameters).length : 0,
      parameterKeys: parameters ? Object.keys(parameters) : [],
      hasPromptKey: parameters?.prompt ? true : false,
      hasInputsKey: parameters?.inputs ? true : false,
      nestedInputsCount: parameters?.inputs ? Object.keys(parameters.inputs).length : 0,
      nestedInputKeys: parameters?.inputs ? Object.keys(parameters.inputs) : [],
      userId
    });
    
    if (!workflowId) {
      return res.status(400).json({
        success: false,
        error: 'Missing workflowId parameter'
      });
    }
    
    // Simple parameter prefixing at the API boundary
    const simplifiedParameters = {};
    
    // Process all parameters and ensure they have input_ prefix
    if (parameters) {
      Object.entries(parameters).forEach(([key, value]) => {
        // Skip specific keys (like 'prompt', 'inputs', etc.) that are handled separately
        if (['prompt', 'inputs', 'userId', 'type'].includes(key)) return;
        
        // Add input_ prefix if not already present
        const prefixedKey = key.startsWith('input_') ? key : `input_${key}`;
        simplifiedParameters[prefixedKey] = value;
      });
      
      // Handle nested inputs if they exist
      if (parameters.inputs) {
        Object.entries(parameters.inputs).forEach(([key, value]) => {
          // Skip numeric keys which are often UI mappings
          if (!isNaN(parseInt(key))) return;
          
          // Add input_ prefix if not already present
          const prefixedKey = key.startsWith('input_') ? key : `input_${key}`;
          simplifiedParameters[prefixedKey] = value;
        });
      }
    }
    
    // Log simplified parameters
    console.log('PARAMETER TRACE [0.1 Parameter Simplification]:', {
      originalParameterCount: parameters ? Object.keys(parameters).length : 0,
      simplifiedParameterCount: Object.keys(simplifiedParameters).length,
      allParamsHavePrefix: Object.keys(simplifiedParameters).every(k => 
        k.startsWith('input_') || k === '_originalInputs' || !isNaN(parseInt(k))
      ),
      simplifiedKeys: Object.keys(simplifiedParameters)
    });
    
    // Preserve the original prompt if available
    if (parameters?.prompt) {
      simplifiedParameters.input_prompt = parameters.prompt;
    }
    
    // Prepare settings with simplified parameters
    const settings = {
      inputs: simplifiedParameters
    };
    
    // Add to queue and return job ID
    const result = await comfyDeployService.generate({
      type: workflowId,
      prompt: parameters?.prompt || '',
      settings: settings,
      userId: userId || 'web-user',
    }, {
      source: 'web-interface'
    });
    
    res.json({
      success: true,
      jobId: result.taskId,
      runId: result.runId,
      status: result.status || 'queued'
    });
  } catch (error) {
    logger.error('Failed to execute generation', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute generation'
    });
  }
});

// Get job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await comfyDeployService.checkStatus(jobId);
    
    res.json({
      success: true,
      jobId,
      status: status.status || 'unknown',
      progress: status.progress || 0,
      isComplete: status.isComplete || false,
      output: status.isComplete && status.status === 'completed' ? status.result : null,
      error: status.error || null
    });
  } catch (error) {
    logger.error('Failed to fetch job status', { error, jobId: req.params.jobId });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch job status'
    });
  }
});

// Cancel job
router.post('/cancel/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await comfyDeployService.cancelGeneration(jobId);
    
    res.json({
      success: true,
      jobId,
      result
    });
  } catch (error) {
    logger.error('Failed to cancel job', { error, jobId: req.params.jobId });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel job'
    });
  }
});

module.exports = router; 