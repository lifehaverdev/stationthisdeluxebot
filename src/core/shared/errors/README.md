# Error Handling Module

This module provides a standardized approach to error handling throughout the application. It includes a hierarchy of error classes, constants for error categorization, and utilities for error processing and formatting.

## Features

- **Error Class Hierarchy**: Extend from the base `AppError` class for specific error types
- **Error Categorization**: Classify errors by category and severity
- **Contextual Information**: Attach relevant context to errors for better debugging
- **User-Friendly Messages**: Provide separate messages for logging and user display
- **Standardized Response Format**: Create consistent API error responses
- **Error Normalization**: Convert standard errors to application-specific errors
- **Centralized Error Handling**: Process errors with the `ErrorHandler` utility
- **Error Reporting**: Support for external error reporting services

## Usage

### Basic Usage

```javascript
const { AppError, ValidationError, ErrorHandler } = require('../core/shared/errors');

// Create an error handler
const errorHandler = new ErrorHandler();

try {
  // Business logic
  if (!isValidInput(data)) {
    throw new ValidationError('Invalid input data', {
      code: 'INVALID_INPUT',
      validationErrors: {
        email: 'Email is required',
        password: 'Password must be at least 8 characters'
      }
    });
  }
} catch (error) {
  // Handle the error
  const normalizedError = errorHandler.handleError(error, {
    userId: req.userId,
    operation: 'createAccount'
  });
  
  // Create a standardized response
  const response = errorHandler.createErrorResponse(normalizedError);
  
  // Send response
  res.status(400).json(response);
}
```

### Creating Custom Error Types

```javascript
const { AppError, ERROR_CATEGORY, ERROR_SEVERITY } = require('../core/shared/errors');

class PaymentError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      code: options.code || 'ERR_PAYMENT',
      category: ERROR_CATEGORY.EXTERNAL,
      severity: ERROR_SEVERITY.ERROR,
      ...options
    });
    
    this.paymentId = options.paymentId;
    this.transactionId = options.transactionId;
  }
  
  getUserFriendlyMessage() {
    return 'We encountered an issue processing your payment. Please try again later.';
  }
}
```

### Using Error Handler with Custom Logger

```javascript
const { ErrorHandler } = require('../core/shared/errors');
const logger = require('../utils/logger');

// Create error handler with custom logger
const errorHandler = new ErrorHandler({
  logger,
  reportError: (error) => {
    // Send to error tracking service
    errorTrackingService.report(error);
  }
});

// Use in an API route
function apiMiddleware(req, res, next) {
  try {
    // API logic
  } catch (error) {
    const appError = errorHandler.handleError(error, {
      userId: req.userId,
      path: req.path,
      method: req.method
    });
    
    // Use true to include details in development
    const errorResponse = errorHandler.createErrorResponse(
      appError, 
      process.env.NODE_ENV === 'development'
    );
    
    res.status(getStatusCodeFromError(appError)).json(errorResponse);
  }
}

// Helper to determine status code
function getStatusCodeFromError(error) {
  switch (error.category) {
    case 'validation': return 400;
    case 'authentication': return 401;
    case 'authorization': return 403;
    case 'resource': return 404;
    default: return 500;
  }
}
```

## API Reference

### Error Classes

#### `AppError`

Base error class for all application errors.

```javascript
new AppError(message, options);
```

**Options:**
- `code` (string): Error code (e.g., 'ERR_INVALID_INPUT')
- `category` (string): Error category from ERROR_CATEGORY
- `severity` (string): Error severity from ERROR_SEVERITY
- `context` (object): Additional context data
- `cause` (Error): Original error that caused this error
- `userMessage` (string): User-friendly error message
- `helpLink` (string): Link to documentation or help page

**Methods:**
- `withContext(contextData)`: Add additional context to the error
- `toJSON(includeStack)`: Convert error to a plain object
- `getUserFriendlyMessage()`: Get a user-friendly message

**Static Methods:**
- `from(error, options)`: Create AppError from a standard Error

#### Specialized Error Classes

- `ValidationError`: For input validation errors
- `AuthenticationError`: For authentication failures
- `AuthorizationError`: For permission issues
- `DatabaseError`: For database operation failures
- `NetworkError`: For network-related issues
- `NotFoundError`: For resource not found errors
- `ConfigurationError`: For configuration problems

### Constants

#### `ERROR_SEVERITY`

- `INFO`: Informational messages (typically not shown to users)
- `WARNING`: Warning messages (may be shown to users)
- `ERROR`: Standard errors (shown to users)
- `CRITICAL`: Critical errors (require immediate attention)

#### `ERROR_CATEGORY`

- `VALIDATION`: Input validation errors
- `AUTHENTICATION`: Auth-related errors
- `AUTHORIZATION`: Permission-related errors
- `DATABASE`: Database operation errors
- `EXTERNAL`: External service errors
- `NETWORK`: Network-related errors
- `INTERNAL`: Internal application errors
- `RESOURCE`: Resource not found or unavailable
- `CONFIG`: Configuration errors
- `UNKNOWN`: Uncategorized errors

### ErrorHandler

Utility for handling and normalizing errors.

```javascript
new ErrorHandler(options);
```

**Options:**
- `logger` (object): Logger object with info, warn, error methods
- `reportError` (function): External error reporting function

**Methods:**
- `handleError(error, context)`: Process an error and return normalized AppError
- `createErrorResponse(error, includeDetails)`: Create standardized error response

## Best Practices

1. **Always use appropriate error types** - Choose the most specific error class for your situation
2. **Include relevant context** - Add data that will help with debugging
3. **Set appropriate severity** - Use the severity level that matches the impact
4. **Provide helpful user messages** - Make error messages clear and actionable
5. **Centralize error handling** - Use ErrorHandler in service entry points or middleware
6. **Don't expose sensitive details** - Filter sensitive data before including in context
7. **Log all critical errors** - Ensure critical errors are always logged
8. **Use consistent error codes** - Establish a naming convention for error codes

## Integration Examples

### Express Error Middleware

```javascript
const { ErrorHandler } = require('../core/shared/errors');

const errorHandler = new ErrorHandler();

// Express error middleware
function errorMiddleware(err, req, res, next) {
  const appError = errorHandler.handleError(err, {
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    requestId: req.id
  });
  
  // Include details in development only
  const isDev = process.env.NODE_ENV === 'development';
  const errorResponse = errorHandler.createErrorResponse(appError, isDev);
  
  // Determine status code
  let statusCode = 500;
  
  if (appError.category === 'validation') statusCode = 400;
  if (appError.category === 'authentication') statusCode = 401;
  if (appError.category === 'authorization') statusCode = 403;
  if (appError.category === 'resource') statusCode = 404;
  
  res.status(statusCode).json(errorResponse);
}
```

### Service Layer Error Handling

```javascript
const { ValidationError, DatabaseError } = require('../core/shared/errors');

class UserService {
  async createUser(userData) {
    // Validate input
    if (!userData.email) {
      throw new ValidationError('Invalid user data', {
        validationErrors: {
          email: 'Email is required'
        }
      });
    }
    
    try {
      // Try to create user
      return await this.userRepository.create(userData);
    } catch (error) {
      // Convert database errors
      throw new DatabaseError('Failed to create user', {
        cause: error,
        context: { userData: { ...userData, password: '[REDACTED]' } }
      });
    }
  }
}
``` 