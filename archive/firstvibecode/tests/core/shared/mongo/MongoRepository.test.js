/**
 * Tests for MongoRepository
 */

// Mock MongoDB modules
jest.mock('mongodb', () => {
  const mockCollection = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue({ _id: '123', name: 'test' }),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true, insertedId: '123' }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(42),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([{ _id: '1', name: 'test1' }, { _id: '2', name: 'test2' }])
  };
  
  const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection)
  };
  
  const mockClient = {
    db: jest.fn().mockReturnValue(mockDb),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    topology: { isConnected: jest.fn().mockReturnValue(true) }
  };
  
  const MockMongoClient = jest.fn().mockImplementation(() => mockClient);
  
  return {
    MongoClient: MockMongoClient,
    ObjectId: jest.fn(id => ({ _id: id, toString: () => id }))
  };
});

// Mock events
jest.mock('../../../../src/core/shared/events', () => {
  const eventMock = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  };
  return {
    // Default export
    __esModule: true,
    default: eventMock,
    // Named exports
    events: eventMock,
    publish: eventMock.publish,
    subscribe: eventMock.subscribe,
    unsubscribe: eventMock.unsubscribe
  };
});

// Imports
const { MongoRepository } = require('../../../../src/core/shared/mongo/MongoRepository');
const { MongoClient, ObjectId } = require('mongodb');
const eventBus = require('../../../../src/core/shared/events').default;

