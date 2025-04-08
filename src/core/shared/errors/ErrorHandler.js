/**
 * Error handling utility
 * 
 * Provides a centralized way to handle errors throughout the application
 * with consistent logging, reporting, and user feedback.
 */

const { AppError, ERROR_SEVERITY } = require('./AppError');

// Helper to check if we're in a test environment
const isTestEnvironment = () => process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

// Environment variable to force logging even in tests
const FORCE_ERROR_LOGGING = process.env.FORCE_ERROR_LOGGING === 'true';

class ErrorHandler {
  /**
   * Create a new ErrorHandler
   * @param {Object} options Handler options
   * @param {Object} options.logger Logger instance
   * @param {Object} options.reportError Error reporting function or object
   * @param {boolean} options.forceLogging Force logging even in test environment
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.reportError = options.reportError || null;
    this.forceLogging = options.forceLogging || FORCE_ERROR_LOGGING;
    
    // For compatibility with tests that expect a reporter property
    this.reporter = this.reportError;
  }

  /**
   * Handle an error with appropriate logging and reporting
   * @param {Error} error The error to handle
   * @param {Object} context Additional context about where the error occurred
   * @returns {AppError} Normalized AppError instance
   */
  handleError(error, context = {}) {
    // Normalize to AppError
    const appError = error instanceof AppError 
      ? error 
      : AppError.from(error);
    
    // Add context if provided
    if (Object.keys(context).length > 0) {
      appError.context = context;
    }

    // Log based on severity
    this._logError(appError);
    
    // Report errors to external service if configured
    if (this.reportError) {
      if (appError.severity === ERROR_SEVERITY.CRITICAL) {
        this._reportCriticalError(appError);
      } else {
        this._reportNormalError(appError);
      }
    }

    return appError;
  }

  /**
   * Create a standardized error response object
   * @param {AppError} error The error to create a response for
   * @param {boolean|Object} options Response options or boolean for includeDetails
   * @returns {Object} Standardized error response
   */
  createErrorResponse(error, options = false) {
    const includeDetails = options === true || (options && options.includeDetails);
    
    const response = {
      success: false,
      error: {
        code: error.code || 'ERROR',
        message: error.userMessage || error.message
      }
    };

    if (includeDetails) {
      response.error.details = {
        id: error.id || 'unknown',
        category: error.category,
        context: error.context || {},
        stack: error.stack
      };
      
      // Include validation errors if present
      if (error.validationErrors) {
        response.error.details.validationErrors = error.validationErrors;
      }
    }

    return response;
  }

  /**
   * Log an error with the appropriate severity level
   * @param {AppError} error The error to log
   * @private
   */
  _logError(error) {
    // Skip detailed logging in test environment to keep test output clean
    // unless explicitly forced (for testing the logging itself)
    if (isTestEnvironment() && !this.forceLogging) {
      return;
    }
    
    const logLevel = this._getLogLevel(error.severity);
    let logMessage = `[${error.code}] ${error.message}`;
    
    // Add severity to critical error messages for easier filtering
    if (error.severity === ERROR_SEVERITY.CRITICAL) {
      logMessage = `[CRITICAL] ${logMessage}`;
    }
    
    const logContext = {
      errorId: error.id,
      category: error.category,
      context: error.context
    };

    this.logger[logLevel](logMessage, logContext);
  }

  /**
   * Report critical error to external service
   * @param {AppError} error The error to report
   * @private
   */
  _reportCriticalError(error) {
    if (!this.reportError) return;
    
    try {
      if (typeof this.reportError.reportCriticalError === 'function') {
        this.reportError.reportCriticalError({
          message: error.message,
          severity: 'CRITICAL'  // Use uppercase for matching test expectations
        });
      } else if (typeof this.reportError === 'function') {
        this.reportError(error.toJSON());
      }
    } catch (reportingError) {
      this.logger.error('Failed to report error', reportingError);
    }
  }

  /**
   * Report normal error to external service
   * @param {AppError} error The error to report
   * @private
   */
  _reportNormalError(error) {
    if (!this.reportError) return;
    
    try {
      if (typeof this.reportError.reportError === 'function') {
        // Use the original severity from the error object
        const severityToReport = typeof error.severity === 'string' 
          ? error.severity.toUpperCase() 
          : 'ERROR';
          
        this.reportError.reportError({
          message: error.message,
          severity: severityToReport
        });
      } else if (typeof this.reportError === 'function') {
        this.reportError(error.toJSON());
      }
    } catch (reportingError) {
      this.logger.error('Failed to report error', reportingError);
    }
  }

  /**
   * Get the appropriate log level based on error severity
   * @param {string} severity Error severity level
   * @returns {string} Log level
   * @private
   */
  _getLogLevel(severity) {
    switch (severity) {
      case ERROR_SEVERITY.CRITICAL:
        return 'error';
      case ERROR_SEVERITY.ERROR:
        return 'error';
      case ERROR_SEVERITY.WARNING:
        return 'warn';
      default:
        return 'info';
    }
  }
}

// Export as named export to match test import
module.exports = { ErrorHandler }; 