/**
 * Status command implementation
 * 
 * Platform-agnostic implementation of the /status command
 * that uses SessionManager instead of direct lobby access
 */

const { AppError, ERROR_SEVERITY } = require('../core/shared/errors');
const { convertTime } = require('../utils/helpers');

/**
 * Get system status information
 * 
 * @param {Object} context - Command execution context
 * @param {Object} context.sessionManager - SessionManager instance
 * @param {number} context.startupTime - Timestamp when the system started
 * @param {Object} context.taskService - Service for retrieving task information
 * @param {string} context.userId - User ID for session lookup
 * @returns {Object} Status information object
 */
async function getStatusInfo(context) {
  const { 
    sessionManager, 
    startupTime, 
    taskService, 
    userId 
  } = context;

  if (!sessionManager) {
    throw new AppError('SessionManager is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_MANAGER_REQUIRED'
    });
  }

  // Calculate runtime
  const runtime = (Date.now() - startupTime) / 1000;
  const runtimeFormatted = convertTime(runtime);

  // Get user session data
  let session;
  try {
    session = await sessionManager.getSession(userId);
    
    // If session doesn't exist, create it
    if (!session) {
      session = await sessionManager.createSession(userId, {
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      console.log(`Created new session for userId ${userId}`);
    } else {
      // Update last activity
      await sessionManager.updateSession(userId, {
        lastActivity: Date.now(),
        lastCommand: '/status'
      });
      console.log(`Updated session for userId ${userId}`);
    }
  } catch (error) {
    console.error('Error accessing session:', error);
    throw new AppError('Failed to access session data', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'SESSION_ACCESS_FAILED',
      cause: error
    });
  }

  // Get task information
  let tasks = { active: [], waiting: [], completed: [] };
  if (taskService) {
    try {
      tasks = await taskService.getTasksForUser(userId);
    } catch (error) {
      console.warn('Failed to get task information:', error);
      // Non-fatal error, continue with empty tasks
    }
  }

  // Build status information object
  return {
    runtime: {
      seconds: runtime,
      formatted: runtimeFormatted
    },
    session: {
      id: session.id,
      createdAt: session.get('createdAt'),
      lastActivity: session.get('lastActivity'),
      version: session.version
    },
    tasks,
    // System information
    system: {
      useNewSessionManager: true,
      timestamp: Date.now()
    }
  };
}

/**
 * Format status information for display
 * 
 * @param {Object} statusInfo - Status information from getStatusInfo
 * @param {Object} options - Formatting options
 * @param {boolean} options.isAdmin - Whether the user is an admin
 * @param {string} options.format - Output format (text, json, markdown)
 * @returns {Object} Formatted status message and metadata
 */
function formatStatusResponse(statusInfo, options = {}) {
  const { isAdmin = false, format = 'markdown' } = options;
  
  // Convert to user-friendly format
  let formattedMessage = '';
  
  // Basic runtime info
  formattedMessage += `📊 *Bot Status*\n\n`;
  formattedMessage += `⏱ Uptime: ${statusInfo.runtime.formatted}\n`;
  
  // Session info
  formattedMessage += `\n*Session Information*\n`;
  formattedMessage += `🔄 Last activity: ${new Date(statusInfo.session.lastActivity).toLocaleString()}\n`;
  formattedMessage += `📝 Session version: ${statusInfo.session.version}\n`;
  
  // Task info if available
  if (statusInfo.tasks) {
    if (statusInfo.tasks.active.length > 0) {
      formattedMessage += `\n*Active Tasks*\n`;
      statusInfo.tasks.active.forEach(task => {
        formattedMessage += `▶️ ${task.type || 'Task'}\n`;
      });
    }
    
    if (statusInfo.tasks.waiting.length > 0) {
      formattedMessage += `\n*Waiting Tasks*\n`;
      statusInfo.tasks.waiting.forEach(task => {
        formattedMessage += `⏳ ${task.type || 'Task'}: ${task.status}\n`;
      });
    }
  }
  
  // Add system information for admins or when explicitly requested
  if (isAdmin) {
    formattedMessage += `\n*System Information*\n`;
    formattedMessage += `📋 Using new SessionManager: ${statusInfo.system.useNewSessionManager ? 'Yes' : 'No'}\n`;
    formattedMessage += `🕒 Timestamp: ${new Date(statusInfo.system.timestamp).toLocaleString()}\n`;
  }
  
  return {
    text: formattedMessage,
    format: format,
    // Include data for additional UI elements like buttons
    refreshable: true
  };
}

module.exports = {
  getStatusInfo,
  formatStatusResponse
}; 