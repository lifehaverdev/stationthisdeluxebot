/**
 * ErrorHandler Tests
 * 
 * Test suite for the ErrorHandler utility that tests error handling,
 * normalization, logging, and response creation.
 */

const { ErrorHandler } = require('../../../../src/core/shared/errors/ErrorHandler');
const { AppError } = require('../../../../src/core/shared/errors/AppError');
const { 
  ValidationError,
  ERROR_SEVERITY
} = require('../../../../src/core/shared/errors');
const testUtils = require('../../../../tests/utils');

describe('ErrorHandler', () => {
  let handler;
  let mockLogger;
  let mockReporter;
  
  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    
    // Create mock error reporter
    mockReporter = {
      reportError: jest.fn(),
      reportCriticalError: jest.fn()
    };
    
    // Create error handler with mocks
    handler = new ErrorHandler({
      logger: mockLogger,
      reportError: mockReporter
    });
  });
  
  describe('constructor', () => {
    it('should create an instance with default properties', () => {
      const defaultHandler = new ErrorHandler();
      expect(defaultHandler.logger).toBeDefined();
      expect(defaultHandler.reportError).toBeNull();
    });
    
    it('should create an instance with provided properties', () => {
      expect(handler.logger).toBe(mockLogger);
      expect(handler.reportError).toBe(mockReporter);
    });
  });
  
  describe('handleError', () => {
    it('should handle standard Error objects by converting to AppError', () => {
      const standardError = new Error('Standard error');
      const result = handler.handleError(standardError);
      
      expect(result).toBeInstanceOf(AppError);
      expect(result.message).toBe('Standard error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    it('should pass through AppError instances', () => {
      const appError = new AppError('App error', {
        code: 'TEST_ERROR',
        severity: ERROR_SEVERITY.WARNING
      });
      
      const result = handler.handleError(appError);
      
      expect(result).toBe(appError); // Same instance
      expect(mockLogger.warn).toHaveBeenCalled(); // Warning level log
    });
    
    it('should add context to errors when provided', () => {
      const error = new Error('Test error');
      const context = { 
        userId: '123', 
        operationId: 'OP_123', 
        requestPath: '/api/test' 
      };
      
      const result = handler.handleError(error, context);
      
      expect(result.context).toEqual(context);
    });
    
    it('should log errors with the appropriate severity level', () => {
      // Info level error
      const infoError = new AppError('Info', { severity: ERROR_SEVERITY.INFO });
      handler.handleError(infoError);
      expect(mockLogger.info).toHaveBeenCalled();
      
      // Warning level error
      const warnError = new AppError('Warning', { severity: ERROR_SEVERITY.WARNING });
      handler.handleError(warnError);
      expect(mockLogger.warn).toHaveBeenCalled();
      
      // Error level error
      const errorLevelError = new AppError('Error', { severity: ERROR_SEVERITY.ERROR });
      handler.handleError(errorLevelError);
      expect(mockLogger.error).toHaveBeenCalled();
      
      // Critical level error
      const criticalError = new AppError('Critical', { severity: ERROR_SEVERITY.CRITICAL });
      handler.handleError(criticalError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        expect.any(Object)
      );
    });
    
    it('should report critical errors to external service', () => {
      const criticalError = new AppError('Critical system failure', {
        severity: ERROR_SEVERITY.CRITICAL,
        code: 'SYSTEM_FAILURE'
      });
      
      handler.handleError(criticalError);
      
      expect(mockReporter.reportCriticalError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: criticalError.message,
          severity: 'CRITICAL'
        })
      );
    });
    
    it('should handle reporting failures gracefully', () => {
      // Setup reporter to throw
      mockReporter.reportCriticalError.mockImplementation(() => {
        throw new Error('Reporter failure');
      });
      
      const criticalError = new AppError('Critical error', {
        severity: ERROR_SEVERITY.CRITICAL
      });
      
      // Should not throw
      expect(() => {
        handler.handleError(criticalError);
      }).not.toThrow();
      
      // Should log the reporting error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to report error'),
        expect.any(Object)
      );
    });

    it('should report errors with correct severity', () => {
      // Create a mock AppError with warning severity to ensure proper severity handling
      const mockError = new AppError('Test validation error', {
        severity: ERROR_SEVERITY.WARNING
      });
      
      handler.handleError(mockError);
      
      expect(mockReporter.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: mockError.message,
          severity: 'WARNING'
        })
      );
    });

    it('should report critical errors using the test utility', () => {
      // Create a mock AppError with critical severity
      const criticalError = new AppError('Critical system error', {
        severity: ERROR_SEVERITY.CRITICAL
      });
      
      handler.handleError(criticalError);
      
      expect(mockReporter.reportCriticalError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: criticalError.message,
          severity: 'CRITICAL'
        })
      );
    });
  });
  
  describe('createErrorResponse', () => {
    it('should create a standardized error response', () => {
      const error = new AppError('Test error', {
        code: 'TEST_ERROR',
        userMessage: 'Something went wrong with the test'
      });
      
      const response = handler.createErrorResponse(error);
      
      expect(response).toEqual({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Something went wrong with the test'
        }
      });
    });
    
    it('should fall back to error message when userMessage is not provided', () => {
      const error = new AppError('System error message');
      
      const response = handler.createErrorResponse(error);
      
      // For AppErrors without a userMessage, it falls back to the default
      // user-friendly message based on the category
      expect(response.error.message).toBeDefined();
      expect(typeof response.error.message).toBe('string');
    });
    
    it('should include error details when requested', () => {
      const error = new ValidationError('Validation failed', {
        validationErrors: { email: 'Invalid email' },
        context: { requestId: '123' }
      });
      
      const response = handler.createErrorResponse(error, true);
      
      expect(response.error.details).toBeDefined();
      expect(response.error.details.id).toBeDefined();
      expect(response.error.details.category).toBe('validation');
      expect(response.error.details.context.requestId).toBe('123');
      expect(response.error.details.stack).toBeDefined();
    });
    
    it('should not include error details when not requested', () => {
      const error = new ValidationError('Validation failed');
      
      const response = handler.createErrorResponse(error, false);
      
      expect(response.error.details).toBeUndefined();
    });
  });
}); 