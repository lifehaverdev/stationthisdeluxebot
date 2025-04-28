/**
 * Application Error
 * 
 * Consistent error class for application-level errors.
 */

/**
 * Error severity levels
 * @enum {string}
 */
const ERROR_SEVERITY = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  WARNING: 'warn', // Alias for WARN
  ERROR: 'error',
  FATAL: 'fatal',
  CRITICAL: 'fatal' // Alias for FATAL
};

/**
 * Error categories
 * @enum {string}
 */
const ERROR_CATEGORY = {
  UNKNOWN: 'unknown',
  VALIDATION: 'validation',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  DATABASE: 'database',
  EXTERNAL: 'external',
  NETWORK: 'network',
  RESOURCE: 'resource',
  CONFIG: 'config'
};

/**
 * Application Error class
 * @extends Error
 */
class AppError extends Error {
  /**
   * Create a new AppError
   * @param {string} message - Error message
   * @param {string|Object} [code] - Error code or options object
   * @param {Object} [options] - Additional error options
   * @param {Error} [options.cause] - Underlying error causing this error
   * @param {string} [options.severity] - Error severity level
   * @param {Object} [options.context] - Additional error context
   * @param {string} [options.category] - Error category
   * @param {string} [options.userMessage] - User-friendly error message 
   * @param {string} [options.helpLink] - Link to help documentation
   * @param {string} [options.code] - Error code (alternative to providing directly)
   */
  constructor(message, code, options = {}) {
    // Support both forms: (message, code, options) and (message, options)
    let errorCode = 'APP_ERROR';
    let errorOptions = {};
    
    if (typeof code === 'string') {
      errorCode = code;
      errorOptions = options || {};
    } else if (typeof code === 'object') {
      errorOptions = code || {};
      if (errorOptions.code) {
        errorCode = errorOptions.code;
      }
    }
    
    super(message);
    
    this.name = this.constructor.name;
    this.code = errorCode;
    this.severity = errorOptions.severity || ERROR_SEVERITY.ERROR;
    this.category = errorOptions.category || ERROR_CATEGORY.UNKNOWN;
    this.context = { ...(errorOptions.context || {}) };
    this.cause = errorOptions.cause;
    this.userMessage = errorOptions.userMessage;
    this.helpLink = errorOptions.helpLink;
    this.timestamp = new Date();
    
    // Add cause to context for easy access
    if (this.cause) {
      this.context.cause = {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack
      };
    }
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  /**
   * Create an error from an existing error
   * @param {Error} error - Original error
   * @param {string|Object} [code] - Error code to use or options object
   * @param {Object} [options] - Additional error options
   * @returns {AppError} New AppError instance or updated original if it's an AppError
   * @static
   */
  static from(error, code, options = {}) {
    // If the error is already an AppError, just add the context and return it
    if (error instanceof AppError) {
      const errorOptions = typeof code === 'object' ? code : options;
      if (errorOptions.context) {
        error.withContext(errorOptions.context);
      }
      return error;
    }
    
    // Handle both (error, code, options) and (error, options) forms
    let errorCode = 'CONVERTED';
    let errorOptions = {};
    
    if (typeof code === 'string') {
      errorCode = code;
      errorOptions = options || {};
    } else if (typeof code === 'object') {
      errorOptions = code || {};
    }
    
    return new AppError(
      error.message,
      errorCode,
      {
        cause: error,
        ...errorOptions
      }
    );
  }
  
  /**
   * Create a validation error
   * @param {string} message - Error message
   * @param {Object} [options] - Additional error options
   * @returns {AppError} New validation error
   * @static
   */
  static validation(message, options = {}) {
    return new AppError(
      message,
      'VALIDATION_ERROR',
      {
        severity: ERROR_SEVERITY.WARN,
        category: ERROR_CATEGORY.VALIDATION,
        ...options
      }
    );
  }
  
  /**
   * Create a not found error
   * @param {string} entity - Entity that wasn't found
   * @param {string} [identifier] - Identifier that was used to search
   * @param {Object} [options] - Additional error options
   * @returns {AppError} New not found error
   * @static
   */
  static notFound(entity, identifier, options = {}) {
    const message = identifier 
      ? `${entity} not found with identifier: ${identifier}`
      : `${entity} not found`;
      
    return new AppError(
      message,
      'NOT_FOUND',
      {
        severity: ERROR_SEVERITY.WARN,
        category: ERROR_CATEGORY.RESOURCE,
        context: { entity, identifier },
        ...options
      }
    );
  }
  
  /**
   * Create an unauthorized error
   * @param {string} [message] - Error message
   * @param {Object} [options] - Additional error options
   * @returns {AppError} New unauthorized error
   * @static
   */
  static unauthorized(message = 'Unauthorized access', options = {}) {
    return new AppError(
      message,
      'UNAUTHORIZED',
      {
        severity: ERROR_SEVERITY.WARN,
        category: ERROR_CATEGORY.AUTHORIZATION,
        ...options
      }
    );
  }

  /**
   * Add context information to this error
   * @param {Object} context - Context information to add
   * @returns {AppError} this error instance for chaining
   */
  addContext(context) {
    this.context = { ...this.context, ...context };
    return this;
  }
  
  /**
   * Add context information to this error (alias for addContext)
   * @param {Object} context - Context information to add
   * @returns {AppError} this error instance for chaining
   */
  withContext(context) {
    return this.addContext(context);
  }

  /**
   * Get a user-friendly message for this error
   * @returns {string} User-friendly error message
   */
  getUserFriendlyMessage() {
    // Return explicitly set user message if available
    if (this._userMessage) {
      return this._userMessage;
    }
    
    // Default messages based on error category
    switch (this.category) {
      case ERROR_CATEGORY.VALIDATION:
        return 'The provided input is invalid.';
      case ERROR_CATEGORY.AUTHENTICATION:
        return 'Authentication failed. Please sign in again.';
      case ERROR_CATEGORY.AUTHORIZATION:
        return 'You are not authorized to perform this action.';
      case ERROR_CATEGORY.NETWORK:
        return 'A network error occurred. Please check your connection and try again.';
      case ERROR_CATEGORY.RESOURCE:
        return 'The requested resource could not be found.';
      case ERROR_CATEGORY.DATABASE:
        return 'A database error occurred. Please try again later.';
      case ERROR_CATEGORY.CONFIG:
        return 'A configuration error occurred. Please contact support.';
      default:
        return 'An error occurred. Please try again later.';
    }
  }
  
  /**
   * Get the user-friendly message (property accessor)
   */
  get userMessage() {
    return this._userMessage || this.getUserFriendlyMessage();
  }
  
  /**
   * Set the user-friendly message
   */
  set userMessage(value) {
    this._userMessage = value;
  }
  
  /**
   * Format the error for logging or display
   * @param {boolean} [includeStack=true] - Whether to include stack trace
   * @returns {Object} Formatted error object
   */
  toJSON(includeStack = true) {
    const result = {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      timestamp: this.timestamp
    };
    
    if (this._userMessage) {
      result.userMessage = this._userMessage;
    }
    
    if (Object.keys(this.context).length > 0) {
      result.context = this.context;
    }
    
    if (this.cause) {
      result.cause = this.cause instanceof AppError
        ? this.cause.toJSON(includeStack)
        : {
            name: this.cause.name,
            message: this.cause.message
          };
    }
    
    if (includeStack) {
      result.stack = this.stack;
    }
    
    return result;
  }
}

/**
 * Validation Error class for handling validation-specific errors
 * @extends AppError
 */
class ValidationError extends AppError {
  /**
   * Create a new ValidationError
   * @param {string} message - Error message
   * @param {Object} [options] - Additional error options
   * @param {Object|Array} [options.validationErrors] - Specific validation errors
   */
  constructor(message, options = {}) {
    super(message, 'ERR_VALIDATION', {
      category: ERROR_CATEGORY.VALIDATION,
      severity: ERROR_SEVERITY.WARNING,
      ...options
    });
    
    this.validationErrors = options.validationErrors || [];
  }

