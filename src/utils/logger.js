/**
 * Logger Utility
 * 
 * Provides consistent logging throughout the application
 */

const winston = require('winston');
const config = require('../config');

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
    winston.format.printf(({ level, message, module, timestamp, stack, ...meta }) => {
      // Start with the basic log message
      let log = `${timestamp} [${level.toUpperCase()}] [${module}]: ${message}`;
      
      // If there's a stack trace from an error, append it. It's already formatted as a string.
      if (stack) {
        log += `\n${stack}`;
      }

      // If there's any other metadata, stringify and append it.
      const metaString = Object.keys(meta).length ? 
        `\n${JSON.stringify(meta, jsonReplacer, 2)}` : '';
      
      log += metaString;

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