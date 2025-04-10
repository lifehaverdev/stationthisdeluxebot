/**
 * Account Commands
 * 
 * Implements account-related commands in a platform-agnostic way
 * for the new command architecture.
 */

const { AppError } = require('../utils/errors');

/**
 * Points command handler
 * Handles displaying and refreshing points
 */
class PointsCommand {
  /**
   * Create a new PointsCommand
   * @param {Object} deps - Dependencies
   * @param {Object} deps.accountPointsService - Account points service
   * @param {Object} deps.workflowManager - Workflow manager for handling workflows
   * @param {Object} deps.sessionManager - Session manager for user data
   * @param {Object} deps.logger - Logger instance
   */
  constructor({ accountPointsService, workflowManager, sessionManager, logger }) {
    this.accountPointsService = accountPointsService;
    this.workflowManager = workflowManager;
    this.sessionManager = sessionManager;
    this.logger = logger;
    
    // Command metadata
    this.name = 'points';
    this.description = 'Check your current point balance';
    this.category = 'account';
    this.aliases = ['balance', 'qoints'];
    this.usage = '/points';
    
    // Parameter definition
    this.params = [];
  }
  
  /**
   * Execute the command
   * @param {Object} context - Command execution context
   * @param {Object} context.user - User information
   * @param {string} context.user.id - User ID
   * @param {Object} context.platform - Platform-specific context
   * @param {Object} context.args - Command arguments
   * @returns {Promise<Object>} Command result
   */
  async execute(context) {
    try {
      const { user, platform } = context;
      
      // Get user data from session
      const userData = await this.sessionManager.getUserData(user.id);
      if (!userData) {
        throw new AppError('User data not found', 'USER_NOT_FOUND');
      }
      
      // Start the account points workflow
      const workflow = await this.workflowManager.startWorkflow(
        user.id,
        'account-points',
        { userId: user.id }
      );
      
      if (!workflow) {
        throw new AppError('Failed to start points workflow', 'WORKFLOW_START_FAILED');
      }
      
      // Return workflow ID for platform adapter to render
      return {
        success: true,
        workflowId: workflow.id,
        type: 'workflow',
        data: {
          workflowName: 'account-points'
        }
      };
    } catch (error) {
      this.logger.error('Error executing points command', { error });
      
      return {
        success: false,
        error: {
          message: 'Unable to load your points. Please try again later.',
          code: error.code || 'UNKNOWN_ERROR'
        }
      };
    }
  }
}

/**
 * Account command handler
 * Handles displaying account menu and managing account settings
 */
class AccountCommand {
  /**
   * Create a new AccountCommand
   * @param {Object} deps - Dependencies
   * @param {Object} deps.userService - User service for account operations
   * @param {Object} deps.sessionManager - Session manager for user data
   * @param {Object} deps.logger - Logger instance
   */
  constructor({ userService, sessionManager, logger }) {
    this.userService = userService;
    this.sessionManager = sessionManager;
    this.logger = logger;
    
    // Command metadata
    this.name = 'account';
    this.description = 'Manage your account settings';
    this.category = 'account';
    this.aliases = ['profile', 'settings'];
    this.usage = '/account';
    
    // Parameter definition
    this.params = [];
  }
  
  /**
   * Execute the command
   * @param {Object} context - Command execution context
   * @param {Object} context.user - User information
   * @param {string} context.user.id - User ID
   * @param {Object} context.platform - Platform-specific context
   * @param {Object} context.args - Command arguments
   * @returns {Promise<Object>} Command result
   */
  async execute(context) {
    try {
      const { user } = context;
      
      // Get user profile data
      const profile = await this.userService.getUserProfile(user.id);
      
      // Return profile data for platform adapter to render
      return {
        success: true,
        type: 'account_menu',
        data: {
          profile
        }
      };
    } catch (error) {
      this.logger.error('Error executing account command', { error });
      
      return {
        success: false,
        error: {
          message: 'Unable to load your account. Please try again later.',
          code: error.code || 'UNKNOWN_ERROR'
        }
      };
    }
  }
}

/**
 * Register account commands with the command registry
 * @param {Object} registry - Command registry
 * @param {Object} deps - Dependencies to inject into commands
 */
function registerAccountCommands(registry, deps) {
  // Register the points command
  registry.register(new PointsCommand(deps));
  
  // Register the account command
  registry.register(new AccountCommand(deps));
  
  // Additional account-related commands can be registered here
}

module.exports = {
  PointsCommand,
  AccountCommand,
  registerAccountCommands
}; 