# MongoDB Repository

This directory contains a reusable MongoDB repository implementation that follows Clean Architecture patterns.

## Overview

The `MongoRepository` class provides a standardized interface for data access operations against MongoDB, implementing the Repository interface defined in `src/core/shared/repository.js`. The repository system is designed to:

1. Provide consistent data access patterns across the application
2. Handle connection pooling and reuse automatically
3. Centralize error handling and reporting
4. Enable testing with mocks and stubs
5. Publish events for monitoring and debugging

## Design Choices

### Singleton Connection Pool

The implementation uses a singleton pattern for MongoDB connections to ensure that:

- All repositories share the same connection pool
- Connection management is handled automatically
- Resources are used efficiently

```javascript
// Singleton pattern for MongoDB connection
let cachedClient = null;
let connectionPromise = null;
```

### Separation of Concerns

The repository follows Clean Architecture by:

- Isolating data access logic from business logic
- Using a consistent interface across different data sources
- Providing domain-specific repositories by extending the base class
- Centralizing data validation and transformation

### Error Handling Strategy

The `MongoRepository` implements a comprehensive error handling approach:

1. **Operation Monitoring**: Each database operation is wrapped in a monitoring function
2. **Error Tracking**: Errors are stored in the repository instance for later analysis
3. **Event Publishing**: Error events are published through the event bus
4. **Detailed Error Information**: Error details include operation type, duration, and stack trace

## Usage

### Basic Usage

```javascript
// Create a User repository
class UserRepository extends MongoRepository {
  constructor() {
    super({
      collectionName: 'users'
    });
  }
  
  // Add domain-specific methods
  async findByEmail(email) {
    return this.findOne({ email });
  }
}

// Use the repository
const userRepository = new UserRepository();
const user = await userRepository.findByEmail('user@example.com');
```

### Configuration

The `MongoRepository` can be configured with these options:

```javascript
const repository = new MongoRepository({
  collectionName: 'collection_name', // Required
  dbName: 'database_name',           // Optional (defaults to process.env.BOT_NAME)
  connectionString: 'mongodb://...', // Optional (defaults to process.env.MONGO_PASS)
  connectionOptions: {               // Optional MongoDB client options
    maxPoolSize: 10,
    connectTimeoutMS: 5000
  }
});
```

### Core Operations

The base repository implements all standard CRUD operations:

- `create(data)` - Insert a new document
- `find(query, options)` - Find documents matching a query
- `findOne(query, options)` - Find a single document
- `findById(id)` - Find document by ID
- `updateOne(query, data, options)` - Update a document
- `updateById(id, data, options)` - Update a document by ID
- `deleteOne(query, options)` - Delete a document
- `deleteById(id)` - Delete a document by ID
- `count(query, options)` - Count documents
- `exists(query)` - Check if a document exists

### Advanced Features

#### ObjectId Handling

The repository handles MongoDB ObjectId conversion automatically:

```javascript
// Both of these work the same
await repository.findById('507f1f77bcf86cd799439011');
await repository.findById(new ObjectId('507f1f77bcf86cd799439011'));
```

#### Monitoring and Statistics

The repository tracks operation statistics:

```javascript
const stats = repository.getStats();
console.log(`Total operations: ${stats.operationCount}`);
console.log(`Last operation: ${stats.lastOperation.type}`);
console.log(`Errors: ${stats.errorCount}`);
```

## Testing

The `MongoRepository` is designed for testability:

- The repository can be mocked for unit tests
- The `closeConnection()` static method allows proper test teardown
- The implementation includes comprehensive unit tests

### Example Test Setup

```javascript
// Mock MongoDB in tests
jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    db: jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ _id: '123', name: 'test' })
      })
    }),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined)
  })),
  ObjectId: jest.fn(id => ({ _id: id }))
}));
```

## Clean Architecture Integration

This repository implementation fits into our Clean Architecture by:

1. Providing the **Data Access Layer** that connects to external systems
2. Implementing the **Repository Interface** defined in our core domain
3. Enabling **Dependency Inversion** through interface adherence
4. Supporting **Testing** with clear boundaries for mocking

The repositories should be injected into domain services rather than being directly instantiated, following dependency injection principles. 