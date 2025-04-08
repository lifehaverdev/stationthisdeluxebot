/**
 * Generation Module
 * Main export file for the generation management module
 */

const { GenerationTask, GenerationStatus, GenerationType, GenerationModel } = require('./models');
const { GenerationRepository } = require('./repository');
const { GenerationService } = require('./service');

// Export factory function to create the generation system
function createGenerationSystem(options = {}) {
  const repository = new GenerationRepository(options.repository);
  const service = new GenerationService(repository, options.service);
  
  return {
    repository,
    service
  };
}

// Export all components
module.exports = {
  // Models
  GenerationTask,
  GenerationStatus,
  GenerationType,
  GenerationModel,
  
  // Core services
  GenerationRepository,
  GenerationService,
  
  // Factory
  createGenerationSystem
}; 