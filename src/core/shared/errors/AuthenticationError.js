const { AppError, ERROR_CATEGORY, ERROR_SEVERITY } = require('./AppError');

/**
 * Authentication Error class for handling authentication failures
 * @extends AppError
 */
class AuthenticationError extends AppError {
  /**
   * Create a new AuthenticationError
   * @param {string} message - Error message
   * @param {Object} [options] - Additional error options
   */
  constructor(message, options = {}) {
    super(message, {
      code: 'ERR_AUTHENTICATION',
      category: ERROR_CATEGORY.AUTHENTICATION,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
    
    this.name = 'AuthenticationError';
  }

  /**
   * Get a user-friendly message for this authentication error
   * @returns {string} User-friendly error message
   * @override
   */
  getUserFriendlyMessage() {
    if (this.userMessage) {
      return this.userMessage;
    }
    
    return 'Authentication failed. Please check your credentials and try again.';
  }
}

module.exports = AuthenticationError; 