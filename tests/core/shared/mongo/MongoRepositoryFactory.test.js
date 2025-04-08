/**
 * MongoRepositoryFactory Unit Tests
 * 
 * These tests verify the functionality of the MongoRepositoryFactory:
 * - Factory instantiation with various options
 * - Repository creation and caching
 * - Default factory singleton behavior
 * - Custom repository creation
 * - Statistics tracking
 */

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');

// Mock the MongoRepository
jest.mock('../../../../src/core/shared/mongo/MongoRepository', () => {
  const MockMongoRepository = jest.fn().mockImplementation((options) => ({
    options,
    getStats: jest.fn().mockReturnValue({
      operationCount: 5,
      errors: []
    })
  }));
  
  MockMongoRepository.closeConnection = jest.fn().mockResolvedValue(undefined);
  
  return { MongoRepository: MockMongoRepository };
});

// Mock the events module
jest.mock('../../../../src/core/shared/events', () => ({
  __esModule: true,
  default: {
    publish: jest.fn()
  }
}));

// Import after mocking
const { 
  MongoRepositoryFactory, 
  createMongoRepositoryFactory, 
  getDefaultFactory 
} = require('../../../../src/core/shared/mongo/MongoRepositoryFactory');

const { MongoRepository } = require('../../../../src/core/shared/mongo/MongoRepository');
const eventBus = require('../../../../src/core/shared/events').default;

