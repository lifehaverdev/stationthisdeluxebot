/**
 * Points Module
 * Exports components for points management
 */

const PointsService = require('./service');
const PointsRepository = require('./repository');
const PointsCalculationService = require('./calculation-service');
const { UserPoints, PointType, PointConstants, PointOperation } = require('./models');

module.exports = {
  // Services
  PointsService,
  PointsCalculationService,
  
  // Repository
  PointsRepository,
  
  // Models
  UserPoints,
  PointType,
  PointConstants,
  PointOperation,
  
  // Default export is the service for convenience
  service: new PointsService()
}; 