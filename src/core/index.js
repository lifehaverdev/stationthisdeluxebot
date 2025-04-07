/**
 * Core Module
 * Exports all core domain components and services
 */

const user = require('./user');
const points = require('./points');
const generation = require('./generation');
const events = require('./shared/events');

// Initialize integrated components
function initializeIntegrations() {
  // Connect points with generation service
  generation.service = new generation.GenerationService({
    pointsService: points.service
  });
}

// Optional: Initialize integrations automatically
initializeIntegrations();

module.exports = {
  // Domain modules
  user,
  points,
  generation,
  
  // Shared components
  events,
  
  // Initialize integrations (exposed for manual initialization if needed)
  initializeIntegrations
}; 