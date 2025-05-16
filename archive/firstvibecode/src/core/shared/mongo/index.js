/**
 * MongoDB Repository Module
 * Exports MongoDB repository classes and utilities
 * 
 * @module core/shared/mongo
 */

const { MongoRepository } = require('./MongoRepository');
const { 
  MongoRepositoryFactory, 
  createMongoRepositoryFactory, 
  getDefaultFactory 
} = require('./MongoRepositoryFactory');

module.exports = {
  // Base repository class
  MongoRepository,
  
  // Factory for creating repository instances
  MongoRepositoryFactory,
  createMongoRepositoryFactory,
  getDefaultFactory,
  
  // Convenient shorthand method to get a repository instance using the default factory
  getRepository: (collectionName, options) => getDefaultFactory().getRepository(collectionName, options)
}; 