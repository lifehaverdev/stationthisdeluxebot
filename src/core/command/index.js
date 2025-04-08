/**
 * Command System
 * 
 * Exports all components of the command system.
 */

const { CommandRegistry } = require('./registry');
const { CommandRouter, COMMAND_EVENTS } = require('./router');
const { MiddlewarePipeline, DEFAULT_ERROR_HANDLER } = require('./middleware');
const { AbstractCommandAdapter } = require('./adapters/abstractAdapter');
const { TelegramCommandAdapter } = require('./adapters/telegramAdapter');

// Create common middleware
const loggingMiddleware = (context, next) => {
  console.log(`Executing command: ${context.command.name}`);
  const startTime = Date.now();
  
  return next().then(result => {
    const duration = Date.now() - startTime;
    console.log(`Command ${context.command.name} executed in ${duration}ms`);
    return result;
  }).catch(error => {
    const duration = Date.now() - startTime;
    console.error(`Command ${context.command.name} failed after ${duration}ms:`, error);
    throw error;
  });
};

const validationMiddleware = (context, next) => {
  // Check if the command has a validate function
  if (context.command && typeof context.command.validate === 'function') {
    // Validate the input
    const validationResult = context.command.validate(context);
    
    if (validationResult !== true) {
      const error = new Error(validationResult || 'Validation failed');
      error.code = 'VALIDATION_FAILED';
      throw error;
    }
  }
  
  return next();
};

module.exports = {
  // Core classes
  CommandRegistry,
  CommandRouter,
  MiddlewarePipeline,
  
  // Adapters
  AbstractCommandAdapter,
  TelegramCommandAdapter,
  
  // Constants
  COMMAND_EVENTS,
  DEFAULT_ERROR_HANDLER,
  
  // Common middleware
  middleware: {
    logging: loggingMiddleware,
    validation: validationMiddleware
  },
  
  // Factory function to create a command router with common middleware
  createRouter: (options = {}) => {
    const router = new CommandRouter(options);
    
    // Add common middleware
    if (options.useLogging !== false) {
      router.use(loggingMiddleware);
    }
    
    if (options.useValidation !== false) {
      router.use(validationMiddleware);
    }
    
    return router;
  }
}; 