/**
 * Logger Utility
 * 
 * Provides consistent logging throughout the application
 */

const winston = require('winston');
const config = require('../config');
const util = require('util'); // Import the 'util' module

/**
 * Create a configured logger instance for a specific module
 * @param {string} module - Module name for the logger
 * @returns {object} Configured winston logger instance
 */
function createLogger(module) {
  // Custom replacer function for JSON.stringify to handle BigInts
  const jsonReplacer = (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  };

  // Define log format
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf((info) => {
      const { level, message, module, timestamp, stack } = info;
      // Start with the basic log message
      let log = `${timestamp} [${level.toUpperCase()}] [${module}]: ${message}`;
      
      // Access the splat symbol to get all additional arguments
      const splat = info[Symbol.for('splat')];
      
      // Handle additional arguments from splat
      if (splat && splat.length > 0) {
        log += splat.map(item => {
          // If the item is a simple string, just append it.
          if (typeof item === 'string') {
            return ` ${item}`;
          }
          // For objects, errors, etc., use util.inspect for detailed view on a new line.
          return `\n${util.inspect(item, { depth: 10, colors: false })}`;
        }).join('');
      }

      // If there's a stack trace from an error, append it last for clarity.
      if (stack) {
        log += `\n${stack}`;
      }

      return log;
    })
  );
  
  // Create logger instance
  const logger = winston.createLogger({
    level: config.LOG_LEVEL,
    format: logFormat,
    defaultMeta: { module },
    transports: [
      // Write logs to console in non-production environments
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      })
    ]
  });
  
  // Add file transport in production
  if (config.IS_PRODUCTION) {
    logger.add(
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error' 
      })
    );
    logger.add(
      new winston.transports.File({ 
        filename: 'logs/combined.log' 
      })
    );
  }
  
  return logger;
}

module.exports = {
  createLogger
}; 