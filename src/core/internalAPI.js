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

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'internalAPI'
});

// Get registry instance
const commandRegistry = CommandRegistry.getInstance();

// Module-level sessionManager instance (will be initialized in setup)
let sessionManager = null;

/**
 * Setup the internal API with the required dependencies
 * @param {Object} options - Setup options
 * @param {SessionManager} options.sessionManager - Session manager instance
 */
function setup(options = {}) {
  if (!options.sessionManager) {
    throw new Error('SessionManager is required for internalAPI setup');
  }
  
  sessionManager = options.sessionManager;
  logger.info('Internal API initialized', { system: 'internalAPI' });
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
      message: `Task '${taskName}' started successfully`,
      // Include additional task details as needed
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

module.exports = {
  setup,
  runCommand,
  getSession,
  startTask
}; 