# Tests Directory

This directory contains the test suite for the application.

## Running Tests

To run the test suite:

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific tests
npm test -- tests/user.test.js

# Run tests in watch mode (for development)
npm test -- --watch
```

## Test Structure

Tests are organized to mirror the structure of the source code:

```
tests/
├── core/                   # Tests for core domain logic
│   ├── user/               # User domain tests
│   ├── points/             # Points domain tests
│   └── generation/         # Generation domain tests
├── integration/            # Integration tests
├── setup.js                # Global test setup and utilities
└── README.md               # Test documentation
```

## Writing Tests

Each test file should:

1. Import the necessary dependencies and the modules being tested
2. Define test cases using `describe` and `it`/`test` blocks
3. Mock external dependencies when needed
4. Verify the behavior through assertions

### Example Test

```javascript
const { test, expect, describe } = require('@jest/globals');
const { UserService } = require('../../src/core/user');

describe('UserService', () => {
  test('should create a new user', async () => {
    // Arrange
    const userService = new UserService();
    const userData = {
      username: 'testuser',
      // other user properties
    };

    // Act
    const result = await userService.createUser(userData);

    // Assert
    expect(result).toBeDefined();
    expect(result.core.username).toBe('testuser');
  });
});
```

## Test Utilities

Common test utilities and mock factories are available in `setup.js`:

```javascript
// Create a mock user for testing
const mockUser = global.testUtils.createMockUser({ 
  username: 'custom-user' 
});

// Create mock points for testing
const mockPoints = global.testUtils.createMockPoints({ 
  points: 500 
});
```

## Mocking Strategy

- Use Jest's mocking capabilities for external services and APIs
- Create mock repositories for data access testing
- Use in-memory implementations for integration tests

## Best Practices

1. **Isolate tests** - Each test should be independent
2. **Test one concept** - Focus on a single behavior in each test case
3. **Use meaningful names** - Name tests clearly to indicate what they verify
4. **Control test data** - Use predictable test fixtures
5. **Cover edge cases** - Test error conditions and boundary values 