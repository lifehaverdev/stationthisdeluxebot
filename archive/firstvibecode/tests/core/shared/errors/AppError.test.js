/**
 * AppError Tests
 * 
 * Test suite for the AppError class hierarchy that validates error creation,
 * inheritance, message handling, and serialization capabilities.
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
} = require('../../../../src/core/shared/errors');

describe('AppError', () => {
  describe('Base AppError class', () => {
    it('should create an error with default properties', () => {
      const error = new AppError('Test error');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('AppError');
      expect(error.code).toBe('APP_ERROR');
      expect(error.category).toBe(ERROR_CATEGORY.UNKNOWN);
      expect(error.severity).toBe(ERROR_SEVERITY.ERROR);
      expect(error.context).toEqual({});
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.stack).toBeDefined();
    });
    
    it('should create an error with custom properties', () => {
      const error = new AppError('Custom error', {
        code: 'CUSTOM_ERROR',
        category: ERROR_CATEGORY.VALIDATION,
        severity: ERROR_SEVERITY.WARNING,
        context: { key: 'value' },
        userMessage: 'User message',
        helpLink: 'https://example.com/help'
      });
      
      expect(error.message).toBe('Custom error');
      expect(error.code).toBe('CUSTOM_ERROR');
      expect(error.category).toBe(ERROR_CATEGORY.VALIDATION);
      expect(error.severity).toBe(ERROR_SEVERITY.WARNING);
      expect(error.context).toEqual({ key: 'value' });
      expect(error.userMessage).toBe('User message');
      expect(error.helpLink).toBe('https://example.com/help');
    });
    
    it('should add cause information when provided', () => {
      const originalError = new Error('Original error');
      const error = new AppError('Wrapper error', {
        cause: originalError
      });
      
      expect(error.cause).toBe(originalError);
      expect(error.context.cause).toBeDefined();
      expect(error.context.cause.message).toBe('Original error');
      expect(error.context.cause.name).toBe('Error');
      expect(error.context.cause.stack).toBeDefined();
    });
    
    it('should generate appropriate user-friendly messages', () => {
      // Test different categories
      const validationError = new AppError('Validation failed', { 
        category: ERROR_CATEGORY.VALIDATION 
      });
      expect(validationError.userMessage).toBe('The provided input is invalid.');
      
      const authError = new AppError('Auth failed', { 
        category: ERROR_CATEGORY.AUTHENTICATION 
      });
      expect(authError.userMessage).toBe('Authentication failed. Please sign in again.');
      
      const networkError = new AppError('Network error', { 
        category: ERROR_CATEGORY.NETWORK 
      });
      expect(networkError.userMessage).toBe('A network error occurred. Please check your connection and try again.');
    });
    
    it('should allow adding additional context', () => {
      const error = new AppError('Test error');
      
      // Add context
      error.withContext({ 
        userId: '123', 
        action: 'login' 
      });
      
      expect(error.context.userId).toBe('123');
      expect(error.context.action).toBe('login');
      
      // Add more context
      error.withContext({
        attempt: 2,
        ip: '127.0.0.1'
      });
      
      expect(error.context.userId).toBe('123'); // Original context preserved
      expect(error.context.attempt).toBe(2); // New context added
      expect(error.context.ip).toBe('127.0.0.1'); // New context added
    });
    
    it('should convert to plain object for serialization', () => {
      const error = new AppError('Test error', {
        code: 'TEST_ERR',
        context: { key: 'value' }
      });
      
      const serialized = error.toJSON();
      
      expect(serialized.name).toBe('AppError');
      expect(serialized.message).toBe('Test error');
      expect(serialized.code).toBe('TEST_ERR');
      expect(serialized.context).toEqual({ key: 'value' });
      expect(serialized.stack).toBeDefined();
      
      // Without stack
      const serializedNoStack = error.toJSON(false);
      expect(serializedNoStack.stack).toBeUndefined();
    });
    
    it('should create AppError from standard Error', () => {
      const stdError = new Error('Standard error');
      const appError = AppError.from(stdError, {
        code: 'CONVERTED',
        context: { source: 'test' }
      });
      
      expect(appError).toBeInstanceOf(AppError);
      expect(appError.message).toBe('Standard error');
      expect(appError.code).toBe('CONVERTED');
      expect(appError.context.source).toBe('test');
      expect(appError.cause).toBe(stdError);
    });
    
    it('should return same instance when converting an AppError', () => {
      const originalError = new AppError('Original');
      const convertedError = AppError.from(originalError, {
        context: { additional: 'info' }
      });
      
      expect(convertedError).toBe(originalError); // Same instance
      expect(convertedError.context.additional).toBe('info'); // With added context
    });
  });
  
  describe('ValidationError', () => {
    it('should create with appropriate defaults', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('ERR_VALIDATION');
      expect(error.category).toBe(ERROR_CATEGORY.VALIDATION);
      expect(error.severity).toBe(ERROR_SEVERITY.WARNING);
      expect(error.validationErrors).toEqual([]);
    });
    
    it('should handle validation errors object', () => {
      const validationErrors = {
        email: 'Must be a valid email',
        password: 'Must be at least 8 characters'
      };
      
      const error = new ValidationError('Validation failed', {
        validationErrors
      });
      
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.userMessage).toBe('Multiple validation errors occurred. Please check your input.');
      
      // With a single validation error
      const singleError = new ValidationError('Validation failed', {
        validationErrors: { email: 'Must be a valid email' }
      });
      
      expect(singleError.userMessage).toBe('Invalid value for email: Must be a valid email');
    });
    
    it('should include validation errors in JSON representation', () => {
      const error = new ValidationError('Validation failed', {
        validationErrors: { email: 'Invalid email' }
      });
      
      const json = error.toJSON();
      expect(json.validationErrors).toBeDefined();
      expect(json.validationErrors.email).toBe('Invalid email');
    });
  });
  
  describe('AuthenticationError', () => {
    it('should create with appropriate defaults', () => {
      const error = new AuthenticationError('Authentication failed');
      
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('ERR_AUTHENTICATION');
      expect(error.category).toBe(ERROR_CATEGORY.AUTHENTICATION);
      expect(error.severity).toBe(ERROR_SEVERITY.ERROR);
    });
  });
  
  describe('AuthorizationError', () => {
    it('should create with appropriate defaults', () => {
      const error = new AuthorizationError('Permission denied');
      
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Permission denied');
      expect(error.code).toBe('ERR_AUTHORIZATION');
      expect(error.category).toBe(ERROR_CATEGORY.AUTHORIZATION);
      expect(error.severity).toBe(ERROR_SEVERITY.ERROR);
    });
  });
  
  describe('DatabaseError', () => {
    it('should create with appropriate defaults', () => {
      const error = new DatabaseError('Database connection failed');
      
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Database connection failed');
      expect(error.code).toBe('ERR_DATABASE');
      expect(error.category).toBe(ERROR_CATEGORY.DATABASE);
      expect(error.severity).toBe(ERROR_SEVERITY.ERROR);
    });
  });
  
  describe('NetworkError', () => {
    it('should create with appropriate defaults', () => {
      const error = new NetworkError('Network request failed');
      
      expect(error).toBeInstanceOf(NetworkError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Network request failed');
      expect(error.code).toBe('ERR_NETWORK');
      expect(error.category).toBe(ERROR_CATEGORY.NETWORK);
      expect(error.severity).toBe(ERROR_SEVERITY.ERROR);
    });
  });
  
  describe('NotFoundError', () => {
    it('should create with appropriate defaults', () => {
      const error = new NotFoundError('User', '123');
      
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe("User with ID '123' not found");
      expect(error.code).toBe('ERR_NOT_FOUND');
      expect(error.category).toBe(ERROR_CATEGORY.RESOURCE);
      expect(error.severity).toBe(ERROR_SEVERITY.WARNING);
      expect(error.context.resourceType).toBe('User');
      expect(error.context.resourceId).toBe('123');
    });
    
    it('should generate user-friendly message', () => {
      const error = new NotFoundError('User', '123');
      expect(error.userMessage).toBe('The requested User could not be found.');
    });
  });
  
  describe('ConfigurationError', () => {
    it('should create with appropriate defaults', () => {
      const error = new ConfigurationError('Missing API key');
      
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Missing API key');
      expect(error.code).toBe('ERR_CONFIG');
      expect(error.category).toBe(ERROR_CATEGORY.CONFIG);
      expect(error.severity).toBe(ERROR_SEVERITY.ERROR);
    });
  });
}); 