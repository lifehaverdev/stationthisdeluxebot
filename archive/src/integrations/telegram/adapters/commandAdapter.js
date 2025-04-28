/**
 * Telegram Command Adapter
 * 
 * Adapts platform-agnostic commands to work with the Telegram Bot API
 */

const { SessionManager } = require('../../../services/sessionManager');
const { AppError, ErrorHandler } = require('../../../core/shared/errors');
const statusCommand = require('../../../commands/statusCommand');

// Initialize dependencies
const sessionManager = global.sessionManager || new SessionManager();
const errorHandler = new ErrorHandler();

// Helper to check if we're in a test environment
const isTestEnvironment = () => process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/**
 * Adapts a Telegram message to work with our core commands
 * @param {string} commandName - Name of the command to execute
 * @param {Object} message - Telegram message object
 * @returns {Promise<Object>} Response object for Telegram
 */
async function executeCommand(commandName, message) {
  try {
    // Extract user ID from Telegram message
    const userId = message.from.id.toString();
    
    // Execute the appropriate command
    switch (commandName.toLowerCase()) {
      case 'status':
        return await executeStatusCommand(message, userId);
      default:
        throw new AppError(`Unknown command: ${commandName}`, {
          code: 'UNKNOWN_COMMAND'
        });
    }
  } catch (error) {
    // Only log errors when not in test environment to keep test output clean
    if (!isTestEnvironment()) {
      console.error(`Error executing command ${commandName}:`, error);
    }
    
    // Use ErrorHandler to create a user-friendly error response
    const appError = errorHandler.handleError(error);
    return createTelegramErrorResponse(message, appError);
  }
}

/**
 * Executes the status command with Telegram-specific handling
 * @param {Object} message - Telegram message object
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Response for Telegram
 */
async function executeStatusCommand(message, userId) {
  // Get startup time from global or use current time as fallback
  const startupTime = global.startup || (Date.now() - 60000); // Fallback to 1 minute ago
  
  // Check if user is admin
  const isAdmin = message.from.id.toString() === process.env.DEV_DMS;
  
  // Get task service if available (or use mock for now)
  const taskService = global.taskService || createMockTaskService();
  
  // Prepare context for status command
  const context = {
    sessionManager,
    startupTime,
    taskService,
    userId
  };
  
  // Get status information
  const statusInfo = await statusCommand.getStatusInfo(context);
  
  // Format the response
  const formattedResponse = statusCommand.formatStatusResponse(statusInfo, { 
    isAdmin,
    format: 'markdown'
  });
  
  // Prepare Telegram-specific response
  let reply_markup;
  if (formattedResponse.refreshable) {
    reply_markup = { 
      inline_keyboard: [[{ text: '🔄', callback_data: 'refresh' }]]
    };
  }
  
  // Return Telegram-compatible response object
  return {
    chatId: message.chat.id,
    text: formattedResponse.text,
    options: {
      parse_mode: 'Markdown',
      reply_markup
    }
  };
}

/**
 * Creates a Telegram-compatible error response
 * @param {Object} message - Telegram message
 * @param {AppError} error - Error to format
 * @returns {Object} Formatted error response
 */
function createTelegramErrorResponse(message, error) {
  return {
    chatId: message.chat.id,
    text: `⚠️ Error: ${error.userMessage || error.message}`,
    options: { parse_mode: 'Markdown' }
  };
}

/**
 * Creates a mock task service for testing
 * @returns {Object} Mock task service
 */
function createMockTaskService() {
  return {
    getTasksForUser: async (userId) => {
      console.log(`Mock task service called for user ${userId}`);
      return {
        active: [],
        waiting: [],
        completed: []
      };
    }
  };
}

module.exports = {
  executeCommand
}; 