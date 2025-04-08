/**
 * Core Module
 * Exports all core domain components and services
 */

const user = require('./user');
const points = require('./points');
const generation = require('./generation');
const events = require('./shared/events');
const workflow = require('./workflow');
const command = require('./command');

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
  workflow,
  command,
  
  // Shared components
  events,
  
  // Initialize integrations (exposed for manual initialization if needed)
  initializeIntegrations
}; 