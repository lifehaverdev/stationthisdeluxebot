/**
 * Abstract Command Adapter
 * 
 * Base class for platform-specific command adapters.
 * Defines the interface that all adapters must implement.
 */

const { AppError, ERROR_SEVERITY } = require('../../shared/errors');

/**
 * Abstract Command Adapter
 * All platform-specific adapters should extend this class
 */
class AbstractCommandAdapter {
  /**
   * Create a new command adapter
   * @param {Object} options - Adapter options
   * @param {CommandRouter} options.router - Command router instance
   */
  constructor(options = {}) {
    if (!options.router) {
      throw new AppError('Command router is required', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'MISSING_COMMAND_ROUTER'
      });
    }
    
    /**
     * Command router
     * @type {CommandRouter}
     */
    this.router = options.router;
  }

  /**
   * Convert platform-specific request to command format
   * @param {*} request - Platform-specific request
   * @returns {Object} Command execution request
   * @throws {Error} If not implemented by subclass
   */
  convertRequest(request) {
    throw new AppError('convertRequest method must be implemented by subclass', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Convert command response to platform-specific format
   * @param {Object} response - Command execution response
   * @param {*} originalRequest - Original platform-specific request
   * @returns {*} Platform-specific response
   * @throws {Error} If not implemented by subclass
   */
  convertResponse(response, originalRequest) {
    throw new AppError('convertResponse method must be implemented by subclass', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Convert error to platform-specific format
   * @param {Error} error - Error object
   * @param {*} originalRequest - Original platform-specific request
   * @returns {*} Platform-specific error response
   * @throws {Error} If not implemented by subclass
   */
  convertError(error, originalRequest) {
    throw new AppError('convertError method must be implemented by subclass', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'METHOD_NOT_IMPLEMENTED'
    });
  }

  /**
   * Handle a platform-specific request
   * @param {*} request - Platform-specific request
   * @returns {Promise<*>} Platform-specific response
   */
  async handleRequest(request) {
    try {
      // Convert request to command format
      const { command, context } = this.convertRequest(request);
      
      // Execute command
      const response = await this.router.execute(command, context);
      
      // Convert response to platform format
      return this.convertResponse(response, request);
    } catch (error) {
      // Handle error
      return this.convertError(error, request);
    }
  }
}

module.exports = {
  AbstractCommandAdapter
}; 