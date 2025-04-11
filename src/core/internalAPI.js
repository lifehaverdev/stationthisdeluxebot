/**
 * Internal API
 * 
 * A centralized, interface-agnostic layer that serves as the unified application interface.
 * This module decouples user-facing interfaces (Telegram, Web) from core logic,
 * making the system extensible, testable, and interface-agnostic.
 */

const { CommandRegistry } = require('./command/registry');
const { SessionManager } = require('./session/manager');
const { AppError } = require('./shared/errors/AppError');
const { Logger } = require('../utils/logger');
const { ServiceRegistry } = require('../services/registry');
const { getWorkflowService } = require('../services/comfydeploy/WorkflowService');
const { comfyDeployService } = require('../services/comfydeploy/service');
const express = require('express');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'internalAPI'
});

// Get registry instances
const commandRegistry = CommandRegistry.getInstance();
const serviceRegistry = ServiceRegistry.getInstance();

// Module-level sessionManager instance (will be initialized in setup)
let sessionManager = null;

// Create the Express router for API endpoints
const api = express.Router();

/**
 * Setup the internal API with the required dependencies
 * @param {Object} options - Setup options
 * @param {SessionManager} options.sessionManager - Session manager instance
 * @returns {express.Router} - The configured API router
 */
function setup(options = {}) {
  if (!options.sessionManager) {
    throw new Error('SessionManager is required for internalAPI setup');
  }
  
  sessionManager = options.sessionManager;
  logger.info('Internal API initialized', { system: 'internalAPI' });

  // Add generic API endpoints
  api.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      services: serviceRegistry.getServiceNames() || []
    });
  });

  // Return the configured router
  return api;
}

/**
 * Run a command through the registry
 * @param {string} commandName - Name of the command to run
 * @param {Object} args - Command arguments
 * @param {Object} sessionContext - Session context containing user info
 * @param {string} sessionContext.userId - User ID
 * @returns {Promise<Object>} - Result object with status and data
 */
async function runCommand(commandName, args = {}, sessionContext = {}) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  // Log the command request
  logger.info('Command request received', { 
    system: 'internalAPI',
    command: commandName, 
    userId: sessionContext.userId 
  });

  try {
    // Validate command name
    if (!commandName || typeof commandName !== 'string') {
      throw new AppError('Invalid command name', {
        code: 'INVALID_COMMAND_NAME'
      });
    }

    // Ensure userId is provided in sessionContext
    if (!sessionContext.userId) {
      throw new AppError('userId is required in sessionContext', {
        code: 'MISSING_USER_ID'
      });
    }

    // Get command from registry
    const command = commandRegistry.get(commandName);
    if (!command) {
      throw new AppError(`Command '${commandName}' not found`, {
        code: 'COMMAND_NOT_FOUND'
      });
    }

    // Get user data from session
    const userData = await sessionManager.getUserData(sessionContext.userId);
    
    // Prepare command execution context
    const context = {
      user: {
        id: sessionContext.userId,
        ...sessionContext.userInfo
      },
      platform: sessionContext.platform || { type: 'api' },
      args,
      userData
    };

    // Execute command
    const result = await command.execute(context);

    // Log the command success
    logger.info('Command executed successfully', { 
      system: 'internalAPI',
      command: commandName, 
      userId: sessionContext.userId 
    });

    return {
      status: 'ok',
      result
    };
  } catch (error) {
    // Log the command error
    logger.error('Command execution failed', { 
      system: 'internalAPI',
      command: commandName, 
      userId: sessionContext.userId,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Command execution failed',
      code: error.code || 'COMMAND_EXECUTION_ERROR'
    };
  }
}

/**
 * Get session data for a user
 * @param {string} userId - User ID to get session for
 * @returns {Promise<Object>} - Result object with status and session data
 */
