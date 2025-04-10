# Points Service Tests

This directory contains tests for the core points system.

## Files

- `points.test.js` - Original Jest-based unit tests for the Points Service
- `points-service.test.js` - Integration tests for the Points Service with exportable test runner
- `fix-points-tests.md` - Documentation about fixes made to unit tests

## Running Tests

### Individual Test Files

To run individual test files:

```bash
# Run unit tests with Jest
npm test -- tests/core/points/points.test.js

# Run integration tests directly
node tests/core/points/points-service.test.js
```

### All Integration Tests

The points service tests are also integrated into the main test runner:

```bash
# Run all integration tests
node src/tests/run-all-tests.js
```

## Test Coverage

The Points Service tests cover:

1. **Core Point Operations**
   - Getting and checking user points
   - Adding and deducting points of different types
   - Validating input parameters
   - Checking point sufficiency

2. **Point Calculations**
   - Regenerating points based on time intervals
   - Calculating maximum allowed points
   - Determining if users have reached point limits
   - Computing generation costs for different models

3. **Event Publishing**
   - Verifying events are published for point operations
   - Checking event payloads contain the right information

## Mocking Strategy

The tests use Jest mocks to isolate the Points Service from its dependencies:

- Repository layer is mocked to provide predictable data
- Calculation service is mocked for deterministic results
- Event bus is mocked to verify event publishing

## Recent Changes

The tests were updated to be runnable via the main test runner by:

1. Exporting the `runPointsServiceTests` function
2. Adapting tests to use basic assertions instead of Jest matchers
3. Updating the test structure to run independently or as part of the suite 