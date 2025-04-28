const { AppError, ERROR_CATEGORY, ERROR_SEVERITY } = require('./AppError');

/**
 * Authorization Error class for handling permission-related failures
 * @extends AppError
 */
class AuthorizationError extends AppError {
  /**
   * Create a new AuthorizationError
   * @param {string} message - Error message
   * @param {Object} [options] - Additional error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: 'ERR_AUTHORIZATION',
      category: ERROR_CATEGORY.AUTHORIZATION,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
    
    this.name = 'AuthorizationError';
  }

  /**
   * Get a user-friendly message for this authorization error
   * @returns {string} User-friendly error message
   * @override
   */
  getUserFriendlyMessage() {
    if (this.userMessage) {
      return this.userMessage;
    }
    
    return 'You do not have permission to perform this action.';
  }
}

module.exports = AuthorizationError; 