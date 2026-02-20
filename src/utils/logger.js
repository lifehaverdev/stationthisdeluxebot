/**
 * Logger Utility
 * 
 * Provides consistent logging throughout the application
 */

const winston = require('winston');
const config = require('../config');
const util = require('util'); // Import the 'util' module

const registry = new Map(); // module → logger instance

function getRegistry() {
  return registry;
}

function setLevel(module, level) {
  if (module === '*') {
    for (const logger of registry.values()) logger.level = level;
  } else {
    const logger = registry.get(module);
    if (logger) logger.level = level;
    else throw new Error(`Unknown module: ${module}`);
  }
}

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
      const { level, message, module, timestamp, stack, httpStatus, alwaysLogFull } = info;

      // Detect status code from various possible locations
      let detectedStatus = httpStatus ?? info.statusCode ?? (info.res && info.res.statusCode);

      // Check within splat metadata (common pattern logger.info(msg, { req, res }))
      if (detectedStatus === undefined) {
        const splatMeta = info[Symbol.for('splat')];
        if (Array.isArray(splatMeta)) {
          for (const item of splatMeta) {
            if (item && typeof item === 'object' && item.res && typeof item.res.statusCode === 'number') {
              detectedStatus = item.res.statusCode;
              if (!info.req && item.req) info.req = item.req;
              break;
            }
          }
        }
      }

      // Abbreviate common successful HTTP 200 responses unless explicitly overridden
      if (detectedStatus === 200 && !alwaysLogFull) {
        // Try to include minimal contextual information if available
        const method = info.method || (info.req && info.req.method) || '';
        const url = info.url || (info.req && info.req.url) || '';
        return `${timestamp} [${level.toUpperCase()}] [${module}]: HTTP 200 ${method} ${url}`.trim();
      }

      // Fallback: if message already contains status 200 pattern (e.g., "GET /foo - 200")
      if (!alwaysLogFull && typeof message === 'string' && /\s-\s200$/.test(message)) {
        return `${timestamp} [${level.toUpperCase()}] [${module}]: ${message}`;
      }

      let log = `${timestamp} [${level.toUpperCase()}] [${module}]: ${message}`;

      const splat = info[Symbol.for('splat')];
      if (splat && splat.length > 0) {
          const formattedSplat = util.inspect(splat.length === 1 ? splat[0] : splat, { depth: 10, colors: false });
          log += `\n${formattedSplat}`;
      }

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
  
  registry.set(module, logger);
  return logger;
}

module.exports = {
  createLogger,
  getRegistry,
  setLevel,
}; 