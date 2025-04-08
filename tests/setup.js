/**
 * Test setup file for Jest
 * 
 * This file runs before tests to set up the testing environment.
 * It can be used to:
 *  - Mock global objects
 *  - Set up environment variables
 *  - Initialize services needed for testing
 *  - Configure mocks for external dependencies
 */

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.BOT_NAME = 'test_bot';
process.env.MONGO_PASS = 'mongodb://localhost:27017';
process.env.OPENAI_SECRET = 'test-openai-key';
process.env.API_KEY = 'test-api-key';

// Global test setup
beforeAll(async () => {
  console.log('Setting up test environment...');
  
  // Add any initialization logic needed before all tests
  // For example, connecting to a test database or initializing services
});

// Global teardown
afterAll(async () => {
  console.log('Tearing down test environment...');
  
  // Add any cleanup logic needed after all tests
  // For example, disconnecting from databases or closing connections
});

// Reset mocks between tests
beforeEach(() => {
  // Reset any mocks that might be shared between tests
  jest.resetModules();
  process.env = { ...process.env }; // Clone env to avoid cross-test pollution
});

// Add global test utilities if needed
global.testUtils = {
  // Helper functions for testing can be added here
  createMockUser: (overrides = {}) => {
    return {
      userId: 'test-user-id',
      username: 'testuser',
      createdAt: new Date().toISOString(),
      clientType: 'API', // Default to API client type instead of TELEGRAM
      ...overrides
    };
  },
  
  createMockPoints: (overrides = {}) => {
    return {
      userId: 'test-user-id',
      points: 100,
      qoints: 0,
      ...overrides
    };
  },

  createMockSession: (overrides = {}) => {
    return {
      sessionId: 'test-session-id',
      userId: 'test-user-id',
      clientType: 'API',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      state: {},
      ...overrides
    };
  },

  createMockError: (overrides = {}) => {
    return {
      code: 'TEST_ERROR',
      message: 'Test error message',
      severity: 'ERROR',
      category: 'TEST',
      context: {},
      ...overrides
    };
  },

  createMockErrorReporter: () => {
    return {
      reportError: jest.fn(),
      reportCriticalError: jest.fn(),
      toJSON: jest.fn()
    };
  },

  expectErrorHandling: (error, handler) => {
    const mockReporter = global.testUtils.createMockErrorReporter();
    handler.setErrorReporter(mockReporter);
    
    return {
      reporter: mockReporter,
      async verifyErrorHandled(severity = 'ERROR') {
        expect(mockReporter.reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: error.message,
            severity
          })
        );
      }
    };
  }
}; 