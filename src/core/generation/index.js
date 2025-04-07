/**
 * Generation Module
 * Exports components for managing generation tasks
 */

const GenerationService = require('./service');
const GenerationRepository = require('./repository');
const { 
  GenerationRequest, 
  GenerationResponse, 
  GenerationTask, 
  GenerationStatus 
} = require('./models');

module.exports = {
  // Service
  GenerationService,
  
  // Repository
  GenerationRepository,
  
  // Models
  GenerationRequest,
  GenerationResponse,
  GenerationTask,
  GenerationStatus,
  
  // Default export is the service for convenience
  service: new GenerationService()
}; 