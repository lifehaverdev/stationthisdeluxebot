/**
 * General utility helper functions
 * 
 * Platform-agnostic helper functions for common operations
 */

/**
 * Converts seconds into a human-readable time format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function convertTime(seconds) {
  // Return early for invalid inputs
  if (isNaN(seconds) || seconds < 0) {
    return '0s';
  }

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = Math.floor(seconds % 60);

  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0 || result === '') result += `${seconds}s`;

  return result.trim();
}

/**
 * Creates a unique ID
 * @returns {string} A unique ID string
 */
function generateId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Safely parse JSON without throwing
 * @param {string} str - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed object or default value
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Safely stringify an object without throwing
 * @param {*} obj - Object to stringify
 * @param {string} defaultValue - Default value if stringification fails
 * @returns {string} JSON string or default value
 */
function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    return defaultValue;
  }
}

module.exports = {
  convertTime,
  generateId,
  safeJsonParse,
  safeJsonStringify
}; 