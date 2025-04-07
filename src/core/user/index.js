/**
 * User Module
 * Exports components for user management
 */

const UserService = require('./service');
const UserRepository = require('./repository');
const { User, UserCore, UserEconomy, UserPreferences } = require('./models');

module.exports = {
  // Service
  UserService,
  
  // Repository
  UserRepository,
  
  // Models
  User,
  UserCore,
  UserEconomy,
  UserPreferences,
  
  // Default export is the service for convenience
  service: new UserService()
}; 