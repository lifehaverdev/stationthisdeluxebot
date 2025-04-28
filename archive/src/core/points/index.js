/**
 * Points Module
 * 
 * Exports the PointsService and related utilities for point management across the application.
 */

const { PointsService, createPointsService, POINT_OPERATION } = require('./PointsService');

/**
 * Factory function to create a points service with default configuration
 * @param {Object} options - Configuration options
 * @returns {PointsService} Configured points service instance
 */
function createDefaultPointsService(options = {}) {
  // Apply any default configuration here if needed
  return createPointsService(options);
}

module.exports = {
  PointsService,
  createPointsService,
  createDefaultPointsService,
  POINT_OPERATION,
}; 