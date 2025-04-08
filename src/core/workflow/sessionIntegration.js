/**
 * Workflow Session Integration
 * 
 * Helper functions to integrate the workflow system with the SessionManager.
 * Provides methods to store, retrieve, and manage workflow states in user sessions.
 */

const { WorkflowState, WorkflowStep } = require('./state');
const { AppError, ERROR_SEVERITY } = require('../shared/errors');

/**
 * Store a workflow in a user's session
 * @param {Object} sessionManager - SessionManager instance
 * @param {string} userId - User ID
 * @param {WorkflowState} workflow - Workflow state to store
 * @param {string} [namespace='workflows'] - Session namespace for workflows
 * @returns {Promise<boolean>} Success
 */
async function storeWorkflow(sessionManager, userId, workflow, namespace = 'workflows') {
  if (!sessionManager) {
    throw new AppError('SessionManager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_MANAGER_REQUIRED'
    });
  }

  if (!userId) {
    throw new AppError('User ID is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'USER_ID_REQUIRED'
    });
  }

  if (!workflow || !(workflow instanceof WorkflowState)) {
    throw new AppError('Valid workflow instance is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_INVALID'
    });
  }

  // Extract workflow ID from context
  const workflowId = workflow.id || (workflow.context && workflow.context.workflowId);
  if (!workflowId) {
    throw new AppError('Workflow ID is missing', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_ID_MISSING'
    });
  }

  // Serialize the workflow for storage
  // Use JSON.stringify instead of serialize (it will use toJSON internally)
  const serialized = JSON.parse(JSON.stringify(workflow));

  try {
    // Store in session
    await sessionManager.updateSession(userId, {
      [`${namespace}.${workflowId}`]: serialized
    });
    return true;
  } catch (error) {
    throw new AppError('Failed to store workflow in session', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_STORE_FAILED',
      cause: error
    });
  }
}

/**
 * Retrieve a workflow from a user's session
 * @param {Object} sessionManager - SessionManager instance
 * @param {string} userId - User ID
 * @param {string} workflowId - Workflow ID to retrieve
 * @param {Object} steps - Step definitions for deserialization
 * @param {string} [namespace='workflows'] - Session namespace for workflows
 * @returns {Promise<WorkflowState|null>} Retrieved workflow or null if not found
 */
async function retrieveWorkflow(sessionManager, userId, workflowId, steps, namespace = 'workflows') {
  if (!sessionManager) {
    throw new AppError('SessionManager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_MANAGER_REQUIRED'
    });
  }

  if (!userId) {
    throw new AppError('User ID is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'USER_ID_REQUIRED'
    });
  }

  if (!workflowId) {
    throw new AppError('Workflow ID is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_ID_REQUIRED'
    });
  }

  if (!steps || typeof steps !== 'object') {
    throw new AppError('Step definitions are required for deserialization', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'STEPS_REQUIRED'
    });
  }

  try {
    // Get session
    const session = await sessionManager.getSession(userId);
    if (!session) {
      return null;
    }

    // Get serialized workflow from session
    const serialized = session.get(`${namespace}.${workflowId}`);
    if (!serialized) {
      return null;
    }

    // Create a new WorkflowState from serialized data
    return new WorkflowState({
      id: serialized.id || workflowId,
      name: serialized.name,
      steps: steps,
      startStep: serialized.startStep,
      currentStep: serialized.currentStep,
      data: serialized.data || {},
      history: serialized.history || [],
      context: serialized.context || {}
    });
  } catch (error) {
    throw new AppError('Failed to retrieve workflow from session', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_RETRIEVE_FAILED',
      cause: error
    });
  }
}

/**
 * Delete a workflow from a user's session
 * @param {Object} sessionManager - SessionManager instance
 * @param {string} userId - User ID
 * @param {string} workflowId - Workflow ID to delete
 * @param {string} [namespace='workflows'] - Session namespace for workflows
 * @returns {Promise<boolean>} Success
 */
