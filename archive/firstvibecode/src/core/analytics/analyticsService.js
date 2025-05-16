/**
 * Analytics Service
 * 
 * High-level service for tracking user activities and application events.
 * Provides a simplified interface over the AnalyticsEventsAdapter.
 */

const { AnalyticsEventsAdapter, createAnalyticsEventsAdapter } = require('./analyticsEventsAdapter');
const { EVENT_TYPES } = require('../../db/models/analyticsEventsRepository');

/**
 * Analytics Service
 * Provides high-level methods for tracking user activities
 */
class AnalyticsService {
  /**
   * Create a new AnalyticsService
   * @param {Object} options - Configuration options
   * @param {AnalyticsEventsAdapter} options.adapter - The analytics adapter to use
   * @param {boolean} [options.enabled=true] - Whether analytics is enabled
   */
  constructor(options) {
    this.adapter = options.adapter;
    this.enabled = options.enabled !== false;
    
    // Bind methods to ensure proper this context
    this.trackCommand = this.trackCommand.bind(this);
    this.trackCompletion = this.trackCompletion.bind(this);
    this.trackError = this.trackError.bind(this);
    this.trackUserAction = this.trackUserAction.bind(this);
    this.trackWorkflow = this.trackWorkflow.bind(this);
  }

  /**
   * Check if analytics is enabled before tracking
   * @private
   * @returns {boolean} - Whether to proceed with tracking
   */
  _checkEnabled() {
    if (!this.enabled) {
      return false;
    }
    
    if (!this.adapter) {
      console.warn('Analytics adapter not available');
      return false;
    }
    
    return true;
  }

  /**
   * Track a user command
   * @param {Object} command - Command object
   * @param {Object} user - User object
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} - Tracking result
   */
  async trackCommand(command, user, context = {}) {
    if (!this._checkEnabled()) return null;
    
    try {
      const event = {
        type: EVENT_TYPES.COMMAND,
        userId: user.id,
        username: user.username || 'unknown',
        timestamp: new Date(),
        data: {
          command: command.name,
          args: command.args,
          source: context.source || 'unknown',
          interface: context.interface || 'unknown',
          success: context.success !== false,
          duration: context.duration || 0,
          ...context.extra
        }
      };
      
      return await this.adapter.updateOne(
        { userId: user.id, type: EVENT_TYPES.COMMAND, timestamp: event.timestamp },
        event,
        { upsert: true }
      );
    } catch (error) {
      console.error('Error tracking command:', error);
      return null;
    }
  }

  /**
   * Track a generation completion
   * @param {Object} task - Task object
   * @param {Object} result - Result object
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} - Tracking result
   */
  async trackCompletion(task, result, context = {}) {
    if (!this._checkEnabled()) return null;
    
    try {
      const event = {
        type: EVENT_TYPES.GENERATION,
        userId: task.userId,
        username: task.username || 'unknown',
        timestamp: new Date(),
        runId: task.id || `task_${Date.now()}`,
        data: {
          taskId: task.id,
          taskType: task.type,
          status: result.status || 'completed',
          duration: context.duration || (Date.now() - (task.timestamp || Date.now())),
          interface: context.interface || 'unknown',
          cost: context.cost || 0,
          ...context.extra
        }
      };
      
      return await this.adapter.updateOne(
        { runId: event.runId, type: EVENT_TYPES.GENERATION },
        event,
        { upsert: true }
      );
    } catch (error) {
      console.error('Error tracking completion:', error);
      return null;
    }
  }

  /**
   * Track an error
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {Promise<Object>} - Tracking result
   */
  async trackError(error, context = {}) {
    if (!this._checkEnabled()) return null;
    
    try {
      const errorId = `error_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      const event = {
        type: EVENT_TYPES.ERROR,
        userId: context.userId || 0,
        username: context.username || 'unknown',
        timestamp: new Date(),
        runId: context.runId || errorId,
        data: {
          message: error.message,
          stack: error.stack,
          code: error.code,
          source: context.source || 'unknown',
          interface: context.interface || 'unknown',
          ...context.extra
        }
      };
      
      return await this.adapter.updateOne(
        { runId: event.runId, type: EVENT_TYPES.ERROR },
        event,
        { upsert: true }
      );
    } catch (error) {
      console.error('Error tracking error:', error);
      return null;
    }
  }

  /**
   * Track a user action
   * @param {string} action - Action name
   * @param {Object} user - User object
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} - Tracking result
   */
  async trackUserAction(action, user, context = {}) {
    if (!this._checkEnabled()) return null;
    
    try {
      const event = {
        type: EVENT_TYPES.ACCOUNT_ACTION,
        userId: user.id,
        username: user.username || 'unknown',
        timestamp: new Date(),
        data: {
          action,
          success: context.success !== false,
          source: context.source || 'unknown',
          interface: context.interface || 'unknown',
          ...context.extra
        }
      };
      
      return await this.adapter.updateOne(
        { userId: user.id, type: EVENT_TYPES.ACCOUNT_ACTION, timestamp: event.timestamp },
        event,
        { upsert: true }
      );
    } catch (error) {
      console.error('Error tracking user action:', error);
      return null;
    }
  }

  /**
   * Track a workflow execution
   * @param {string} workflow - Workflow name
   * @param {Object} data - Workflow data
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} - Tracking result
   */
  async trackWorkflow(workflow, data, context = {}) {
    if (!this._checkEnabled()) return null;
    
    try {
      const event = {
        type: EVENT_TYPES.WORKFLOW,
        userId: data.userId || context.userId || 0,
        username: data.username || context.username || 'unknown',
        timestamp: new Date(),
        runId: data.runId || `workflow_${Date.now()}`,
        data: {
          workflow,
          status: data.status || 'started',
          source: context.source || 'unknown',
          interface: context.interface || 'unknown',
          ...context.extra,
          workflowData: data
        }
      };
      
      return await this.adapter.updateOne(
        { runId: event.runId, type: EVENT_TYPES.WORKFLOW },
        event,
        { upsert: true }
      );
    } catch (error) {
      console.error('Error tracking workflow:', error);
      return null;
    }
  }

  /**
   * Enable analytics tracking
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable analytics tracking
   */
  disable() {
    this.enabled = false;
  }
}

/**
 * Create a new AnalyticsService
 * @param {Object} options - Configuration options
 * @returns {AnalyticsService} - The service instance
 */
function createAnalyticsService(options = {}) {
  // Create an adapter if not provided
  const adapter = options.adapter || createAnalyticsEventsAdapter(options);
  
  return new AnalyticsService({
    adapter,
    ...options
  });
}

module.exports = {
  AnalyticsService,
  createAnalyticsService
}; 