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
const { 
  GuestAccessService,
  isGuestUser 
} = require('../api/guestAccess');

// Import routes
const sessionRoutes = require('./internalAPI/routes/sessionRoutes');

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
let workflowManager = null;
let guestAccessService = null;

// Create the Express router for API endpoints
const api = express.Router();

/**
 * Setup the internal API with the required dependencies
 * @param {Object} options - Setup options
 * @param {SessionManager} options.sessionManager - Session manager instance
 * @param {WorkflowManager} options.workflowManager - Workflow manager instance
 * @returns {express.Router} - The configured API router
 */
function setup(options = {}) {
  if (!options.sessionManager) {
    throw new Error('SessionManager is required for internalAPI setup');
  }
  
  sessionManager = options.sessionManager;
  workflowManager = options.workflowManager; // Store the workflow manager reference
  logger.info('Internal API initialized', { system: 'internalAPI' });

  // Synchronize workflows if workflowManager is available
  if (workflowManager) {
    // Use setTimeout to not block the initialization
    setTimeout(async () => {
      try {
        const workflowService = getWorkflowService();
        if (workflowService) {
          logger.info('Synchronizing workflows between manager and service', { 
            system: 'internalAPI' 
          });
          
          const result = await workflowManager.synchronizeWithWorkflowService();
          
          logger.info('Workflow synchronization completed', { 
            system: 'internalAPI',
            success: result.success,
            managerToService: result.managerToService,
            serviceToManager: result.serviceToManager
          });
        }
      } catch (error) {
        logger.error('Error synchronizing workflows at startup', {
          system: 'internalAPI',
          error
        });
      }
    }, 1000);
  }

  // Mount session routes
  api.use('/session', sessionRoutes);

  // Add generic API endpoints
  api.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      services: serviceRegistry.getServiceNames() || []
    });
  });

  // Add workflows endpoint
  api.get('/workflows', async (req, res) => {
    logger.debug('Workflows endpoint called', { system: 'internalAPI' });
    const result = await getWorkflows();
    
    // Add detailed logging about the workflows being returned
    if (result.status === 'ok' && result.workflows) {
      logger.info('Returning workflows to client', { 
        system: 'internalAPI', 
        count: result.workflows.length,
        workflowNames: result.workflows.map(w => w.name).join(', ') 
      });
    } else {
      logger.warn('No workflows or error returning workflows', { 
        system: 'internalAPI',
        status: result.status,
        error: result.error
      });
    }
    
    res.json(result);
  });

  // Add workflow details endpoint
  api.get('/workflows/:name', async (req, res) => {
    const result = await getWorkflowByName(req.params.name);
    res.json(result);
  });

  // Add workflow diagnostics endpoint
  api.get('/diagnostics/workflows', async (req, res) => {
    if (!workflowManager) {
      return res.json({
        status: 'error',
        error: 'Workflow manager not initialized'
      });
    }
    
    try {
      const diagnostics = await workflowManager.getDiagnostics();
      res.json({
        status: 'ok',
        diagnostics
      });
    } catch (error) {
      logger.error('Error retrieving workflow diagnostics', {
        system: 'internalAPI',
        error
      });
      
      res.json({
        status: 'error',
        error: error.message || 'Failed to retrieve workflow diagnostics'
      });
    }
  });

  // Add enhanced workflow diagnostics endpoint using new utility
  api.get('/diagnostics/workflows/detailed', async (req, res) => {
    try {
      // Import the workflow diagnostics utility
      const { getWorkflowDiagnostics } = require('../utils/workflowDiagnostics');
      
      // Get detailed diagnostics
      const diagnostics = await getWorkflowDiagnostics({ workflowManager });
      
      res.json({
        status: 'ok',
        diagnostics
      });
    } catch (error) {
      logger.error('Error retrieving detailed workflow diagnostics', {
        system: 'internalAPI',
        error
      });
      
      res.json({
        status: 'error',
        error: error.message || 'Failed to retrieve detailed workflow diagnostics'
      });
    }
  });

  // Add workflow synchronization endpoint (original version for backwards compatibility)
  api.post('/workflows/synchronize', async (req, res) => {
    if (!workflowManager) {
      return res.json({
        status: 'error',
        error: 'Workflow manager not initialized'
      });
    }
    
    try {
      const bidirectional = req.body.bidirectional !== false; // Default to true
      const result = await workflowManager.synchronizeWithWorkflowService(bidirectional);
      
      logger.info('Manual workflow synchronization completed', { 
        system: 'internalAPI',
        success: result.success,
        bidirectional
      });
      
      res.json({
        status: result.success ? 'ok' : 'error',
        result
      });
    } catch (error) {
      logger.error('Error synchronizing workflows', {
        system: 'internalAPI',
        error
      });
      
      res.json({
        status: 'error',
        error: error.message || 'Failed to synchronize workflows'
      });
    }
  });

  // Add workflow synchronization endpoint with detailed report
  api.post('/workflows/synchronize/detailed', async (req, res) => {
    if (!workflowManager) {
      return res.json({
        status: 'error',
        error: 'Workflow manager not initialized'
      });
    }
    
    try {
      // Import the workflow diagnostics utility
      const { syncAllWorkflows } = require('../utils/workflowDiagnostics');
      
      // Force param - defaults to false
      const force = req.body.force === true;
      
      // Run the sync operation
      const result = await syncAllWorkflows({ 
        workflowManager,
        force
      });
      
      logger.info('Detailed workflow synchronization completed', { 
        system: 'internalAPI',
        success: result.success,
        force
      });
      
      res.json({
        status: result.success ? 'ok' : 'error',
        result
      });
    } catch (error) {
      logger.error('Error in detailed workflow synchronization', {
        system: 'internalAPI',
        error
      });
      
      res.json({
        status: 'error',
        error: error.message || 'Failed to synchronize workflows'
      });
    }
  });

  // Add workflow execution endpoint
  api.post('/workflows/execute/:name', async (req, res) => {
    const workflowName = req.params.name;
    const inputs = req.body.inputs || {};
    
    // Create a proper session context
    const sessionContext = {
      // Use provided userId if available, otherwise will be set in executeWorkflow
      userId: req.body.userId,
      // Define platform as web for proper userId generation if needed
      platform: { type: 'web' },
      // Add any user info that might be provided
      userInfo: {
        ...(req.body.userInfo || {}),
        // Support wallet address specifically
        walletAddress: req.body.walletAddress || req.body.userInfo?.walletAddress,
        // Support API key specifically
        apiKey: req.body.apiKey || req.body.userInfo?.apiKey
      }
    };
    
    logger.debug('Preparing to execute workflow', {
      system: 'internalAPI',
      workflow: workflowName,
      providedUserId: req.body.userId ? 'yes' : 'no',
      hasWallet: sessionContext.userInfo.walletAddress ? 'yes' : 'no',
      hasApiKey: sessionContext.userInfo.apiKey ? 'yes' : 'no'
    });
    
    const result = await executeWorkflow(workflowName, inputs, sessionContext);
    res.json(result);
  });

  // File upload endpoint for workflow inputs
  api.post('/upload', (req, res) => {
    // This would typically handle file uploads
    // For now, just return a success response
    res.json({
      status: 'ok',
      files: {}
    });
  });

  // Initialize guest access service if session manager is available
  if (sessionManager) {
    guestAccessService = new GuestAccessService({
      sessionManager,
      workflowManager
    });
    
    logger.info('Guest access service initialized');
  }

  // After the validateApiKey endpoint and before the router is returned
  api.post('/session/validate-api-key', async (req, res) => {
    const { apiKey } = req.body;
    const result = await validateApiKey(apiKey);
    res.json(result);
  });

  // Add the guest session endpoint
  api.post('/session/guest', async (req, res) => {
    const result = await createGuestSession();
    res.json(result);
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

    // Check if it's a guest user ID
    if (isGuestUser(userId)) {
      const guestSession = guestAccessService ? 
        await guestAccessService.getGuestSession(userId) : null;
      
      if (guestSession) {
        return {
          status: 'ok',
          session: {
            userId: userId,
            isGuest: true,
            requestsRemaining: guestSession.requestsRemaining,
            requestsLimit: guestSession.requestsLimit || 3,
            requestsUsed: guestSession.requestsUsed || 0,
            expiresAt: guestSession.expiresAt
          }
        };
      }
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
    userId: sessionContext.userId || (sessionContext.user && sessionContext.user.id)
  });

  try {
    // Validate service name
    if (!serviceName) {
      throw new AppError('serviceName is required', {
        code: 'MISSING_SERVICE_NAME'
      });
    }
    
    // Log detailed context for debugging
    logger.debug('Execute service context details', {
      system: 'internalAPI',
      service: serviceName,
      hasDirectUserId: !!sessionContext.userId,
      hasUserObject: !!sessionContext.user,
      hasUserObjectId: !!(sessionContext.user && sessionContext.user.id),
      paramsHasUserId: !!params.userId,
      contextKeys: Object.keys(sessionContext)
    });

    // Handle case where userId might be nested in user object instead of at top level
    if (!sessionContext.userId && sessionContext.user && sessionContext.user.id) {
      sessionContext.userId = sessionContext.user.id;
      logger.debug('Using userId from user.id', {
        system: 'internalAPI',
        service: serviceName,
        userId: sessionContext.userId
      });
    }

    // Also check if userId is in the params
    if (!sessionContext.userId && params.userId) {
      sessionContext.userId = params.userId;
      logger.debug('Using userId from params', {
        system: 'internalAPI',
        service: serviceName,
        userId: sessionContext.userId
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
      const availableServices = serviceRegistry.getServiceNames();
      logger.error(`Service '${serviceName}' not found`, {
        system: 'internalAPI',
        availableServices
      });
      
      throw new AppError(`Service '${serviceName}' not found`, {
        code: 'SERVICE_NOT_FOUND'
      });
    }

    // Execute the service through the registry
    const result = await serviceRegistry.executeService(serviceName, params, sessionContext);
    
    // Log success
    logger.info('Service execution successful', {
      system: 'internalAPI',
      service: serviceName,
      userId: sessionContext.userId
    });

    return {
      status: 'ok',
      result
    };
  } catch (error) {
    // Log failure
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
 * Get the cost of a service with the given parameters
 * @param {string} serviceName - Service name
 * @param {Object} params - Service parameters
 * @returns {Promise<Object>} - Result object with status and cost data
 */
async function getServiceCost(serviceName, params = {}) {
  try {
    // Validate service name
    if (!serviceName) {
      throw new AppError('serviceName is required', {
        code: 'MISSING_SERVICE_NAME'
      });
    }

    // Check if service exists
    if (!serviceRegistry.has(serviceName)) {
      throw new AppError(`Service '${serviceName}' not found`, {
        code: 'SERVICE_NOT_FOUND'
      });
    }

    // Get cost from the registry
    const cost = await serviceRegistry.getServiceCost(serviceName, params);
    
    logger.info('Service cost retrieved', { 
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
 * Get available services
 * @returns {Promise<Object>} - Result object with status and services data
 */
async function getServices() {
  try {
    // Get services from the registry
    const serviceNames = serviceRegistry.getServiceNames();
    const servicesMetadata = serviceRegistry.getServicesMetadata();
    
    logger.info('Services list retrieved', { 
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
    // Get workflows from both sources
    const workflowsMap = new Map();
    
    // First, get workflows from the workflow manager
    if (workflowManager) {
      const managerWorkflows = workflowManager.getWorkflowDefinitions();
      
      // Log details of manager workflows
      logger.debug('Raw manager workflows:', { 
        system: 'internalAPI',
        workflowCount: Object.keys(managerWorkflows).length,
        firstWorkflow: Object.values(managerWorkflows)[0] ? 
          { 
            name: Object.values(managerWorkflows)[0].name,
            hasInputs: !!Object.values(managerWorkflows)[0].inputs,
            inputsType: Object.values(managerWorkflows)[0].inputs ? 
              typeof Object.values(managerWorkflows)[0].inputs : 'undefined',
            inputsLength: Object.values(managerWorkflows)[0].inputs && 
              Array.isArray(Object.values(managerWorkflows)[0].inputs) ? 
              Object.values(managerWorkflows)[0].inputs.length : 'not an array'
          } : 'none'
      });
      
      // Add each workflow to the map
      Object.entries(managerWorkflows).forEach(([name, workflow]) => {
        // Log the structure of each workflow's inputs
        logger.debug(`Workflow ${name} inputs:`, {
          system: 'internalAPI',
          hasInputs: !!workflow.inputs,
          inputsType: typeof workflow.inputs,
          isArray: Array.isArray(workflow.inputs),
          inputsValue: workflow.inputs
        });
        
        workflowsMap.set(name, {
          name: workflow.name || name,
          inputs: workflow.inputs || [],
          active: workflow.active !== false,
          source: 'manager'
        });
      });
      
      logger.debug('Got workflows from manager', { 
        system: 'internalAPI',
        count: workflowsMap.size
      });
    } else {
      logger.warn('Workflow manager not initialized', { system: 'internalAPI' });
    }
    
    // Next, get workflows from the workflow service
    const workflowService = getWorkflowService();
    if (workflowService) {
      const serviceWorkflows = workflowService.getAllWorkflows() || [];
      
      // Log details of service workflows
      logger.debug('Raw service workflows:', { 
        system: 'internalAPI',
        workflowCount: serviceWorkflows.length,
        firstWorkflow: serviceWorkflows[0] ? 
          { 
            name: serviceWorkflows[0].name,
            hasInputs: !!serviceWorkflows[0].inputs,
            inputsType: serviceWorkflows[0].inputs ? 
              typeof serviceWorkflows[0].inputs : 'undefined',
            inputsIsArray: Array.isArray(serviceWorkflows[0].inputs),
            inputsIsObject: serviceWorkflows[0].inputs && 
              typeof serviceWorkflows[0].inputs === 'object' &&
              !Array.isArray(serviceWorkflows[0].inputs)
          } : 'none'
      });
      
      // Add each workflow to the map, possibly overwriting manager workflows
      serviceWorkflows.forEach(workflow => {
        const name = workflow.name;
        
        // If inputs is an object but not an array, convert object keys to array
        let inputs = workflow.inputs || [];
        if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
          // Convert object keys to array of input names
          inputs = Object.keys(inputs).map(key => key.startsWith('input_') ? key : `input_${key}`);
          logger.debug(`Converted object inputs to array for ${name}:`, {
            system: 'internalAPI',
            originalInputs: workflow.inputs,
            convertedInputs: inputs
          });
        }
        
        workflowsMap.set(name, {
          name,
          inputs: inputs,
          active: workflow.active !== false,
          source: workflowsMap.has(name) ? 'both' : 'service'
        });
      });
      
      logger.debug('Got workflows from service', { 
        system: 'internalAPI',
        count: serviceWorkflows.length
      });
    } else {
      logger.warn('Workflow service not initialized', { system: 'internalAPI' });
    }
    
    // Convert map to array for response
    const formattedWorkflows = Array.from(workflowsMap.values());
    
    // Log the final formatted workflows with input details
    formattedWorkflows.forEach(workflow => {
      logger.debug(`Formatted workflow ${workflow.name}:`, {
        system: 'internalAPI',
        inputsType: typeof workflow.inputs,
        isArray: Array.isArray(workflow.inputs),
        inputCount: Array.isArray(workflow.inputs) ? workflow.inputs.length : 'not an array',
        sampleInputs: Array.isArray(workflow.inputs) && workflow.inputs.length > 0 ? 
          workflow.inputs.slice(0, 3) : workflow.inputs
      });
    });
    
    // If no workflows were found in either source, try to synchronize
    if (formattedWorkflows.length === 0 && workflowManager && workflowService) {
      logger.info('No workflows found, attempting synchronization', { system: 'internalAPI' });
      
      // Try to synchronize and then fetch workflows again
      await workflowManager.synchronizeWithWorkflowService();
      
      // Retry getting workflows from both sources
      return await getWorkflows();
    }
    
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
    
    // First try to get workflow from the workflow service
    const workflowService = getWorkflowService();
    let workflow = null;
    
    if (workflowService) {
      workflow = workflowService.getWorkflowByName(name);
    }
    
    // If not found in service, try to get it from the workflow manager
    if (!workflow && workflowManager) {
      workflow = workflowManager.getWorkflowDefinition(name);
      if (workflow) {
        logger.info(`Using workflow '${name}' from workflow manager`, {
          system: 'internalAPI'
        });
      }
    }
    
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
  
  // Ensure userId is properly set for web users
  if (!sessionContext.userId) {
    // For web interface, create a standardized userId format
    if (sessionContext.platform && sessionContext.platform.type === 'web') {
      if (sessionContext.userInfo && sessionContext.userInfo.walletAddress) {
        // Logged in with wallet
        sessionContext.userId = `webuser_${sessionContext.userInfo.walletAddress}`;
        logger.info('Set userId for web wallet user', { 
          system: 'internalAPI',
          walletAddress: sessionContext.userInfo.walletAddress 
        });
      } else if (sessionContext.userInfo && sessionContext.userInfo.apiKey) {
        // Logged in with API key
        sessionContext.userId = `webuser_apikey_${sessionContext.userInfo.apiKey.substring(0, 8)}`;
        logger.info('Set userId for web API key user', { 
          system: 'internalAPI',
          apiKeyPrefix: sessionContext.userInfo.apiKey.substring(0, 8)
        });
      } else {
        // Guest user
        sessionContext.userId = `webuser_guest_${Date.now()}`;
        logger.info('Set userId for web guest user', { 
          system: 'internalAPI'
        });
      }
    } else {
      // Default userId if none provided and not web
      sessionContext.userId = `unknown_${Date.now()}`;
      logger.warn('No userId provided, using generated ID', {
        system: 'internalAPI',
        generatedId: sessionContext.userId
      });
    }
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
    
    // Ensure userId is provided in sessionContext (double check after our fixes above)
    if (!sessionContext.userId) {
      throw new AppError('userId is required in sessionContext and could not be generated', {
        code: 'MISSING_USER_ID'
      });
    }
    
    // Get user data from session
    const userData = await sessionManager.getUserData(sessionContext.userId);
    
    // First try to get workflow from the workflow service
    const workflowService = getWorkflowService();
    let workflow = null;
    
    if (workflowService) {
      workflow = workflowService.getWorkflowByName(workflowName);
    }
    
    // If not found in service, try to get it from the workflow manager
    if (!workflow && workflowManager) {
      workflow = workflowManager.getWorkflowDefinition(workflowName);
      if (workflow) {
        logger.info(`Using workflow '${workflowName}' from workflow manager`, {
          system: 'internalAPI',
          workflow: workflowName
        });
      }
    }
    
    // If still not found, try to synchronize services and try again
    if (!workflow && workflowManager && workflowService) {
      // Try to synchronize workflow definitions between manager and service
      logger.info(`Workflow '${workflowName}' not found, attempting synchronization`, {
        system: 'internalAPI'
      });
      
      await workflowManager.synchronizeWithWorkflowService();
      
      // Try again after synchronization
      workflow = workflowService.getWorkflowByName(workflowName);
      if (!workflow) {
        workflow = workflowManager.getWorkflowDefinition(workflowName);
      }
    }
    
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
    
    // If user is a guest, check and track their workflow access
    if (isGuestUser(sessionContext.userId) && guestAccessService) {
      // Check if guest can access workflow
      const canAccess = await guestAccessService.canAccessWorkflow(
        sessionContext.userId, 
        workflowName
      );
      
      if (!canAccess) {
        return {
          status: 'error',
          error: 'Guest request limit exceeded',
          code: 'GUEST_LIMIT_EXCEEDED'
        };
      }
      
      // Track this workflow request
      await guestAccessService.trackWorkflowRequest(
        sessionContext.userId, 
        workflowName
      );
    }
    
    // Prepare execution context
    const context = {
      user: {
        id: sessionContext.userId,
        ...userData,
        ...sessionContext.userInfo
      },
      platform: sessionContext.platform || { type: 'api' },
      userId: sessionContext.userId
    };
    
    // Add debugging logs for userId tracking
    logger.debug('Execution context prepared for service call', {
      system: 'internalAPI',
      workflow: workflowName,
      contextUserId: context.userId,
      userObjectId: context.user.id,
      originalUserId: sessionContext.userId
    });
    
    console.log('PROCESSING WORKFLOW INPUTS:', {
      workflow: workflowName,
      originalParams: params,
      numericKeys: Object.keys(params).filter(k => !isNaN(parseInt(k))),
      inputPrefixedKeys: Object.keys(params).filter(k => k.startsWith('input_'))
    });
    
    // Execute workflow via ComfyDeploy service
    const executeParams = {
      type: workflowName,
      prompt: params.prompt || params.positive_prompt || '',
      negativePrompt: params.negative_prompt || '',
      settings: params.settings || {},
      inputImages: params.inputImages || {},
      // Include userId directly in executeParams as well
      userId: sessionContext.userId
    };
    
    // Process numeric keys (indexed inputs)
    Object.entries(params).forEach(([key, value]) => {
      if (!isNaN(parseInt(key))) {
        const inputName = value;
        
        let inputValue = params[inputName];
        if (inputValue === undefined) {
          const shortName = inputName.replace('input_', '');
          inputValue = params[shortName];
        }
        
        if (inputValue !== undefined) {
          executeParams.settings[inputName] = inputValue;
          console.log(`Mapped indexed input ${key}: ${inputName} -> ${inputValue}`);
        }
      }
    });
    
    // Process direct input parameters (keys that already have input_ prefix)
    Object.entries(params).forEach(([key, value]) => {
      if (key.startsWith('input_') && value !== undefined && value !== null) {
        executeParams.settings[key] = value;
        console.log(`Using direct input parameter: ${key} = ${value}`);
      }
    });
    
    // Process other meaningful parameters (no prefix)
    Object.entries(params).forEach(([key, value]) => {
      if (!isNaN(parseInt(key)) || key.startsWith('input_') || executeParams.settings[`input_${key}`]) {
        return;
      }
      
      if (typeof value !== 'object' && value !== undefined && value !== null) {
        executeParams.settings[`input_${key}`] = value;
        console.log(`Converting standard parameter: ${key} -> input_${key} = ${value}`);
      }
    });
    
    // Special handling for required parameters
    if (!executeParams.settings.input_prompt && params.prompt) {
      executeParams.settings.input_prompt = params.prompt;
    }
    
    if (!executeParams.settings.input_negative && params.negative_prompt) {
      executeParams.settings.input_negative = params.negative_prompt;
    }
    
    // Log what we're sending in great detail
    console.log('DETAILED WORKFLOW EXECUTION PARAMETERS:', { 
      system: 'internalAPI',
      workflow: workflowName,
      originalParams: params,
      executeParamsFull: executeParams
    });
    
    // AUDIT TRAIL: Log all the decision points that led to these params
    console.log('WORKFLOW EXECUTION AUDIT TRAIL:', {
      workflow_type: workflowName,
      input_sources: {
        direct_params: Object.keys(params),
        numeric_inputs: Object.keys(params).filter(k => !isNaN(parseInt(k))),
        non_numeric_inputs: Object.keys(params).filter(k => isNaN(parseInt(k))),
        has_prompt: !!params.prompt || !!params.positive_prompt,
        has_negative: !!params.negative_prompt,
        input_prefixed_keys: Object.keys(params).filter(k => k.startsWith('input_')),
      },
      transformation_decisions: {
        numeric_keys_mapped: Object.entries(params)
          .filter(([k]) => !isNaN(parseInt(k)))
          .map(([k, v]) => ({ index: k, input_name: v, value_found: params[v] !== undefined || params[v.replace('input_', '')] !== undefined })),
        negative_prompt_handling: {
          provided_directly: !!params.negative_prompt,
          found_in_processed: !!executeParams.settings.input_negative,
          using_default: !params.negative_prompt && !executeParams.settings.input_negative
        }
      }
    });
    
    // Use the service registry to execute the service
    // Create a sessionContext object that matches what executeService expects
    const serviceContext = {
      ...sessionContext, // Keep original properties
      user: context.user, // Include the user object
      userId: sessionContext.userId, // Ensure userId is at top level
      platform: context.platform
    };
    
    // Use the service registry to execute the service
    const result = await executeService('comfydeploy', executeParams, serviceContext);
    
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

/**
 * Create a guest session
 * @returns {Promise<Object>} - Result object with status and session data
 */
async function createGuestSession() {
  if (!sessionManager) {
    logger.error('Session manager not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Internal API not properly initialized'
    };
  }
  
  if (!guestAccessService) {
    logger.error('Guest access service not initialized', { system: 'internalAPI' });
    return {
      status: 'error',
      error: 'Guest access service not available'
    };
  }
  
  try {
    // Create guest session using the guest access service
    const guestSession = await guestAccessService.createGuestSession();
    
    logger.info('Guest session created', { 
      system: 'internalAPI',
      guestId: guestSession.userId
    });
    
    return {
      status: 'ok',
      session: {
        apiKey: guestSession.apiKey,
        userId: guestSession.userId,
        isGuest: true,
        requestsRemaining: guestSession.session.requestsRemaining,
        requestsLimit: guestSession.session.requestsLimit || 3,
        expiresAt: guestSession.session.expiresAt
      }
    };
  } catch (error) {
    logger.error('Failed to create guest session', { 
      system: 'internalAPI',
      error
    });
    
    return {
      status: 'error',
      error: error.message || 'Failed to create guest session',
      code: error.code || 'GUEST_SESSION_CREATION_FAILED'
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
  executeWorkflow,
  createGuestSession
}; 