/**
 * Generation Routes
 * 
 * Express routes for the ComfyDeploy integration.
 */

const express = require('express');
const router = express.Router();
const { comfyDeployService } = require('../../services/comfydeploy/service');
const { AppError } = require('../../core/shared/errors/AppError');
const { Logger } = require('../../utils/logger');

const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'generationRoutes'
});

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
    
    if (!workflowId) {
      return res.status(400).json({
        success: false,
        error: 'Missing workflowId parameter'
      });
    }
    
    // Add to queue and return job ID
    const result = await comfyDeployService.generate({
      type: workflowId,
      prompt: parameters.prompt || '',
      settings: parameters || {},
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