  /**
   * Get a user-friendly message for this validation error
   * @returns {string} User-friendly error message
   * @override
   */
  getUserFriendlyMessage() {
    if (this._userMessage) {
      return this._userMessage;
    }

    const validationErrors = this.validationErrors;
    
    if (!validationErrors || 
        (Array.isArray(validationErrors) && validationErrors.length === 0) || 
        (typeof validationErrors === 'object' && Object.keys(validationErrors).length === 0)) {
      return 'Validation failed. Please check your input.';
    }
    
    // If validationErrors is an object with a single property
    if (typeof validationErrors === 'object' && !Array.isArray(validationErrors)) {
      const keys = Object.keys(validationErrors);
      if (keys.length === 1) {
        const field = keys[0];
        return `Invalid value for ${field}: ${validationErrors[field]}`;
      }
      return 'Multiple validation errors occurred. Please check your input.';
    }
    
    // For array format
    if (Array.isArray(validationErrors) && validationErrors.length === 1) {
      const error = validationErrors[0];
      if (error.field) {
        return `Invalid value for ${error.field}: ${error.message}`;
      }
      return error.message || 'Validation failed. Please check your input.';
    }
    
    return 'Multiple validation errors occurred. Please check your input.';
  }
  
  /**
   * Format the error for logging or display
   * @param {boolean} [includeStack=true] - Whether to include stack trace
   * @returns {Object} Formatted error object
   * @override
   */
  toJSON(includeStack = true) {
    const result = super.toJSON(includeStack);
    
    if (this.validationErrors) {
      result.validationErrors = this.validationErrors;
    }
    
    return result;
  }
}

/**
 * Authentication Error class for handling auth-related errors
 * @extends AppError
 */
class AuthenticationError extends AppError {
  constructor(message, options = {}) {
    super(message, 'ERR_AUTHENTICATION', {
      category: ERROR_CATEGORY.AUTHENTICATION,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Authorization Error class for handling permission-related errors
 * @extends AppError
 */
class AuthorizationError extends AppError {
  constructor(message, options = {}) {
    super(message, 'ERR_AUTHORIZATION', {
      category: ERROR_CATEGORY.AUTHORIZATION,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Database Error class for handling DB-related errors
 * @extends AppError
 */
class DatabaseError extends AppError {
  constructor(message, options = {}) {
    super(message, 'ERR_DATABASE', {
      category: ERROR_CATEGORY.DATABASE,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * Network Error class for handling network-related errors
 * @extends AppError
 */
class NetworkError extends AppError {
  constructor(message, options = {}) {
    super(message, 'ERR_NETWORK', {
      category: ERROR_CATEGORY.NETWORK,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

/**
 * NotFound Error class for handling not found resources
 * @extends AppError
 */
class NotFoundError extends AppError {
  constructor(entity, identifier, options = {}) {
    const message = identifier 
      ? `${entity} with ID '${identifier}' not found`
      : `${entity} not found`;
      
    super(message, 'ERR_NOT_FOUND', {
      category: ERROR_CATEGORY.RESOURCE,
      severity: ERROR_SEVERITY.WARNING,
      context: { resourceType: entity, resourceId: identifier },
      userMessage: `The requested ${entity} could not be found.`,
      ...options
    });
    
    this.entity = entity;
    this.identifier = identifier;
  }
}

/**
 * Configuration Error class for handling config-related errors
 * @extends AppError
 */
class ConfigurationError extends AppError {
  constructor(message, options = {}) {
    super(message, 'ERR_CONFIG', {
      category: ERROR_CATEGORY.CONFIG,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
  }
}

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