/**
 * Tasks Module
 * Main export file for the task management module
 */

const TaskPointsService = require('./TaskPointsService');

// Factory function to create task services
function createTaskServices(options = {}) {
  const taskPointsService = new TaskPointsService({
    pointsService: options.pointsService,
    eventBus: options.eventBus
  });
  
  return {
    taskPointsService
  };
}

module.exports = {
  TaskPointsService,
  createTaskServices
}; 