/**
 * AppError
 * 
 * Base error class for application-specific errors.
 * Provides standardized error handling with support for error codes, 
 * categorization, logging, and contextual information.
 * 
 * @module core/shared/errors/AppError
 */

/**
 * Error severity levels
 */
const ERROR_SEVERITY = {
  INFO: 'info',      // Informational messages - typically not shown to users
  WARNING: 'warning', // Warning messages - may be shown to users
  ERROR: 'error',    // Standard errors - shown to users
  CRITICAL: 'critical' // Critical errors - require immediate attention
};

/**
 * Error categories
 */
const ERROR_CATEGORY = {
  VALIDATION: 'validation', // Input validation errors
  AUTHENTICATION: 'authentication', // Auth-related errors
  AUTHORIZATION: 'authorization', // Permission-related errors
  DATABASE: 'database', // Database operation errors
  EXTERNAL: 'external', // External service errors
  NETWORK: 'network', // Network-related errors
  INTERNAL: 'internal', // Internal application errors
  RESOURCE: 'resource', // Resource not found or unavailable
  CONFIG: 'config', // Configuration errors
  UNKNOWN: 'unknown' // Uncategorized errors
};

/**
 * Base application error class
 * @extends Error
 */
class AppError extends Error {
  /**
   * Create a new AppError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.code] - Error code (e.g. 'ERR_INVALID_INPUT')
   * @param {string} [options.category=ERROR_CATEGORY.UNKNOWN] - Error category
   * @param {string} [options.severity=ERROR_SEVERITY.ERROR] - Error severity
   * @param {Object} [options.context={}] - Additional context data
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.userMessage] - User-friendly error message
   * @param {string} [options.helpLink] - Link to documentation or help page
   */
  constructor(message, options = {}) {
    super(message);
    
    // Standard error properties
    this.name = this.constructor.name;
    
    // Ensure stack trace points to the actual error location
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    
    // Set Error-specific properties
    this.code = options.code || 'APP_ERROR';
    this.category = options.category || ERROR_CATEGORY.UNKNOWN;
    this.severity = options.severity || ERROR_SEVERITY.ERROR;
    this.context = options.context || {};
    this.cause = options.cause;
    this.userMessage = options.userMessage || this.getUserFriendlyMessage();
    this.helpLink = options.helpLink;
    this.timestamp = new Date();
    
    // Add the original error's info if present
    if (this.cause) {
      this.context.cause = {
        message: this.cause.message,
        name: this.cause.name,
        stack: this.cause.stack,
        ...(this.cause.context || {})
      };
    }
  }
  
  /**
   * Get a user-friendly error message
   * @returns {string} User-friendly message
   */
  getUserFriendlyMessage() {
    // Default implementation returns a generic message based on category
    switch(this.category) {
      case ERROR_CATEGORY.VALIDATION:
        return 'The provided input is invalid.';
      case ERROR_CATEGORY.AUTHENTICATION:
        return 'Authentication failed. Please sign in again.';
      case ERROR_CATEGORY.AUTHORIZATION:
        return 'You do not have permission to perform this action.';
      case ERROR_CATEGORY.DATABASE:
        return 'A database error occurred. Please try again later.';
      case ERROR_CATEGORY.EXTERNAL:
        return 'An external service error occurred. Please try again later.';
      case ERROR_CATEGORY.NETWORK:
        return 'A network error occurred. Please check your connection and try again.';
      case ERROR_CATEGORY.RESOURCE:
        return 'The requested resource was not found.';
      default:
        return 'An error occurred. Please try again later.';
    }
  }
  
  /**
   * Add additional context to the error
   * @param {Object} contextData - Additional context data
   * @returns {AppError} this instance for chaining
   */
  withContext(contextData) {
    this.context = {
      ...this.context,
      ...contextData
    };
    return this;
  }
  
  /**
   * Convert error to a plain object for logging/serialization
   * @param {boolean} [includeStack=true] - Whether to include stack trace
   * @returns {Object} Plain object representation
   */
  toJSON(includeStack = true) {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      timestamp: this.timestamp,
      context: this.context,
      userMessage: this.userMessage,
      helpLink: this.helpLink,
      ...(includeStack && { stack: this.stack })
    };
  }
  
  /**
   * Create a new AppError from an existing Error
   * @param {Error} error - Original error
   * @param {Object} [options={}] - Additional options
   * @returns {AppError} New AppError instance
   * @static
   */
  static from(error, options = {}) {
    if (error instanceof AppError) {
      // Already an AppError, add any new context and return
      return error.withContext(options.context || {});
    }
    
    return new AppError(
      options.message || error.message, 
      {
        cause: error,
        ...options
      }
    );
  }
}

