/**
 * Custom Error Classes
 */

class APIError extends Error {
  /**
   * Creates an instance of APIError.
   * @param {string} message - The error message.
   * @param {number} statusCode - The HTTP status code associated with the error.
   * @param {any} [errorBody=null] - Optional raw error body from the API response.
   */
  constructor(message, statusCode, errorBody = null) {
    super(message); // Call the parent constructor (Error)
    this.name = 'APIError'; // Set the error name
    this.statusCode = statusCode; // Add statusCode property
    this.errorBody = errorBody; // Add optional errorBody property

    // Maintain proper stack trace in V8 environments (Node.js)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, APIError);
    }
  }
}

module.exports = {
  APIError,
}; 