/**
 * User Module
 * Main export file for the user management module
 */

const { User, UserCore, UserEconomy, UserPreferences } = require('./models');
const { UserRepository } = require('./repository');
const { UserService } = require('./service');

// Export factory function to create the user system
function createUserSystem(options = {}) {
  const repository = new UserRepository(options.repository);
  const service = new UserService(repository, options.service);
  
  return {
    repository,
    service
  };
}

// Export all components
module.exports = {
  // Models
  User,
  UserCore,
  UserEconomy,
  UserPreferences,
  
  // Core services
  UserRepository,
  UserService,
  
  // Factory
  createUserSystem
}; 