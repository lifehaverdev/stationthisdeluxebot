/**
 * Internal Status API
 * 
 * Provides internal API for application status information
 * Used by both external API endpoints and platform-specific status commands
 */

/**
 * Calculate uptime duration in a human-readable format
 * @param {Date} startTime - The start time of the application
 * @returns {string} Formatted uptime string
 */
function getFormattedUptime(startTime) {
  const now = new Date();
  const uptime = now - startTime;
  
  const seconds = Math.floor(uptime / 1000) % 60;
  const minutes = Math.floor(uptime / (1000 * 60)) % 60;
  const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24;
  const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
  
  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  
  return parts.join(', ');
}

/**
 * Create status service
 * @param {Object} dependencies - Injected dependencies
 * @returns {Object} - Status service methods
 */
function createStatusService(dependencies = {}) {
  const { 
    appStartTime = new Date(),
    logger = console,
    version = process.env.APP_VERSION || '1.0.0'
  } = dependencies;
  
  /**
   * Get application status information
   * @returns {Object} Status information object
   */
  function getStatus() {
    try {
      const uptime = getFormattedUptime(appStartTime);
      const startTimeStr = appStartTime.toISOString();
      const uptimeMs = Date.now() - appStartTime.getTime();
      
      return {
        status: 'ok',
        uptime: {
          formatted: uptime,
          ms: uptimeMs
        },
        startTime: startTimeStr,
        version
      };
    } catch (error) {
      logger.error('Error getting status information:', error);
      return {
        status: 'error',
        error: 'Failed to retrieve status information'
      };
    }
  }
  
  return {
    getStatus
  };
}

module.exports = createStatusService; 