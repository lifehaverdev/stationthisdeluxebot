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
  // Define log format
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, module, timestamp, ...meta }) => {
      const metaString = Object.keys(meta).length ? 
        ` | ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level.toUpperCase()}] [${module}]: ${message}${metaString}`;
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