/**
 * Error Handling Example
 * 
 * This example demonstrates how to use the error handling system
 * with AppError hierarchy and ErrorHandler utility.
 */

const {
  AppError,
  ValidationError,
  NotFoundError,
  DatabaseError,
  ErrorHandler,
  ERROR_SEVERITY
} = require('../core/shared/errors');

// Simulated database module
const fakeDb = {
  users: [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' }
  ],
  findUser(id) {
    const user = this.users.find(user => user.id === id);
    
    if (!user) {
      // Simulate a database error sometimes
      if (Math.random() < 0.3) {
        throw new Error('Connection to database failed');
      }
      
      return null;
    }
    
    return user;
  }
};

/**
 * User service with error handling
 */
class UserService {
  constructor(options = {}) {
    this.db = options.db || fakeDb;
    this.errorHandler = options.errorHandler || new ErrorHandler();
  }
  
  /**
   * Get a user by ID with proper error handling
   * @param {string} userId User ID
   * @returns {Object} User data
   */
  getUserById(userId) {
    try {
      // Validate input
      if (!userId) {
        throw new ValidationError('User ID is required', {
          validationErrors: { userId: 'This field is required' }
        });
      }
      
      // Try to get user from database
      const user = this.db.findUser(userId);
      
      // Handle not found
      if (!user) {
        throw new NotFoundError('User', userId);
      }
      
      return user;
    } catch (error) {
      // Handle different types of errors
      if (error instanceof AppError) {
        // Already an AppError, just handle it
        throw this.errorHandler.handleError(error, { method: 'getUserById' });
      } else {
        // Convert to DatabaseError
        throw this.errorHandler.handleError(
          new DatabaseError('Database error while fetching user', {
            cause: error,
            severity: ERROR_SEVERITY.CRITICAL,
            context: { userId }
          }),
          { method: 'getUserById' }
        );
      }
    }
  }
  
  /**
   * Create a user with validation
   * @param {Object} userData User data
   * @returns {Object} Created user
   */
  createUser(userData) {
    try {
      // Validate required fields
      const validationErrors = {};
      
      if (!userData.name) {
        validationErrors.name = 'Name is required';
      }
      
      if (!userData.email) {
        validationErrors.email = 'Email is required';
      } else if (!userData.email.includes('@')) {
        validationErrors.email = 'Email must be valid';
      }
      
      // Throw validation error if any validation errors exist
      if (Object.keys(validationErrors).length > 0) {
        throw new ValidationError('Invalid user data', { validationErrors });
      }
      
      // Create user (simplified)
      const newUser = {
        id: String(Date.now()),
        ...userData
      };
      
      // Simulate adding to database
      this.db.users.push(newUser);
      
      return newUser;
    } catch (error) {
      // Handle and rethrow
      throw this.errorHandler.handleError(error, { 
        method: 'createUser',
        userData: { ...userData, password: '[REDACTED]' }
      });
    }
  }
}

/**
 * HTTP controller example
 */
class UserController {
  constructor() {
    this.userService = new UserService();
    this.errorHandler = new ErrorHandler();
  }
  
  /**
   * Handle get user request
   * @param {Object} req Request object
   * @param {Object} res Response object
   */
  handleGetUser(req, res) {
    try {
      const userId = req.params.id;
      
      // Get user from service
      const user = this.userService.getUserById(userId);
      
      // Send success response
      this.sendResponse(res, 200, {
        success: true,
        data: { user }
      });
    } catch (error) {
      // Handle error
      this.handleError(error, req, res);
    }
  }
  
  /**
   * Handle create user request
   * @param {Object} req Request object
   * @param {Object} res Response object
   */
  handleCreateUser(req, res) {
    try {
      const userData = req.body;
      
      // Create user through service
      const user = this.userService.createUser(userData);
      
      // Send success response
      this.sendResponse(res, 201, {
        success: true,
        data: { user }
      });
    } catch (error) {
      // Handle error
      this.handleError(error, req, res);
    }
  }
  
  /**
   * Send response helper
   * @param {Object} res Response object
   * @param {number} statusCode HTTP status code
   * @param {Object} data Response data
   */
  sendResponse(res, statusCode, data) {
    // Simulate response
    console.log(`[${statusCode}]`, JSON.stringify(data, null, 2));
  }
  
  /**
   * Handle error helper
   * @param {Error} error Error object
   * @param {Object} req Request object
   * @param {Object} res Response object
   */
  handleError(error, req, res) {
    // Process error with context
    const appError = this.errorHandler.handleError(error, {
      url: req.url,
      method: req.method,
      userId: req.userId
    });
    
    // Create error response (include details in development)
    const errorResponse = this.errorHandler.createErrorResponse(appError, true);
    
    // Determine status code based on error category
    let statusCode = 500;
    
    switch (appError.category) {
      case 'validation':
        statusCode = 400;
        break;
      case 'authentication':
        statusCode = 401;
        break;
      case 'authorization':
        statusCode = 403;
        break;
      case 'resource':
        statusCode = 404;
        break;
    }
    
    // Send error response
    this.sendResponse(res, statusCode, errorResponse);
  }
}

/**
 * Run the error handling example
 */
function runErrorHandlingExample() {
  console.log('Starting error handling example...');
  
  // Create controller
  const userController = new UserController();
  
  console.log('\n--- Example 1: Get existing user ---');
  userController.handleGetUser(
    { params: { id: '1' }, url: '/users/1', method: 'GET' },
    {}
  );
  
  console.log('\n--- Example 2: Get non-existent user (404) ---');
  userController.handleGetUser(
    { params: { id: '999' }, url: '/users/999', method: 'GET' },
    {}
  );
  
  console.log('\n--- Example 3: Missing user ID (validation error) ---');
  userController.handleGetUser(
    { params: {}, url: '/users/', method: 'GET' },
    {}
  );
  
  console.log('\n--- Example 4: Create user with valid data ---');
  userController.handleCreateUser(
    { 
      body: { name: 'Charlie', email: 'charlie@example.com' },
      url: '/users',
      method: 'POST'
    },
    {}
  );
  
  console.log('\n--- Example 5: Create user with invalid data (validation) ---');
  userController.handleCreateUser(
    { 
      body: { name: 'Dave' }, // Missing email
      url: '/users',
      method: 'POST'
    },
    {}
  );
  
  console.log('\n--- Example 6: Exception handling ---');
  try {
    // Force an error
    throw new Error('Unexpected application error');
  } catch (error) {
    // Handle with error handler
    const errorHandler = new ErrorHandler();
    const appError = errorHandler.handleError(error, {
      component: 'example',
      context: 'runErrorHandlingExample'
    });
    
    console.log('Normalized error:', JSON.stringify(appError.toJSON(false), null, 2));
  }
  
  console.log('\nError handling example completed.');
}

module.exports = { runErrorHandlingExample, UserService, UserController }; 