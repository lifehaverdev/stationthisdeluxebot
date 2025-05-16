# Command Testing Suite

This directory contains tests for command implementations, ensuring they function correctly at both unit and end-to-end levels.

## Test Structure

The command tests are organized into:

1. **Unit Tests**: Test individual command functionality in isolation
2. **End-to-End Tests**: Validate full command workflows including integrations

## End-to-End Testing Strategy

End-to-end tests validate entire command workflows by:

- Testing the full user journey from input to result
- Mocking external dependencies to avoid real service calls
- Verifying correct interaction with all relevant services
- Confirming proper error handling and recovery
- Validating analytics and event tracking

### makeCommand.e2e.test.js

This test suite validates the `/make` image generation command workflow, covering:

- ✅ **Success Path**: Full prompt → generation → delivery flow
- 🚫 **Failure Handling**: Error responses, refunds, and recovery
- 🕓 **Timeout Handling**: Handling stale generations and cleanup
- 📡 **Webhook Integration**: Webhook resumption of workflows
- 🧮 **Points System**: Proper allocation, finalization, and refunding

All tests use mocked dependencies to avoid calling real services, while still validating that the interactions would be correct in production.

## Running Tests

To run all command tests:

```powershell
# Run all command tests
npm test -- tests/commands

# Run only make command tests
npm test -- tests/commands/makeCommand

# Run only E2E tests
npm test -- tests/commands/makeCommand.e2e.test.js
```

## Extending the Test Suite

When adding tests for new commands:

1. Create a unit test file named `commandName.test.js`
2. For complex workflows, add an E2E test file named `commandName.e2e.test.js`
3. Follow the patterns in existing tests for mocking dependencies
4. Ensure coverage of success paths, error handling, and edge cases
5. Validate all service interactions and points management where applicable 