async function getSession(userId) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  // Log the session request
  logger.info('Session request received', { 
    system: 'internalAPI',
    userId 
  });

  try {
    // Validate userId
    if (!userId) {
      throw new AppError('userId is required', {
        code: 'MISSING_USER_ID'
      });
    }

    // Get user data from session
    const userData = await sessionManager.getUserData(userId);
    
    if (!userData) {
      return {
        status: 'error',
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      };
    }

    // Log the session success
    logger.info('Session retrieved successfully', { 
      system: 'internalAPI',
      userId 
    });

    return {
      status: 'ok',
      session: userData
    };
  } catch (error) {
    // Log the session error
    logger.error('Session retrieval failed', { 
      system: 'internalAPI',
      userId,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to retrieve session',
      code: error.code || 'SESSION_RETRIEVAL_ERROR'
    };
  }
}

/**
 * Start a task workflow
 * @param {string} taskName - Name of the task to start
 * @param {Object} payload - Task payload
 * @param {Object} sessionContext - Session context containing user info
 * @param {string} sessionContext.userId - User ID
 * @returns {Promise<Object>} - Result object with status and task data
 */
async function startTask(taskName, payload = {}, sessionContext = {}) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  // Log the task request
  logger.info('Task request received', { 
    system: 'internalAPI',
    task: taskName, 
    userId: sessionContext.userId 
  });

  try {
    // Validate task name
    if (!taskName || typeof taskName !== 'string') {
      throw new AppError('Invalid task name', {
        code: 'INVALID_TASK_NAME'
      });
    }

    // Ensure userId is provided in sessionContext
    if (!sessionContext.userId) {
      throw new AppError('userId is required in sessionContext', {
        code: 'MISSING_USER_ID'
      });
    }

    // NOTE: This is a placeholder for actual task handling
    // In a real implementation, this would delegate to a task manager or workflow engine
    
    // For now, we'll log the task and return a success placeholder
    logger.info('Task started', { 
      system: 'internalAPI',
      task: taskName, 
      userId: sessionContext.userId,
      payload
    });

    // Task ID generation - in a real implementation, this would come from the task system
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return {
      status: 'ok',
      taskId,
      message: `Task ${taskName} started successfully`
    };
    
  } catch (error) {
    // Log the task error
    logger.error('Task start failed', { 
      system: 'internalAPI',
      task: taskName, 
      userId: sessionContext.userId,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to start task',
      code: error.code || 'TASK_START_ERROR'
    };
  }
}

/**
 * Create a new user or update an existing user
 * @param {Object} userData - User data
 * @param {string} [userData.id] - User ID (optional, will be generated if not provided)
 * @param {string} userData.platform - Platform identifier (telegram, web, etc.)
 * @param {string} userData.platformId - Platform-specific ID
 * @param {Object} userData.profile - User profile information
 * @returns {Promise<Object>} - Result object with status and user data
 */
