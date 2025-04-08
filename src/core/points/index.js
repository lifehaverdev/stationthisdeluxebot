/**
 * Points Module
 * Main export file for the points management module
 */

const { UserPoints, PointType, PointOperation } = require('./models');
const { PointsRepository } = require('./repository');
const { PointsService } = require('./service');

// Export factory function to create the points system
function createPointsSystem(options = {}) {
  const repository = new PointsRepository(options.repository);
  const service = new PointsService(repository, options.service);
  
  return {
    repository,
    service
  };
}

// Export all components
module.exports = {
  // Models
  UserPoints,
  PointType,
  PointOperation,
  
  // Core services
  PointsRepository,
  PointsService,
  
  // Factory
  createPointsSystem
}; 