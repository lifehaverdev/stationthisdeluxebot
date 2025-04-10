/**
 * Application Logger
 * 
 * A simple logging utility for consistent logging throughout the application.
 * Eventually this could be replaced with a more robust logging solution.
 */

/**
 * Logger class for application-wide logging
 */
class Logger {
  /**
   * Create a new logger
   * @param {Object} options - Logger options
   * @param {string} options.level - Log level (debug, info, warn, error)
   * @param {string} options.name - Logger name for prefixing logs
   */
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.name = options.name || 'app';
    
    // Log level priorities
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
  }
  
  /**
   * Format a log message
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} [data] - Additional data to log
   * @returns {string} Formatted log message
   * @private
   */
  _format(level, message, data) {
    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${level.toUpperCase()}] [${this.name}] ${message}`;
    
    if (data) {
      if (data instanceof Error) {
        formatted += `\n  ${data.stack || data.message}`;
      } else if (typeof data === 'object') {
        try {
          // Try to stringify the object, but handle circular references
          const serialized = JSON.stringify(data, (key, value) => {
            if (key === 'error' && value instanceof Error) {
              return {
                message: value.message,
                stack: value.stack
              };
            }
            return value;
          }, 2);
          formatted += `\n  ${serialized}`;
        } catch (err) {
          formatted += '\n  [Object cannot be stringified]';
        }
      } else {
        formatted += `\n  ${data}`;
      }
    }
    
    return formatted;
  }
  
  /**
   * Check if a log level should be logged
   * @param {string} level - Log level to check
   * @returns {boolean} Whether the level should be logged
   * @private
   */
  _shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  }
  
  /**
   * Log a debug message
   * @param {string} message - Message to log
   * @param {Object} [data] - Additional data to log
   */
  debug(message, data) {
    if (this._shouldLog('debug')) {
      console.debug(this._format('debug', message, data));
    }
  }
  
  /**
   * Log an info message
   * @param {string} message - Message to log
   * @param {Object} [data] - Additional data to log
   */
  info(message, data) {
    if (this._shouldLog('info')) {
      console.info(this._format('info', message, data));
    }
  }
  
  /**
   * Log a warning message
   * @param {string} message - Message to log
   * @param {Object} [data] - Additional data to log
   */
  warn(message, data) {
    if (this._shouldLog('warn')) {
      console.warn(this._format('warn', message, data));
    }
  }
  
  /**
   * Log an error message
   * @param {string} message - Message to log
   * @param {Object} [data] - Additional data to log
   */
  error(message, data) {
    if (this._shouldLog('error')) {
      console.error(this._format('error', message, data));
    }
  }
}

module.exports = {
  Logger
}; 