/**
 * Validation error class
 */
class ValidationError extends AppError {
  /**
   * Create a new ValidationError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Object|Array} [options.validationErrors=[]] - Validation error details
   */
  constructor(message, options = {}) {
    // First create the base error without userMessage
    super(message, {
      code: options.code || 'ERR_VALIDATION',
      category: ERROR_CATEGORY.VALIDATION,
      severity: ERROR_SEVERITY.WARNING,
      ...options,
      userMessage: undefined // Prevent base class from setting userMessage
    });
    
    // Initialize validationErrors as an empty array by default
    this.validationErrors = [];
    
    // Handle both array and object formats
    if (options.validationErrors) {
      if (Array.isArray(options.validationErrors)) {
        this.validationErrors = options.validationErrors;
        this._validationErrorsFormat = 'array';
      } else if (typeof options.validationErrors === 'object') {
        this.validationErrors = options.validationErrors;
        this._validationErrorsFormat = 'object';
      }
    } else {
      this._validationErrorsFormat = 'array';
    }

    // Now set the userMessage based on validation errors
    this.userMessage = options.userMessage || this.getUserFriendlyMessage();
  }
  
  /**
   * Get a user-friendly error message
   * @returns {string} User-friendly message
   */
  getUserFriendlyMessage() {
    if (this._validationErrorsFormat === 'array') {
      if (!this.validationErrors || this.validationErrors.length === 0) {
        return 'The provided input is invalid.';
      }
      
      if (this.validationErrors.length === 1) {
        const error = this.validationErrors[0];
        return `Invalid value for ${error.field}: ${error.message}`;
      }
      
      return 'Multiple validation errors occurred. Please check your input.';
    } else {
      // Object format
      if (!this.validationErrors || Object.keys(this.validationErrors).length === 0) {
        return 'The provided input is invalid.';
      }
      
      const fields = Object.keys(this.validationErrors);
      if (fields.length === 1) {
        const field = fields[0];
        return `Invalid value for ${field}: ${this.validationErrors[field]}`;
      }
      
      return 'Multiple validation errors occurred. Please check your input.';
    }
  }
  
  /**
   * Convert error to a plain object for logging/serialization
   * @param {boolean} [includeStack=true] - Whether to include stack trace
   * @returns {Object} Plain object representation
   */
  toJSON(includeStack = true) {
    return {
      ...super.toJSON(includeStack),
      validationErrors: this.validationErrors || {}
    };
  }
}

/**
 * Authentication error class
 */
class AuthenticationError extends AppError {
  /**
   * Create a new AuthenticationError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ERR_AUTHENTICATION',
      category: ERROR_CATEGORY.AUTHENTICATION,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Authorization error class
 */
class AuthorizationError extends AppError {
  /**
   * Create a new AuthorizationError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ERR_AUTHORIZATION',
      category: ERROR_CATEGORY.AUTHORIZATION,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Database error class
 */
class DatabaseError extends AppError {
  /**
   * Create a new DatabaseError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ERR_DATABASE',
      category: ERROR_CATEGORY.DATABASE,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Network error class
 */
class NetworkError extends AppError {
  /**
   * Create a new NetworkError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ERR_NETWORK',
      category: ERROR_CATEGORY.NETWORK,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Resource not found error class
 */
class NotFoundError extends AppError {
  /**
   * Create a new NotFoundError
   * @param {string} resourceType - Type of resource not found
   * @param {string|number} resourceId - ID of resource not found
   * @param {Object} [options={}] - Error options
   */
  constructor(resourceType, resourceId, options = {}) {
    const message = `${resourceType} with ID '${resourceId}' not found`;
    
    super(message, {
      code: options.code || 'ERR_NOT_FOUND',
      category: ERROR_CATEGORY.RESOURCE,
      severity: ERROR_SEVERITY.WARNING,
      context: {
        resourceType,
        resourceId,
        ...(options.context || {})
      },
      ...options
    });
  }
  
  /**
   * Get a user-friendly error message
   * @returns {string} User-friendly message
   */
  getUserFriendlyMessage() {
    return `The requested ${this.context.resourceType} could not be found.`;
  }
}

/**
 * Configuration error class
 */
class ConfigurationError extends AppError {
  /**
   * Create a new ConfigurationError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ERR_CONFIG',
      category: ERROR_CATEGORY.CONFIG,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

// Export error classes and constants
module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  DatabaseError,
  NetworkError,
  NotFoundError,
  ConfigurationError,
  ERROR_SEVERITY,
  ERROR_CATEGORY
}; 