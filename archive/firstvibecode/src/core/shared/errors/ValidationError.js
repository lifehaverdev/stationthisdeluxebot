const { AppError, ERROR_CATEGORY, ERROR_SEVERITY } = require('./AppError');

/**
 * Validation Error class for handling data validation failures
 * @extends AppError
 */
class ValidationError extends AppError {
  /**
   * Create a new ValidationError
   * @param {string} message - Error message
   * @param {Object} [options] - Additional error options
   * @param {Object} [options.validationErrors] - Detailed validation errors by field
   */
  constructor(message, options = {}) {
    super(message, {
      code: 'ERR_VALIDATION',
      category: ERROR_CATEGORY.VALIDATION,
      severity: ERROR_SEVERITY.WARNING,
      ...options
    });
    
    this.name = 'ValidationError';
    this.validationErrors = options.validationErrors || {};
  }

  /**
   * Get a user-friendly message for this validation error
   * @returns {string} User-friendly error message
   * @override
   */
  getUserFriendlyMessage() {
    if (this.userMessage) {
      return this.userMessage;
    }
    
    return 'The provided data is invalid. Please check your input and try again.';
  }

  /**
   * Add a field-specific validation error
   * @param {string} field - The field with the error
   * @param {string} message - Error message for this field
   */
  addFieldError(field, message) {
    this.validationErrors[field] = message;
    return this;
  }
}

module.exports = ValidationError; 