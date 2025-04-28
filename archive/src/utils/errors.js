/**
 * Custom application error class
 */
class AppError extends Error {
  /**
   * Create a new application error
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   */
  constructor(code, message, data = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.data = data;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Convert error to JSON object
   * @returns {Object} JSON representation of the error
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code, 
      message: this.message,
      data: this.data
    };
  }

  /**
   * Create a validation error
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Validation error
   */
  static validation(message, data = {}) {
    return new AppError('VALIDATION_ERROR', message, data);
  }

  /**
   * Create a not found error
   * @param {string} entity - Entity that was not found
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Not found error
   */
  static notFound(entity, data = {}) {
    return new AppError('NOT_FOUND', `${entity} not found`, data);
  }

  /**
   * Create an unauthorized error
   * @param {string} [message='Unauthorized'] - Error message
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Unauthorized error
   */
  static unauthorized(message = 'Unauthorized', data = {}) {
    return new AppError('UNAUTHORIZED', message, data);
  }

  /**
   * Create a forbidden error
   * @param {string} [message='Forbidden'] - Error message
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Forbidden error
   */
  static forbidden(message = 'Forbidden', data = {}) {
    return new AppError('FORBIDDEN', message, data);
  }

  /**
   * Create a conflict error
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Conflict error
   */
  static conflict(message, data = {}) {
    return new AppError('CONFLICT', message, data);
  }

  /**
   * Create a bad request error
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Bad request error
   */
  static badRequest(message, data = {}) {
    return new AppError('BAD_REQUEST', message, data);
  }

  /**
   * Create a internal server error
   * @param {string} [message='Internal server error'] - Error message
   * @param {Object} [data] - Additional error data
   * @returns {AppError} Internal server error
   */
  static internal(message = 'Internal server error', data = {}) {
    return new AppError('INTERNAL_ERROR', message, data);
  }
}

module.exports = { AppError }; 