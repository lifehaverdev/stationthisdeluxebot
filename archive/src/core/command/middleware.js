/**
 * Command Middleware System
 * 
 * Handles the middleware pipeline for command execution.
 * Middleware can run before and after command execution
 * to handle cross-cutting concerns.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');

/**
 * Symbol for the default error handler
 * @type {Symbol}
 */
const DEFAULT_ERROR_HANDLER = Symbol('defaultErrorHandler');

/**
 * Middleware Pipeline for command execution
 */
class MiddlewarePipeline {
  /**
   * Create a new middleware pipeline
   */
  constructor() {
    /**
     * Array of middleware functions
     * @type {Function[]}
     */
    this.middleware = [];
    
    /**
     * Error handlers
     * @type {Map<string|Symbol, Function>}
     */
    this.errorHandlers = new Map();
    
    // Set default error handler
    this.errorHandlers.set(DEFAULT_ERROR_HANDLER, (error, context) => {
      console.error('Unhandled error in command execution:', error);
      throw error;
    });
  }

  /**
   * Add middleware to the pipeline
   * @param {Function} middleware - Middleware function
   * @returns {MiddlewarePipeline} This pipeline for chaining
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new AppError('Middleware must be a function', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_MIDDLEWARE'
      });
    }

    this.middleware.push(middleware);
    return this;
  }

  /**
   * Register an error handler for a specific error code
   * @param {string} errorCode - Error code to handle
   * @param {Function} handler - Error handler function
   * @returns {MiddlewarePipeline} This pipeline for chaining
   */
  handleError(errorCode, handler) {
    if (typeof handler !== 'function') {
      throw new AppError('Error handler must be a function', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_ERROR_HANDLER'
      });
    }

    this.errorHandlers.set(errorCode, handler);
    return this;
  }

  /**
   * Set the default error handler
   * @param {Function} handler - Default error handler function
   * @returns {MiddlewarePipeline} This pipeline for chaining
   */
  setDefaultErrorHandler(handler) {
    if (typeof handler !== 'function') {
      throw new AppError('Error handler must be a function', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'INVALID_ERROR_HANDLER'
      });
    }

    this.errorHandlers.set(DEFAULT_ERROR_HANDLER, handler);
    return this;
  }

  /**
   * Execute the middleware pipeline
   * @param {Object} context - Command execution context
   * @param {Function} finalHandler - Final handler to execute after middleware
   * @returns {Promise<*>} Result of command execution
   */
  async execute(context, finalHandler) {
    let index = 0;

    // Create a composite function by chaining middleware
    const dispatch = async (i, ctx) => {
      if (i >= this.middleware.length) {
        return finalHandler(ctx);
      }

      try {
        const nextMiddleware = this.middleware[i];
        // Call next middleware with next function
        return await nextMiddleware(ctx, () => dispatch(i + 1, ctx));
      } catch (error) {
        return this._handleError(error, ctx);
      }
    };

    try {
      return await dispatch(0, context);
    } catch (error) {
      return this._handleError(error, context);
    }
  }

  /**
   * Handle an error with appropriate handler
   * @param {Error} error - Error to handle
   * @param {Object} context - Command execution context
   * @returns {Promise<*>} Result of error handling
   * @private
   */
  async _handleError(error, context) {
    let handler;

    // Try to find specific handler for AppError
    if (error instanceof AppError && error.code) {
      handler = this.errorHandlers.get(error.code);
    }

    // Fall back to default handler
    if (!handler) {
      handler = this.errorHandlers.get(DEFAULT_ERROR_HANDLER);
    }

    return handler(error, context);
  }

  /**
   * Get the number of middleware functions in the pipeline
   * @returns {number} Count of middleware functions
   */
  get size() {
    return this.middleware.length;
  }

  /**
   * Clear all middleware from the pipeline
   * @returns {MiddlewarePipeline} This pipeline for chaining
   */
  clear() {
    this.middleware = [];
    // Keep error handlers
    return this;
  }

  /**
   * Clear all error handlers except the default
   * @returns {MiddlewarePipeline} This pipeline for chaining
   */
  clearErrorHandlers() {
    const defaultHandler = this.errorHandlers.get(DEFAULT_ERROR_HANDLER);
    this.errorHandlers.clear();
    this.errorHandlers.set(DEFAULT_ERROR_HANDLER, defaultHandler);
    return this;
  }
}

module.exports = {
  MiddlewarePipeline,
  DEFAULT_ERROR_HANDLER
}; 