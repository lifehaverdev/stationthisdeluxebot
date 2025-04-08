/**
 * Session Module
 * 
 * Main export file for the session management system.
 * Provides exports for all necessary components.
 */

const { 
  SessionState, 
  SessionModel, 
  ClientType 
} = require('./models');

const { SessionRepository } = require('./repository');
const { SessionService } = require('./service');
const { createSessionAdapter } = require('./adapter');

// Export a factory function for creating a complete session system
function createSessionSystem(options = {}) {
  const repository = new SessionRepository(options.repository);
  const service = new SessionService(repository, options.service);
  const adapter = createSessionAdapter(options.legacyLobby, service);
  
  return {
    repository,
    service,
    adapter
  };
}

// Export all individual components
module.exports = {
  // Core classes
  SessionState,
  SessionModel,
  ClientType,
  SessionRepository,
  SessionService,
  createSessionAdapter,
  
  // Factory function
  createSessionSystem
}; 