async function deleteWorkflow(sessionManager, userId, workflowId, namespace = 'workflows') {
  if (!sessionManager || !userId || !workflowId) {
    throw new AppError('SessionManager, userId, and workflowId are required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'PARAMETERS_REQUIRED'
    });
  }

  try {
    // Get session
    const session = await sessionManager.getSession(userId);
    if (!session) {
      return false;
    }

    // Check if workflow exists
    const workflowExists = session.has(`${namespace}.${workflowId}`);
    if (!workflowExists) {
      return false;
    }

    // Handle different session implementations
    if (typeof session.unset === 'function') {
      // If session has unset method
      await session.unset(`${namespace}.${workflowId}`);
    } else if (sessionManager.updateSession) {
      // Get all workflows
      const workflows = session.get(namespace) || {};
      
      // Create a new object without the workflow to delete
      const updatedWorkflows = {};
      for (const [id, workflow] of Object.entries(workflows)) {
        if (id !== workflowId) {
          updatedWorkflows[id] = workflow;
        }
      }
      
      // Update session with modified workflows object
      await sessionManager.updateSession(userId, {
        [namespace]: updatedWorkflows
      });
    } else {
      // If no way to modify session, can't delete
      return false;
    }

    return true;
  } catch (error) {
    throw new AppError('Failed to delete workflow from session', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOW_DELETE_FAILED',
      cause: error
    });
  }
}

/**
 * Get all workflows for a user
 * @param {Object} sessionManager - SessionManager instance
 * @param {string} userId - User ID
 * @param {string} [namespace='workflows'] - Session namespace for workflows
 * @returns {Promise<Object>} Map of workflow IDs to serialized workflows
 */
async function getAllWorkflows(sessionManager, userId, namespace = 'workflows') {
  if (!sessionManager || !userId) {
    throw new AppError('SessionManager and userId are required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'PARAMETERS_REQUIRED'
    });
  }

  try {
    // Get session
    const session = await sessionManager.getSession(userId);
    if (!session) {
      return {};
    }

    // Get all workflows
    return session.get(namespace) || {};
  } catch (error) {
    throw new AppError('Failed to get workflows from session', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOWS_GET_FAILED',
      cause: error
    });
  }
}

/**
 * Find active workflows by type
 * @param {Object} sessionManager - SessionManager instance
 * @param {string} userId - User ID
 * @param {string} workflowName - Name of the workflow to find
 * @param {string} [namespace='workflows'] - Session namespace for workflows
 * @returns {Promise<Array>} Array of workflow IDs matching the name
 */
async function findWorkflowsByName(sessionManager, userId, workflowName, namespace = 'workflows') {
  if (!sessionManager || !userId || !workflowName) {
    throw new AppError('SessionManager, userId, and workflowName are required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'PARAMETERS_REQUIRED'
    });
  }

  try {
    // Get all workflows
    const workflows = await getAllWorkflows(sessionManager, userId, namespace);

    // Filter by name
    const matchingWorkflows = [];
    for (const [workflowId, serialized] of Object.entries(workflows)) {
      // Check both name and sequenceName for compatibility
      if (
        serialized.name === workflowName || 
        (serialized.context && serialized.context.sequenceName === workflowName)
      ) {
        matchingWorkflows.push(workflowId);
      }
    }

    return matchingWorkflows;
  } catch (error) {
    throw new AppError('Failed to find workflows by name', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'WORKFLOWS_FIND_FAILED',
      cause: error
    });
  }
}

/**
 * Create a middleware function for workflow session integration
 * @param {Object} sessionManager - SessionManager instance
 * @param {string} [namespace='workflows'] - Session namespace for workflows
 * @returns {Function} Express middleware function
 */
function createWorkflowMiddleware(sessionManager, namespace = 'workflows') {
  if (!sessionManager) {
    throw new AppError('SessionManager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_MANAGER_REQUIRED'
    });
  }

  return async function workflowMiddleware(context, next) {
    // Add workflow helpers to the request object
    context.workflows = {
      store: (workflow) => storeWorkflow(sessionManager, context.userId, workflow, namespace),
      retrieve: (workflowId, steps) => retrieveWorkflow(sessionManager, context.userId, workflowId, steps, namespace),
      delete: (workflowId) => deleteWorkflow(sessionManager, context.userId, workflowId, namespace),
      getAll: () => getAllWorkflows(sessionManager, context.userId, namespace),
      findByName: (name) => findWorkflowsByName(sessionManager, context.userId, name, namespace)
    };

    return next();
  };
}

module.exports = {
  storeWorkflow,
  retrieveWorkflow,
  deleteWorkflow,
  getAllWorkflows,
  findWorkflowsByName,
  createWorkflowMiddleware
}; 