async function createUser(userData = {}) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  logger.info('Create user request received', { 
    system: 'internalAPI',
    platform: userData.platform,
    platformId: userData.platformId
  });

  try {
    // Validate required fields
    if (!userData.platform) {
      throw new AppError('platform is required', {
        code: 'MISSING_PLATFORM'
      });
    }

    if (!userData.platformId) {
      throw new AppError('platformId is required', {
        code: 'MISSING_PLATFORM_ID'
      });
    }

    // Check if user already exists by platform ID
    const existingUser = await sessionManager.getUserByPlatformId(userData.platform, userData.platformId);
    
    if (existingUser) {
      logger.info('User already exists, returning existing user', {
        system: 'internalAPI',
        userId: existingUser.id,
        platform: userData.platform
      });
      
      return {
        status: 'ok',
        user: existingUser,
        isNew: false
      };
    }

    // Create new user
    // In a real implementation, this would call the user repository
    // For now, we're delegating to sessionManager
    const newUser = await sessionManager.createUser({
      id: userData.id || `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      platform: userData.platform,
      platformId: userData.platformId,
      profile: userData.profile || {},
      preferences: userData.preferences || {},
      credits: {
        points: 100, // Default starting points
        lastRefill: new Date().toISOString()
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    logger.info('User created successfully', {
      system: 'internalAPI',
      userId: newUser.id,
      platform: userData.platform
    });

    return {
      status: 'ok',
      user: newUser,
      isNew: true
    };
  } catch (error) {
    logger.error('User creation failed', {
      system: 'internalAPI',
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to create user',
      code: error.code || 'USER_CREATION_ERROR'
    };
  }
}

/**
 * Update user preferences
 * @param {string} userId - User ID
 * @param {Object} preferences - User preferences to update
 * @returns {Promise<Object>} - Result object with status and updated user data
 */
async function updateUserPreferences(userId, preferences = {}) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  logger.info('Update user preferences request received', { 
    system: 'internalAPI',
    userId
  });

  try {
    // Validate userId
    if (!userId) {
      throw new AppError('userId is required', {
        code: 'MISSING_USER_ID'
      });
    }

    // Get current user data
    const userData = await sessionManager.getUserData(userId);
    
    if (!userData) {
      return {
        status: 'error',
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      };
    }

    // Update preferences
    // In a real implementation, this would call the user repository
    // For now, we're delegating to sessionManager
    const updatedUser = await sessionManager.updateUserData(userId, {
      ...userData,
      preferences: {
        ...userData.preferences,
        ...preferences
      },
      updatedAt: new Date().toISOString()
    });

    logger.info('User preferences updated successfully', {
      system: 'internalAPI',
      userId
    });

    return {
      status: 'ok',
      user: updatedUser
    };
  } catch (error) {
    logger.error('User preferences update failed', {
      system: 'internalAPI',
      userId,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to update user preferences',
      code: error.code || 'USER_PREFERENCES_UPDATE_ERROR'
    };
  }
}

/**
 * Get user credit information
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Result object with status and credit data
 */
async function getUserCredit(userId) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  logger.info('Get user credit request received', { 
    system: 'internalAPI',
    userId
  });

  try {
    // Validate userId
    if (!userId) {
      throw new AppError('userId is required', {
        code: 'MISSING_USER_ID'
      });
    }

    // Get user data from session
    const userData = await sessionManager.getUserData(userId);
    
    if (!userData) {
      return {
        status: 'error',
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      };
    }

    // Get credit information
    const credits = userData.credits || {
      points: 0,
      lastRefill: new Date().toISOString()
    };

    logger.info('User credit retrieved successfully', {
      system: 'internalAPI',
      userId
    });

    return {
      status: 'ok',
      credits
    };
  } catch (error) {
    logger.error('User credit retrieval failed', {
      system: 'internalAPI',
      userId,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to get user credit',
      code: error.code || 'USER_CREDIT_RETRIEVAL_ERROR'
    };
  }
}

/**
 * Add credit to a user's account
 * @param {string} userId - User ID
 * @param {number} amount - Amount of points to add
 * @param {string} source - Source of the credit (e.g., 'purchase', 'refill', 'bonus')
 * @returns {Promise<Object>} - Result object with status and updated credit data
 */
async function addUserCredit(userId, amount, source = 'system') {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }

  logger.info('Add user credit request received', { 
    system: 'internalAPI',
    userId,
    amount,
    source
  });

  try {
    // Validate parameters
    if (!userId) {
      throw new AppError('userId is required', {
        code: 'MISSING_USER_ID'
      });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new AppError('amount must be a positive number', {
        code: 'INVALID_AMOUNT'
      });
    }

    // Get current user data
    const userData = await sessionManager.getUserData(userId);
    
    if (!userData) {
      return {
        status: 'error',
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      };
    }

    // Initialize credits if they don't exist
    const currentCredits = userData.credits || {
      points: 0,
      lastRefill: new Date().toISOString()
    };

    // Add credits
    const updatedCredits = {
      ...currentCredits,
      points: (currentCredits.points || 0) + amount,
      lastUpdated: new Date().toISOString()
    };

    // Update user data
    const updatedUser = await sessionManager.updateUserData(userId, {
      ...userData,
      credits: updatedCredits,
      updatedAt: new Date().toISOString()
    });

    // Log the transaction
    // In a real implementation, this would be recorded in a transaction log
    logger.info('User credit added successfully', {
      system: 'internalAPI',
      userId,
      amount,
      source,
      newBalance: updatedCredits.points
    });

    return {
      status: 'ok',
      credits: updatedCredits,
      transaction: {
        amount,
        source,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    logger.error('User credit addition failed', {
      system: 'internalAPI',
      userId,
      amount,
      source,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to add user credit',
      code: error.code || 'USER_CREDIT_ADDITION_ERROR'
    };
  }
}

/**
 * Register a service with the system
 * @param {Object} serviceConfig - Service configuration
 * @param {string} serviceConfig.name - Service name
 * @param {string} serviceConfig.type - Service type
 * @param {Object} serviceConfig.config - Service-specific configuration
 * @returns {Promise<Object>} - Result object with status and service info
 */
async function registerService(serviceConfig = {}) {
  logger.info('Register service request received', { 
    system: 'internalAPI',
    serviceName: serviceConfig.name
  });

  try {
    // Validate service config
    if (!serviceConfig.name) {
      throw new AppError('service name is required', {
        code: 'MISSING_SERVICE_NAME'
      });
    }

    if (!serviceConfig.type) {
      throw new AppError('service type is required', {
        code: 'MISSING_SERVICE_TYPE'
      });
    }

    // Check if service already exists
    if (serviceRegistry.has(serviceConfig.name)) {
      return {
        status: 'error',
        error: `Service '${serviceConfig.name}' already registered`,
        code: 'SERVICE_ALREADY_REGISTERED'
      };
    }

    // Dynamically import the service adapter based on type
    let ServiceAdapterClass;
    try {
      // This would typically import from a services directory
      const adapterModule = require(`../services/${serviceConfig.type}Adapter`);
      ServiceAdapterClass = adapterModule[`${serviceConfig.type}Adapter`];
    } catch (error) {
      throw new AppError(`Service type '${serviceConfig.type}' not supported`, {
        code: 'UNSUPPORTED_SERVICE_TYPE',
        cause: error
      });
    }

    // Create and initialize the service adapter
    const serviceAdapter = new ServiceAdapterClass({
      serviceName: serviceConfig.name,
      config: serviceConfig.config
    });

    // Initialize the service
    await serviceAdapter.init();

    // Register the service
    serviceRegistry.register(serviceAdapter);

    logger.info('Service registered successfully', {
      system: 'internalAPI',
      serviceName: serviceConfig.name,
      serviceType: serviceConfig.type
    });

    return {
      status: 'ok',
      service: {
        name: serviceConfig.name,
        type: serviceConfig.type,
        metadata: serviceAdapter.getMetadata()
      }
    };
  } catch (error) {
    logger.error('Service registration failed', {
      system: 'internalAPI',
      serviceName: serviceConfig.name,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to register service',
      code: error.code || 'SERVICE_REGISTRATION_ERROR'
    };
  }
}

/**
 * Execute a service operation
 * @param {string} serviceName - Name of the service to execute
 * @param {Object} params - Service parameters
 * @param {Object} sessionContext - Session context containing user info
 * @param {string} sessionContext.userId - User ID
 * @returns {Promise<Object>} - Result object with status and service result
 */
async function executeService(serviceName, params = {}, sessionContext = {}) {
  logger.info('Execute service request received', { 
    system: 'internalAPI',
    service: serviceName, 
    userId: sessionContext.userId 
  });

  try {
    // Validate service name
    if (!serviceName) {
      throw new AppError('serviceName is required', {
        code: 'MISSING_SERVICE_NAME'
      });
    }

    // Ensure userId is provided in sessionContext
    if (!sessionContext.userId) {
      throw new AppError('userId is required in sessionContext', {
        code: 'MISSING_USER_ID'
      });
    }

    // Check if service exists
    if (!serviceRegistry.has(serviceName)) {
      return {
        status: 'error',
        error: `Service '${serviceName}' not found`,
        code: 'SERVICE_NOT_FOUND'
      };
    }

    // Get the cost of the service
    const cost = await serviceRegistry.getServiceCost(serviceName, params);

    // Get user credit
    const creditResult = await getUserCredit(sessionContext.userId);
    if (creditResult.status !== 'ok') {
      return creditResult; // Return the error from getUserCredit
    }

    // Check if user has enough credit
    if (creditResult.credits.points < cost) {
      return {
        status: 'error',
        error: 'Insufficient credit',
        code: 'INSUFFICIENT_CREDIT',
        details: {
          required: cost,
          available: creditResult.credits.points
        }
      };
    }

    // Prepare execution context
    const context = {
      user: {
        id: sessionContext.userId,
        ...sessionContext.userInfo
      },
      platform: sessionContext.platform || { type: 'api' }
    };

    // Execute the service
    const result = await serviceRegistry.executeService(serviceName, params, context);

    // Deduct points
    await addUserCredit(sessionContext.userId, -cost, `service:${serviceName}`);

    logger.info('Service executed successfully', {
      system: 'internalAPI',
      service: serviceName,
      userId: sessionContext.userId,
      cost
    });

    return {
      status: 'ok',
      result,
      cost
    };
  } catch (error) {
    logger.error('Service execution failed', {
      system: 'internalAPI',
      service: serviceName,
      userId: sessionContext.userId,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Service execution failed',
      code: error.code || 'SERVICE_EXECUTION_ERROR'
    };
  }
}

/**
 * Get the cost of executing a service
 * @param {string} serviceName - Name of the service
 * @param {Object} params - Service parameters
 * @returns {Promise<Object>} - Result object with status and cost
 */
async function getServiceCost(serviceName, params = {}) {
  logger.info('Get service cost request received', { 
    system: 'internalAPI',
    service: serviceName
  });

  try {
    // Validate service name
    if (!serviceName) {
      throw new AppError('serviceName is required', {
        code: 'MISSING_SERVICE_NAME'
      });
    }

    // Check if service exists
    if (!serviceRegistry.has(serviceName)) {
      return {
        status: 'error',
        error: `Service '${serviceName}' not found`,
        code: 'SERVICE_NOT_FOUND'
      };
    }

    // Get the cost
    const cost = await serviceRegistry.getServiceCost(serviceName, params);

    logger.info('Service cost retrieved successfully', {
      system: 'internalAPI',
      service: serviceName,
      cost
    });

    return {
      status: 'ok',
      cost
    };
  } catch (error) {
    logger.error('Service cost retrieval failed', {
      system: 'internalAPI',
      service: serviceName,
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to get service cost',
      code: error.code || 'SERVICE_COST_ERROR'
    };
  }
}

/**
 * Get information about available services
 * @returns {Promise<Object>} - Result object with status and services info
 */
async function getServices() {
  logger.info('Get services request received', { 
    system: 'internalAPI'
  });

  try {
    // Get all service metadata
    const servicesMetadata = serviceRegistry.getServicesMetadata();

    logger.info('Services retrieved successfully', {
      system: 'internalAPI',
      count: servicesMetadata.length
    });

    return {
      status: 'ok',
      services: servicesMetadata
    };
  } catch (error) {
    logger.error('Services retrieval failed', {
      system: 'internalAPI',
      error
    });

    return {
      status: 'error',
      error: error.message || 'Failed to get services',
      code: error.code || 'SERVICES_RETRIEVAL_ERROR'
    };
  }
}

/**
 * Get available workflows
 * @returns {Promise<Object>} - Result object with status and workflow data
 */
async function getWorkflows() {
  try {
    // Get workflow service
    const workflowService = getWorkflowService();
    
    // Get workflows
    const workflows = workflowService.getAllWorkflows();
    
    // Format workflows for API response
    const formattedWorkflows = workflows.map(workflow => ({
      name: workflow.name,
      inputs: Object.keys(workflow.inputs || {}),
      active: workflow.active !== false
    }));
    
    logger.info('Workflow list retrieved', { 
      system: 'internalAPI',
      count: formattedWorkflows.length
    });
    
    return {
      status: 'ok',
      workflows: formattedWorkflows
    };
  } catch (error) {
    logger.error('Error retrieving workflows', { 
      system: 'internalAPI',
      error
    });
    
    return {
      status: 'error',
      error: error.message || 'Failed to retrieve workflows',
      code: error.code || 'WORKFLOW_RETRIEVAL_ERROR'
    };
  }
}

/**
 * Get workflow details by name
 * @param {string} name - Workflow name
 * @returns {Promise<Object>} - Result object with status and workflow data
 */
async function getWorkflowByName(name) {
  try {
    // Validate workflow name
    if (!name) {
      throw new AppError('Workflow name is required', {
        code: 'MISSING_WORKFLOW_NAME'
      });
    }
    
    // Get workflow service
    const workflowService = getWorkflowService();
    
    // Get workflow
    const workflow = workflowService.getWorkflowByName(name);
    
    if (!workflow) {
      return {
        status: 'error',
        error: `Workflow '${name}' not found`,
        code: 'WORKFLOW_NOT_FOUND'
      };
    }
    
    logger.info('Workflow retrieved', { 
      system: 'internalAPI',
      workflow: name
    });
    
    return {
      status: 'ok',
      workflow: {
        name: workflow.name,
        inputs: workflow.inputs,
        active: workflow.active !== false
      }
    };
  } catch (error) {
    logger.error('Error retrieving workflow', { 
      system: 'internalAPI',
      workflow: name,
      error
    });
    
    return {
      status: 'error',
      error: error.message || 'Failed to retrieve workflow',
      code: error.code || 'WORKFLOW_RETRIEVAL_ERROR'
    };
  }
}

/**
 * Execute a workflow
 * @param {string} workflowName - Workflow name
 * @param {Object} params - Workflow parameters
 * @param {Object} sessionContext - Session context
 * @returns {Promise<Object>} - Result object with status and task data
 */
async function executeWorkflow(workflowName, params = {}, sessionContext = {}) {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }
  
  logger.info('Workflow execution request received', { 
    system: 'internalAPI',
    workflow: workflowName, 
    userId: sessionContext.userId 
  });
  
  try {
    // Validate workflow name
    if (!workflowName) {
      throw new AppError('Workflow name is required', {
        code: 'MISSING_WORKFLOW_NAME'
      });
    }
    
    // Ensure userId is provided in sessionContext
    if (!sessionContext.userId) {
      throw new AppError('userId is required in sessionContext', {
        code: 'MISSING_USER_ID'
      });
    }
    
    // Get user data from session
    const userData = await sessionManager.getUserData(sessionContext.userId);
    
    // Get workflow service to validate workflow
    const workflowService = getWorkflowService();
    const workflow = workflowService.getWorkflowByName(workflowName);
    
    if (!workflow) {
      throw new AppError(`Workflow '${workflowName}' not found`, {
        code: 'WORKFLOW_NOT_FOUND'
      });
    }
    
    if (workflow.active === false) {
      throw new AppError(`Workflow '${workflowName}' is not active`, {
        code: 'WORKFLOW_INACTIVE'
      });
    }
    
    // Prepare execution context
    const context = {
      user: {
        id: sessionContext.userId,
        ...userData,
        ...sessionContext.userInfo
      },
      platform: sessionContext.platform || { type: 'api' }
    };
    
    // Execute workflow via ComfyDeploy service
    const executeParams = {
      type: workflowName,
      prompt: params.prompt || params.positive_prompt || '',
      negativePrompt: params.negative_prompt || '',
      settings: {
        seed: params.seed,
        ...(params.settings || {})
      },
      inputImages: params.inputImages || {}
    };
    
    // Use the service registry to execute the service
    const result = await executeService('comfydeploy', executeParams, context);
    
    if (result.status === 'error') {
      throw new AppError(result.error, {
        code: result.code || 'WORKFLOW_EXECUTION_ERROR'
      });
    }
    
    logger.info('Workflow executed successfully', { 
      system: 'internalAPI',
      workflow: workflowName, 
      userId: sessionContext.userId,
      taskId: result.result.taskId
    });
    
    return {
      status: 'ok',
      task: result.result
    };
  } catch (error) {
    logger.error('Workflow execution failed', { 
      system: 'internalAPI',
      workflow: workflowName, 
      userId: sessionContext.userId,
      error
    });
    
    return {
      status: 'error',
      error: error.message || 'Workflow execution failed',
      code: error.code || 'WORKFLOW_EXECUTION_ERROR'
    };
  }
}

// Export all API functions
module.exports = {
  setup,
  runCommand,
  getSession,
  startTask,
  createUser,
  updateUserPreferences,
  getUserCredit,
  addUserCredit,
  registerService,
  executeService,
  getServiceCost,
  getServices,
  // Workflow-related functions
  getWorkflows,
  getWorkflowByName,
  executeWorkflow
}; 