describe('MongoRepository', () => {
  let repository;
  let mockCollection;
  let mockClient;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Get reference to the mocked MongoDB elements
    mockClient = MongoClient.mock.results.length ? 
      MongoClient.mock.results[0].value : 
      MongoClient();
      
    mockCollection = mockClient.db().collection();
    
    // Reset mock implementations with default success cases
    mockCollection.findOne.mockResolvedValue({ _id: '123', name: 'test' });
    mockCollection.insertOne.mockResolvedValue({ acknowledged: true, insertedId: '123' });
    mockCollection.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    mockCollection.deleteOne.mockResolvedValue({ acknowledged: true, deletedCount: 1 });
    mockCollection.countDocuments.mockResolvedValue(42);
    mockCollection.toArray.mockResolvedValue([{ _id: '1', name: 'test1' }, { _id: '2', name: 'test2' }]);
    
    // Create repository instance
    repository = new MongoRepository({
      collectionName: 'test_collection',
      dbName: 'test_db',
      connectionString: 'mongodb://localhost:27017'
    });
  });
  
  describe('constructor', () => {
    test('should throw error if collectionName not provided', () => {
      expect(() => new MongoRepository({})).toThrow('MongoRepository requires collectionName option');
      expect(() => new MongoRepository()).toThrow('MongoRepository requires collectionName option');
    });
    
    test('should initialize with correct values', () => {
      // Save original environment and override
      const originalEnv = process.env;
      process.env = { ...originalEnv, BOT_NAME: 'test_bot', MONGO_PASS: 'mongodb://env:27017' };
      
      // Create with minimal options
      const repo = new MongoRepository({ collectionName: 'test_collection' });
      
      // Check properties
      expect(repo.collectionName).toBe('test_collection');
      expect(repo.dbName).toBe('test_bot');
      expect(repo.connectionString).toBe('mongodb://env:27017');
      expect(repo.connectionOptions).toBeDefined();
      
      // Create with all options
      const repoWithOptions = new MongoRepository({
        collectionName: 'custom_collection',
        dbName: 'custom_db',
        connectionString: 'mongodb://custom:27017',
        connectionOptions: { maxPoolSize: 5 }
      });
      
      // Check properties
      expect(repoWithOptions.collectionName).toBe('custom_collection');
      expect(repoWithOptions.dbName).toBe('custom_db');
      expect(repoWithOptions.connectionString).toBe('mongodb://custom:27017');
      expect(repoWithOptions.connectionOptions.maxPoolSize).toBe(5);
      
      // Restore environment
      process.env = originalEnv;
    });
  });
  
  describe('connection management', () => {
    test('should reuse existing client connection', async () => {
      // Setup client to indicate it's connected
      mockClient.topology.isConnected.mockReturnValue(true);
      
      // First call should establish connection
      await repository.getClient();
      
      // Reset the call count to verify subsequent calls
      MongoClient.mockClear();
      
      // Second call should reuse the connection
      await repository.getClient();
      
      // No new client should be created
      expect(MongoClient).not.toHaveBeenCalled();
    });
  });
  
  describe('error monitoring', () => {
    test('should track operation errors', async () => {
      // Force operation to fail
      mockCollection.findOne.mockRejectedValueOnce(new Error('Query failed'));
      
      // Attempt operation
      await expect(repository.findOne({ test: true })).rejects.toThrow('Query failed');
      
      // Verify error tracking
      expect(repository.errors.length).toBe(1);
      expect(repository.errors[0].error).toBe('Query failed');
      expect(repository.errors[0].type).toBe('findOne');
      
      // Verify error event was published
      expect(eventBus.publish).toHaveBeenCalledWith('mongodb:operationError', expect.objectContaining({
        error: 'Query failed'
      }));
    });
    
    test('should track operation stats', async () => {
      // Configure mock to return success
      mockCollection.findOne.mockResolvedValueOnce({ _id: '123', name: 'test' });
      
      // Perform operation
      await repository.findOne({ test: true });
      
      // Get stats
      const stats = repository.getStats();
      
      // Verify stats
      expect(stats.operationCount).toBe(1);
      expect(stats.lastOperation.type).toBe('findOne');
      expect(stats.lastOperation.success).toBe(true);
    });
  });
  
  describe('CRUD operations', () => {
    test('should create document', async () => {
      // Configure mock to return success
      mockCollection.insertOne.mockResolvedValueOnce({ 
        acknowledged: true,
        insertedId: '123'
      });
      
      // Create document
      const result = await repository.create({ name: 'test' });
      
      // Verify document was created with ID
      expect(mockCollection.insertOne).toHaveBeenCalledWith({ name: 'test' });
      expect(result).toEqual({ name: 'test', _id: '123' });
    });
    
    test('should find documents by query', async () => {
      // Configure mock to return results
      mockCollection.toArray.mockResolvedValueOnce([
        { _id: '1', name: 'test1' },
        { _id: '2', name: 'test2' }
      ]);
      
      // Find documents with options
      const results = await repository.find({ name: /test/ }, { 
        sort: { name: 1 },
        skip: 10,
        limit: 20
      });
      
      // Verify query was executed
      expect(mockCollection.find).toHaveBeenCalledWith({ name: /test/ }, expect.any(Object));
      expect(mockCollection.sort).toHaveBeenCalledWith({ name: 1 });
      expect(mockCollection.skip).toHaveBeenCalledWith(10);
      expect(mockCollection.limit).toHaveBeenCalledWith(20);
      expect(results).toEqual([
        { _id: '1', name: 'test1' },
        { _id: '2', name: 'test2' }
      ]);
    });
    
    test('should find one document by query', async () => {
      // Configure mock to return result
      mockCollection.findOne.mockResolvedValueOnce({ _id: '123', name: 'test' });
      
      // Find one document
      const result = await repository.findOne({ name: 'test' });
      
      // Verify query was executed
      expect(mockCollection.findOne).toHaveBeenCalledWith({ name: 'test' }, {});
      expect(result).toEqual({ _id: '123', name: 'test' });
    });
    
    test('should find document by ID', async () => {
      // Configure mock to return result
      mockCollection.findOne.mockResolvedValueOnce({ _id: '123', name: 'test' });
      
      // Find by ID
      const result = await repository.findById('123');
      
      // Verify query was executed with proper ObjectId
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: expect.any(Object) });
      expect(result).toEqual({ _id: '123', name: 'test' });
    });
    
    test('should update document', async () => {
      // Configure mock to return success
      mockCollection.updateOne.mockResolvedValueOnce({ 
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1 
      });
      
      // Update document
      const result = await repository.updateOne(
        { name: 'old' }, 
        { name: 'new', age: 30 }
      );
      
      // Verify update was executed with $set operator
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { name: 'old' }, 
        { $set: { name: 'new', age: 30 } }, 
        {}
      );
      expect(result).toEqual({ acknowledged: true, modifiedCount: 1 });
    });
    
    test('should update document by ID', async () => {
      // Configure mock to return success
      mockCollection.updateOne.mockResolvedValueOnce({ 
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1 
      });
      
      // Update document by ID
      await repository.updateById('123', { name: 'new' });
      
      // Verify update was executed with proper ID and $set operator
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(Object) }, 
        { $set: { name: 'new' } }, 
        {}
      );
    });
    
    test('should delete document', async () => {
      // Configure mock to return success
      mockCollection.deleteOne.mockResolvedValueOnce({ 
        acknowledged: true,
        deletedCount: 1 
      });
      
      // Delete document
      const result = await repository.deleteOne({ name: 'test' });
      
      // Verify deletion was executed
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ name: 'test' }, {});
      expect(result).toBe(true);
    });
    
    test('should return false when deleting non-existent document', async () => {
      // Configure mock to return no deletions
      mockCollection.deleteOne.mockResolvedValueOnce({ 
        acknowledged: true,
        deletedCount: 0 
      });
      
      // Delete document
      const result = await repository.deleteOne({ name: 'nonexistent' });
      
      // Verify result
      expect(result).toBe(false);
    });
    
    test('should count documents', async () => {
      // Configure mock to return count
      mockCollection.countDocuments.mockResolvedValueOnce(42);
      
      // Count documents
      const count = await repository.count({ status: 'active' });
      
      // Verify count was executed
      expect(mockCollection.countDocuments).toHaveBeenCalledWith({ status: 'active' }, {});
      expect(count).toBe(42);
    });
    
    test('should check if document exists', async () => {
      // Configure mock to return count
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      
      // Check existence
      const exists = await repository.exists({ email: 'test@example.com' });
      
      // Verify count was executed with limit
      expect(mockCollection.countDocuments).toHaveBeenCalledWith(
        { email: 'test@example.com' }, 
        { limit: 1 }
      );
      expect(exists).toBe(true);
    });
  });
}); 