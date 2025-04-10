/**
 * Make Command implementation
 * 
 * Platform-agnostic implementation of the /make command
 * that uses the GenerationService and ComfyDeployService
 */

const { v4: uuidv4 } = require('uuid');
const { AppError, ERROR_SEVERITY } = require('../core/shared/errors');
const { GenerationRequest, GenerationType } = require('../core/generation/models');

/**
 * Generate an image based on user prompt
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.generationService - GenerationService instance
 * @param {Object} context.comfyDeployService - ComfyDeployService instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {Object} context.pointsService - PointsService instance
 * @param {string} context.userId - User ID for session lookup
 * @param {string} context.prompt - User's prompt for image generation
 * @param {Object} [context.options] - Additional generation options
 * @returns {Promise<Object>} Generation task information
 */
async function generateImage(context) {
  const {
    generationService,
    comfyDeployService,
    sessionManager,
    pointsService,
    userId,
    prompt,
    options = {}
  } = context;

  if (!generationService) {
    throw new AppError('GenerationService is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'GENERATION_SERVICE_REQUIRED'
    });
  }

  if (!sessionManager) {
    throw new AppError('SessionManager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_MANAGER_REQUIRED'
    });
  }

  // Get or create user session
  let session;
  try {
    session = await sessionManager.getSession(userId);
    
    // If session doesn't exist, create it
    if (!session) {
      session = await sessionManager.createSession(userId, {
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    } else {
      // Update last activity
      await sessionManager.updateSession(userId, {
        lastActivity: Date.now(),
        lastCommand: '/make'
      });
    }
  } catch (error) {
    console.error('Error accessing session:', error);
    throw new AppError('Failed to access session data', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_ACCESS_FAILED',
      cause: error
    });
  }

  // Check if user has sufficient points if points service is available
  if (pointsService) {
    // Default cost is 100 points, but can be override in options
    const generationCost = options.cost || 100;
    
    const hasEnoughPoints = await pointsService.hasSufficientPoints(
      userId, 
      generationCost, 
      'points'
    );
    
    if (!hasEnoughPoints) {
      throw new AppError('Insufficient points for generation', {
        severity: ERROR_SEVERITY.WARNING,
        code: 'INSUFFICIENT_POINTS',
        userFacing: true
      });
    }
  }

  // Get user information
  const user = {
    id: userId,
    username: session.get('username') || '',
    points: session.get('points') || 0
  };

  // Get generation type from options or default to FLUX
  const generationType = options.type || 'FLUX';

  // Build generation request using ComfyDeploy service
  let request;
  if (comfyDeployService) {
    // Use ComfyDeploy service to build the request with appropriate defaults
    request = comfyDeployService.buildRequest({
      type: generationType,
      prompt,
      user,
      settings: options.settings || {},
      metadata: options.metadata || {}
    });
  } else {
    // Fallback to basic request if ComfyDeploy service is not available
    request = new GenerationRequest({
      userId,
      type: generationType,
      prompt,
      settings: {
        width: 1024,
        height: 1024,
        steps: 30,
        cfg: 7,
        seed: options.settings?.seed || -1,
        batch: options.settings?.batch || 1,
        checkpoint: 'zavychromaxl_v60',
        sampler: 'DPM++ 2M Karras',
        ...(options.settings || {})
      },
      metadata: {
        username: user.username,
        ...(options.metadata || {})
      }
    });
  }

  // Create generation task
  const task = await generationService.createTask(request);

  // Start processing the task
  await generationService.startProcessingTask(task.taskId);

  // Store the task in the session for easy retrieval
  const userTasks = session.get('tasks') || [];
  userTasks.push({
    id: task.taskId,
    type: generationType,
    prompt,
    createdAt: Date.now()
  });

  // Update session with task information
  await sessionManager.updateSession(userId, {
    tasks: userTasks.slice(-10), // Keep only the 10 most recent tasks
    lastGenerationType: generationType,
    lastPrompt: prompt
  });

  // Return task information
  return {
    taskId: task.taskId,
    status: task.status,
    type: generationType,
    prompt,
    timestamp: Date.now()
  };
}

/**
 * Process workflow for make command with multi-step interaction
 * 
 * @param {Object} context - Workflow context
 * @param {Object} context.workflowService - WorkflowService instance
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {string} context.userId - User ID
 * @param {string} [context.workflowId] - Existing workflow ID if continuing
 * @returns {Promise<Object>} Workflow state and next step
 */
async function processMakeWorkflow(context) {
  const {
    workflowService,
    sessionManager,
    userId,
    workflowId
  } = context;

  if (!workflowService) {
    throw new AppError('WorkflowService is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_SERVICE_REQUIRED'
    });
  }

  // Check if continuing an existing workflow
  if (workflowId) {
    return workflowService.continueWorkflow(workflowId, context);
  }

  // Create a new make workflow
  const workflowData = {
    name: 'make',
    userId,
    steps: [
      {
        id: 'prompt',
        name: 'Get Prompt',
        description: 'What would you like to generate?',
        inputType: 'text',
        validation: {
          required: true,
          minLength: 3
        }
      },
      {
        id: 'settings',
        name: 'Configure Settings',
        description: 'Adjust generation settings (optional)',
        inputType: 'form',
        fields: [
          {
            id: 'width',
            name: 'Width',
            type: 'number',
            default: 1024
          },
          {
            id: 'height',
            name: 'Height',
            type: 'number',
            default: 1024
          },
          {
            id: 'seed',
            name: 'Seed',
            type: 'number',
            default: -1
          }
        ],
        optional: true
      },
      {
        id: 'confirm',
        name: 'Confirm Generation',
        description: 'Generate this image?',
        inputType: 'confirm'
      }
    ]
  };

  // Start the workflow
  const workflow = await workflowService.createWorkflow(workflowData);

  // Store workflow reference in session
  await sessionManager.updateSession(userId, {
    currentWorkflow: workflow.id,
    workflowType: 'make'
  });

  // Return the initial workflow state
  return {
    workflowId: workflow.id,
    currentStep: workflow.currentStep,
    data: workflow.data,
    complete: false
  };
}

module.exports = {
  generateImage,
  processMakeWorkflow
}; 