/**
 * UICacheService - Provides caching for UI-related data
 * 
 * This service caches frequently accessed UI elements like featured workflows,
 * public model configurations, and sidebar tools to improve performance.
 */

const { AppError } = require('../../core/shared/errors/AppError');

class UICacheService {
  /**
   * Create a new UICacheService instance
   * 
   * @param {Object} options Configuration options
   * @param {Object} options.logger Logger instance
   * @param {number} options.ttl Time-to-live in seconds for cache entries (default: 3600)
   */
  constructor({ logger, ttl = 3600 }) {
    this.logger = logger;
    this.ttl = ttl * 1000; // Convert to milliseconds
    this.cache = new Map();
    this.timestamps = new Map();
    this.isInitialized = false;
    this.cleanupInterval = null;
  }

  /**
   * Initialize the UI cache service
   * 
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing UI cache service');
      
      // Set up periodic cache cleanup
      this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // Clean up every 5 minutes
      
      this.isInitialized = true;
      this.logger.info('UI cache service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize UI cache service', { error });
      throw new AppError('Failed to initialize UI cache service', 'SERVICE_ERROR', error);
    }
  }

  /**
   * Set a cache entry
   * 
   * @param {string} key Cache key
   * @param {*} value Cache value
   * @param {number} ttl Time-to-live in seconds (optional, defaults to constructor value)
   * @returns {void}
   */
  set(key, value, ttl) {
    if (!this.isInitialized) {
      this.logger.warn('UI cache service not initialized, entry not cached', { key });
      return;
    }
    
    const actualTtl = ttl ? ttl * 1000 : this.ttl;
    const timestamp = Date.now() + actualTtl;
    
    this.cache.set(key, value);
    this.timestamps.set(key, timestamp);
    
    this.logger.debug(`Cache entry set: ${key}`);
  }

  /**
   * Get a cache entry
   * 
   * @param {string} key Cache key
   * @returns {*} Cache value or undefined if not found
   */
  get(key) {
    if (!this.isInitialized) {
      this.logger.warn('UI cache service not initialized, cache miss', { key });
      return undefined;
    }
    
    if (!this.cache.has(key)) {
      this.logger.debug(`Cache miss: ${key}`);
      return undefined;
    }
    
    const timestamp = this.timestamps.get(key);
    if (timestamp && timestamp < Date.now()) {
      // Entry has expired
      this.cache.delete(key);
      this.timestamps.delete(key);
      this.logger.debug(`Cache entry expired: ${key}`);
      return undefined;
    }
    
    this.logger.debug(`Cache hit: ${key}`);
    return this.cache.get(key);
  }

  /**
   * Delete a cache entry
   * 
   * @param {string} key Cache key
   * @returns {boolean} True if entry was deleted, false otherwise
   */
  delete(key) {
    if (!this.isInitialized) {
      return false;
    }
    
    this.logger.debug(`Deleting cache entry: ${key}`);
    this.timestamps.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Clear the entire cache
   * 
   * @returns {void}
   */
  clear() {
    if (!this.isInitialized) {
      return;
    }
    
    this.logger.debug('Clearing entire cache');
    this.cache.clear();
    this.timestamps.clear();
  }

  /**
   * Clean up expired cache entries
   * 
   * @returns {void}
   */
  cleanup() {
    if (!this.isInitialized) {
      return;
    }
    
    this.logger.debug('Cleaning up expired cache entries');
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [key, timestamp] of this.timestamps.entries()) {
      if (timestamp < now) {
        this.cache.delete(key);
        this.timestamps.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.logger.debug(`Removed ${expiredCount} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   * 
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      initialized: this.isInitialized,
      ttl: this.ttl / 1000, // Convert back to seconds
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Clean up resources when shutting down
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cache.clear();
    this.timestamps.clear();
    this.isInitialized = false;
    this.logger.info('UI cache service shut down');
  }
}

module.exports = { UICacheService }; 