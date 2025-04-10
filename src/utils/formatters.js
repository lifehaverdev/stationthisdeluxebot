/**
 * Formatters Utility
 * 
 * Contains utility functions for formatting different types of data
 * such as timestamps, numbers, and text.
 */

/**
 * Format a timestamp to a human-readable relative time string
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted relative time string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Never';
  
  const now = Date.now();
  const secondsAgo = Math.floor((now - timestamp) / 1000);
  
  if (secondsAgo < 5) {
    return 'Just now';
  } else if (secondsAgo < 60) {
    return `${secondsAgo} seconds ago`;
  } else if (secondsAgo < 3600) {
    const minutes = Math.floor(secondsAgo / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (secondsAgo < 86400) {
    const hours = Math.floor(secondsAgo / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (secondsAgo < 2592000) {
    const days = Math.floor(secondsAgo / 86400);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else if (secondsAgo < 31536000) {
    const months = Math.floor(secondsAgo / 2592000);
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  } else {
    const years = Math.floor(secondsAgo / 31536000);
    return `${years} year${years !== 1 ? 's' : ''} ago`;
  }
}

/**
 * Format a number with commas as thousands separators
 * @param {number} number - The number to format
 * @returns {string} Formatted number string
 */
function formatNumber(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a currency value
 * @param {number} amount - The amount to format
 * @param {string} [currency='USD'] - Currency code
 * @param {string} [locale='en-US'] - Locale for formatting
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(amount);
}

/**
 * Format a percentage
 * @param {number} value - The decimal value to format as percentage
 * @param {number} [digits=1] - Number of decimal digits to include
 * @returns {string} Formatted percentage string
 */
function formatPercentage(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Format a file size in bytes to a human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted file size string
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Truncate text to a specified length with ellipsis
 * @param {string} text - The text to truncate
 * @param {number} [length=100] - Maximum length before truncation
 * @returns {string} Truncated text
 */
function truncateText(text, length = 100) {
  if (!text || text.length <= length) return text;
  return text.substring(0, length - 3) + '...';
}

module.exports = {
  formatTimestamp,
  formatNumber,
  formatCurrency,
  formatPercentage,
  formatFileSize,
  truncateText
}; 