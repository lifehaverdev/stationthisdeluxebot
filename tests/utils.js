/**
 * Test utilities for error handling
 */

const { ERROR_SEVERITY } = require('../src/core/shared/errors');

/**
 * Creates a mock error object with customizable properties
 * @param {Object} options
 * @param {string} [options.message] - Error message
 * @param {string} [options.name] - Error name
 * @param {Object} [options.details] - Additional error details
 * @param {ERROR_SEVERITY} [options.severity] - Error severity level
 * @returns {Error} Mock error object
 */
function createMockError(options = {}) {
  const error = new Error(options.message || 'Mock error');
  error.name = options.name || 'MockError';
  error.details = options.details || {};
  error.severity = options.severity || ERROR_SEVERITY.ERROR;
  return error;
}

/**
 * Creates a mock error reporter with Jest spy functions
 * @returns {Object} Mock reporter object with spy functions
 */
function createMockErrorReporter() {
  return {
    reportError: jest.fn(),
    reportCriticalError: jest.fn(),
    toJSON: jest.fn()
  };
}

/**
 * Helper for verifying error handling behavior
 * @param {Object} handler - Error handler instance
 * @param {Error} error - Error to handle
 * @param {Object} expected - Expected behavior
 * @param {string} [expected.message] - Expected error message
 * @param {ERROR_SEVERITY} [expected.severity] - Expected error severity
 * @param {boolean} [expected.isCritical] - Whether error should be treated as critical
 */
function expectErrorHandling(handler, error, expected) {
  const result = handler.handleError(error);
  
  if (expected.message) {
    expect(result.message).toBe(expected.message);
  }
  
  if (expected.severity) {
    expect(result.severity).toBe(expected.severity);
  }
  
  if (expected.isCritical) {
    expect(handler.reporter.reportCriticalError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: result.message,
        severity: result.severity
      })
    );
  } else {
    expect(handler.reporter.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: result.message,
        severity: result.severity
      })
    );
  }
}

module.exports = {
  createMockError,
  createMockErrorReporter,
  expectErrorHandling
}; 