describe('MongoRepositoryFactory', () => {
  beforeEach(() => {
    // Reset module state between tests
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    // Reset the default factory for each test
    jest.resetModules();
  });
  
  // Test factory instantiation
  describe('Instantiation', () => {
    it('should create a factory with default options', () => {
      const factory = new MongoRepositoryFactory();
      
      expect(factory).toBeDefined();
      expect(factory.defaultOptions).toHaveProperty('dbName');
      expect(factory.defaultOptions).toHaveProperty('connectionString');
      expect(factory.defaultOptions).toHaveProperty('connectionOptions');
      expect(factory.repositories).toBeDefined();
      expect(factory.repositories.size).toBe(0);
      
      // Should emit initialization event
      expect(eventBus.publish).toHaveBeenCalledWith(
        'mongoFactory:initialized',
        expect.objectContaining({
          timestamp: expect.any(Date),
          dbName: expect.any(String)
        })
      );
    });
    
    it('should create a factory with custom options', () => {
      const customOptions = {
        dbName: 'test-db',
        connectionString: 'mongodb://localhost:27017',
        connectionOptions: {
          maxPoolSize: 5
        }
      };
      
      const factory = new MongoRepositoryFactory(customOptions);
      
      expect(factory.defaultOptions.dbName).toBe(customOptions.dbName);
      expect(factory.defaultOptions.connectionString).toBe(customOptions.connectionString);
      expect(factory.defaultOptions.connectionOptions.maxPoolSize).toBe(
        customOptions.connectionOptions.maxPoolSize
      );
    });
  });
  
  // Test repository creation
  describe('Repository Management', () => {
    let factory;
    
    beforeEach(() => {
      factory = new MongoRepositoryFactory();
    });
    
    it('should create a repository for a collection', () => {
      const repo = factory.getRepository('users');
      
      expect(repo).toBeDefined();
      expect(MongoRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: 'users'
        })
      );
      
      // Should emit repository creation event
      expect(eventBus.publish).toHaveBeenCalledWith(
        'mongoFactory:repositoryCreated',
        expect.objectContaining({
          timestamp: expect.any(Date),
          collectionName: 'users'
        })
      );
    });
    
    it('should return cached repository instance for the same collection', () => {
      const repo1 = factory.getRepository('users');
      const repo2 = factory.getRepository('users');
      
      expect(repo1).toBe(repo2);
      expect(MongoRepository).toHaveBeenCalledTimes(1);
    });
    
    it('should create different repositories for different collections', () => {
      const usersRepo = factory.getRepository('users');
      const postsRepo = factory.getRepository('posts');
      
      expect(usersRepo).not.toBe(postsRepo);
      expect(MongoRepository).toHaveBeenCalledTimes(2);
      expect(factory.repositories.size).toBe(2);
    });
    
    it('should throw an error if no collection name is provided', () => {
      expect(() => {
        factory.getRepository();
      }).toThrow('Collection name is required');
    });
    
    it('should create a repository with collection-specific options', () => {
      const repo = factory.getRepository('users', { 
        dbName: 'custom-db'
      });
      
      expect(repo.options.dbName).toBe('custom-db');
      expect(repo.options.collectionName).toBe('users');
    });
    
    it('should create different cache keys for different databases', () => {
      const repo1 = factory.getRepository('users', { dbName: 'db1' });
      const repo2 = factory.getRepository('users', { dbName: 'db2' });
      
      expect(repo1).not.toBe(repo2);
      expect(factory.repositories.size).toBe(2);
    });
  });
  
  // Test factory helper functions
  describe('Factory Helpers', () => {
    let originalModule;
    
    // Clear the module cache before each test
    beforeEach(() => {
      jest.resetModules();
      // Re-import with a clean slate for each test
      originalModule = require('../../../../src/core/shared/mongo/MongoRepositoryFactory');
    });
    
    it('should create a factory using the helper function', () => {
      const { createMongoRepositoryFactory, MongoRepositoryFactory } = originalModule; 
      const factory = createMongoRepositoryFactory();
      
      expect(factory).toBeInstanceOf(MongoRepositoryFactory);
    });
    
    it('should maintain a singleton default factory', () => {
      const { getDefaultFactory } = originalModule;
      const factory1 = getDefaultFactory();
      const factory2 = getDefaultFactory();
      
      expect(factory1).toBe(factory2);
    });
    
    it('should only use options on first call to getDefaultFactory', () => {
      const { getDefaultFactory } = originalModule;
      const options1 = { dbName: 'first-db' };
      const options2 = { dbName: 'second-db' };
      
      const factory1 = getDefaultFactory(options1);
      const factory2 = getDefaultFactory(options2);
      
      expect(factory1).toBe(factory2);
      expect(factory1.defaultOptions.dbName).toBe('first-db');
    });
  });
  
  // Test custom repositories
  describe('Custom Repositories', () => {
    let factory;
    
    beforeEach(() => {
      factory = new MongoRepositoryFactory();
    });
    
    it('should create a repository with custom methods', () => {
      const customMethods = {
        findByUsername: jest.fn().mockResolvedValue({ username: 'test' }),
        isAdmin: jest.fn().mockReturnValue(true)
      };
      
      const repo = factory.createCustomRepository('users', customMethods);
      
      expect(repo.findByUsername).toBeDefined();
      expect(repo.isAdmin).toBeDefined();
      expect(repo.options.collectionName).toBe('users');
    });
    
    it('should not modify the base repository when creating a custom one', () => {
      const baseRepo = factory.getRepository('users');
      const customRepo = factory.createCustomRepository('users', {
        customMethod: () => {}
      });
      
      expect(customRepo.customMethod).toBeDefined();
      expect(baseRepo.customMethod).toBeUndefined();
    });
  });
  
  // Test statistics and cleanup
  describe('Stats and Cleanup', () => {
    let factory;
    
    beforeEach(() => {
      factory = new MongoRepositoryFactory();
      // Create some repositories
      factory.getRepository('users');
      factory.getRepository('posts');
    });
    
    it('should collect stats from all repositories', () => {
      const stats = factory.getStats();
      
      expect(stats.repositoryCount).toBe(2);
      expect(stats.operationCount).toBe(10); // 5 * 2
      expect(stats.errorCount).toBe(0);
      expect(stats.repositories).toHaveProperty('users');
      expect(stats.repositories).toHaveProperty('posts');
    });
    
    it('should clear the repository cache', () => {
      expect(factory.repositories.size).toBe(2);
      
      factory.clearCache();
      
      expect(factory.repositories.size).toBe(0);
      expect(eventBus.publish).toHaveBeenCalledWith(
        'mongoFactory:cacheCleared',
        expect.any(Object)
      );
    });
    
    it('should close all MongoDB connections', async () => {
      await factory.closeAllConnections();
      
      expect(MongoRepository.closeConnection).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith(
        'mongoFactory:connectionsClose',
        expect.any(Object)
      );
    });
  });
}); 