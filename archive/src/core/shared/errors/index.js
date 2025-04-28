/**
 * Error handling module
 * 
 * This module exports all error classes and constants for use throughout the application.
 * 
 * @module core/shared/errors
 */

const { 
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
} = require('./AppError');

const { ErrorHandler } = require('./ErrorHandler');

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  DatabaseError,
  NetworkError,
  NotFoundError,
  ConfigurationError,
  
  // Constants
  ERROR_SEVERITY,
  ERROR_CATEGORY,
  
  // Utilities
  ErrorHandler
}; 