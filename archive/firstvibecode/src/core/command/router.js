/**
 * Command Router
 * 
 * Routes command requests to appropriate handlers and applies middleware.
 * Manages the command execution lifecycle.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const { CommandRegistry } = require('./registry');
const { MiddlewarePipeline } = require('./middleware');
const { EventEmitter } = require('events');

/**
 * Command execution events
 * @enum {string}
 */
const COMMAND_EVENTS = {
  BEFORE_EXECUTE: 'before-execute',
  AFTER_EXECUTE: 'after-execute',
  ERROR: 'error',
  NOT_FOUND: 'not-found'
};

/**
 * Command Router for routing and executing commands
 * @extends EventEmitter
 */
class CommandRouter extends EventEmitter {
  /**
   * Create a new command router
   * @param {Object} [options] - Router options
   * @param {CommandRegistry} [options.registry] - Command registry to use
   * @param {MiddlewarePipeline} [options.pipeline] - Middleware pipeline to use
   */
  constructor(options = {}) {
    super();
    
    /**
     * Command registry
     * @type {CommandRegistry}
     */
    this.registry = options.registry || CommandRegistry.getInstance();
    
    /**
     * Middleware pipeline
     * @type {MiddlewarePipeline}
     */
    this.pipeline = options.pipeline || new MiddlewarePipeline();
    
    /**
     * Command execution metrics
     * @type {Map<string, Object>}
     */
    this.metrics = new Map();
  }

  /**
   * Add middleware to the pipeline
   * @param {Function} middleware - Middleware function
   * @returns {CommandRouter} This router for chaining
   */
  use(middleware) {
    this.pipeline.use(middleware);
    return this;
  }

  /**
   * Execute a command
   * @param {string} commandName - Name of the command to execute
   * @param {Object} context - Command execution context
   * @returns {Promise<Object>} Result of command execution
   */
  async execute(commandName, context = {}) {
    // Find command in registry
    const command = this.registry.get(commandName);
    
    if (!command) {
      this.emit(COMMAND_EVENTS.NOT_FOUND, { commandName, context });
      throw new AppError(`Command '${commandName}' not found`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMMAND_NOT_FOUND'
      });
    }
    
    // Prepare execution context
    const executionContext = {
      ...context,
      command: {
        name: command.name,
        description: command.description,
        metadata: command.metadata || {}
      },
      startTime: Date.now()
    };
    
    // Start metrics tracking
    this._startMetrics(command.name, executionContext);
    
    // Emit before execute event
    this.emit(COMMAND_EVENTS.BEFORE_EXECUTE, {
      commandName: command.name,
      context: executionContext
    });
    
    try {
      // Execute command through middleware pipeline
      const result = await this.pipeline.execute(
        executionContext,
        async (ctx) => command.execute(ctx)
      );
      
      // Finalize metrics
      this._finishMetrics(command.name, executionContext, null);
      
      // Emit after execute event
      this.emit(COMMAND_EVENTS.AFTER_EXECUTE, {
        commandName: command.name,
        context: executionContext,
        result
      });
      
      return result;
    } catch (error) {
      // Update metrics with error
      this._finishMetrics(command.name, executionContext, error);
      
      // Emit error event
      this.emit(COMMAND_EVENTS.ERROR, {
        commandName: command.name,
        context: executionContext,
        error
      });
      
      throw error;
    }
  }

  /**
   * Start metrics tracking for a command
   * @param {string} commandName - Name of the command
   * @param {Object} context - Execution context
   * @private
   */
  _startMetrics(commandName, context) {
    if (!this.metrics.has(commandName)) {
      this.metrics.set(commandName, {
        totalExecutions: 0,
        totalErrors: 0,
        totalExecutionTime: 0,
        lastExecutionTime: 0,
        lastExecutionDate: null,
        lastError: null
      });
    }
    
    const metrics = this.metrics.get(commandName);
    metrics.totalExecutions++;
    metrics.lastExecutionDate = new Date();
  }

  /**
   * Finish metrics tracking for a command
   * @param {string} commandName - Name of the command
   * @param {Object} context - Execution context
   * @param {Error|null} error - Error if any
   * @private
   */
  _finishMetrics(commandName, context, error) {
    const metrics = this.metrics.get(commandName);
    const endTime = Date.now();
    const executionTime = endTime - context.startTime;
    
    metrics.lastExecutionTime = executionTime;
    metrics.totalExecutionTime += executionTime;
    
    if (error) {
      metrics.totalErrors++;
      metrics.lastError = {
        message: error.message,
        code: error.code,
        date: new Date()
      };
    }
  }

  /**
   * Get metrics for all commands
   * @returns {Object} Command metrics
   */
  getMetrics() {
    const result = {};
    
    for (const [commandName, metrics] of this.metrics.entries()) {
      result[commandName] = { ...metrics };
    }
    
    return result;
  }

  /**
   * Get metrics for a specific command
   * @param {string} commandName - Name of the command
   * @returns {Object|null} Command metrics or null if not found
   */
  getCommandMetrics(commandName) {
    if (!this.metrics.has(commandName)) {
      return null;
    }
    
    return { ...this.metrics.get(commandName) };
  }

  /**
   * Reset metrics for all commands
   */
  resetMetrics() {
    this.metrics.clear();
  }

  /**
   * Register a command with the registry
   * @param {Object} command - Command definition
   * @returns {CommandRouter} This router for chaining
   */
  register(command) {
    this.registry.register(command);
    return this;
  }

  /**
   * Unregister a command from the registry
   * @param {string} commandName - Name of the command to unregister
   * @returns {CommandRouter} This router for chaining
   */
  unregister(commandName) {
    this.registry.unregister(commandName);
    return this;
  }
}

module.exports = {
  CommandRouter,
  COMMAND_EVENTS
}; 