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
});

// Add global test utilities if needed
global.testUtils = {
  // Helper functions for testing can be added here
  createMockUser: (overrides = {}) => {
    return {
      userId: 'test-user-id',
      username: 'testuser',
      createdAt: new Date().toISOString(),
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
  }
}; 