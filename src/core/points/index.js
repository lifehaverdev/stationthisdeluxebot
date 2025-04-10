/**
 * Points Module
 * Main export file for the points management module
 */

const { UserPoints, PointType, PointOperation, PointConstants } = require('./models');
const { PointsRepository } = require('./repository');
const { PointsService } = require('./service');
const PointsCalculationService = require('./calculation-service');

// Export factory function to create the points system
function createPointsSystem(options = {}) {
  const repository = options.repository || new PointsRepository(options.repositoryOptions);
  const calculationService = options.calculationService || new PointsCalculationService(options.calculationOptions);
  
  const service = options.service || new PointsService({
    pointsRepository: repository,
    calculationService
  });
  
  return {
    repository,
    service,
    calculationService
  };
}

// Export all components
module.exports = {
  // Models
  UserPoints,
  PointType,
  PointOperation,
  PointConstants,
  
  // Core services
  PointsRepository,
  PointsService,
  PointsCalculationService,
  
  // Factory
  createPointsSystem
}; 