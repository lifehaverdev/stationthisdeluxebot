/**
 * AnalyticsService - Provides functionality for tracking system usage metrics
 * 
 * This service tracks various metrics like workflow usage, command execution,
 * and user activity to provide insights into system usage patterns.
 */

const { AppError } = require('../../core/shared/errors/AppError');

class AnalyticsService {
  /**
   * Create a new AnalyticsService instance
   * 
   * @param {Object} options Configuration options
   * @param {Object} options.database Database service instance (optional)
   * @param {Object} options.logger Logger instance
   */
  constructor({ database, logger }) {
    this.database = database;
    this.logger = logger;
    this.collection = 'analytics_events';
    this.isInitialized = false;
    this.cache = [];
    this.flushInterval = null;
  }

  /**
   * Initialize the analytics service
   * 
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing analytics service');
      
      // Set up periodic cache flushing
      if (this.database) {
        this.flushInterval = setInterval(() => this.flushCache(), 60000); // Flush every minute
      } else {
        this.logger.warn('Analytics service initialized without database, events will be logged but not stored');
      }
      
      this.isInitialized = true;
      this.logger.info('Analytics service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize analytics service', { error });
      throw new AppError('Failed to initialize analytics service', 'SERVICE_ERROR', error);
    }
  }

  /**
   * Track an event
   * 
   * @param {string} eventType Type of event (e.g., 'workflow_execution', 'command_execution')
   * @param {Object} data Event data
   * @returns {Promise<void>}
   */
  async trackEvent(eventType, data = {}) {
    if (!this.isInitialized) {
      this.logger.warn('Analytics service not initialized, event not tracked', { eventType });
      return;
    }
    
    const event = {
      eventType,
      timestamp: new Date(),
      data
    };
    
    this.logger.debug('Tracking event', { eventType });
    this.cache.push(event);
    
    // If cache gets too large, flush it
    if (this.cache.length >= 100) {
      this.flushCache();
    }
  }

  /**
   * Flush the event cache to the database
   * 
   * @returns {Promise<void>}
   */
  async flushCache() {
    if (!this.database || this.cache.length === 0) {
      return;
    }
    
    try {
      const eventsToFlush = [...this.cache];
      this.cache = [];
      
      this.logger.debug(`Flushing ${eventsToFlush.length} events to database`);
      
      // Insert events in batch if supported, otherwise one by one
      if (this.database.insertMany) {
        await this.database.insertMany(this.collection, eventsToFlush);
      } else {
        for (const event of eventsToFlush) {
          await this.database.insertOne(this.collection, event);
        }
      }
    } catch (error) {
      this.logger.error('Failed to flush analytics events', { error });
      // Re-add events to cache to try again later
      this.cache = [...this.cache, ...eventsToFlush];
    }
  }

  /**
   * Track workflow execution
   * 
   * @param {string} workflowName Name of the workflow
   * @param {string} userId User ID
   * @param {Object} metadata Additional metadata
   * @returns {Promise<void>}
   */
  async trackWorkflowExecution(workflowName, userId, metadata = {}) {
    await this.trackEvent('workflow_execution', {
      workflowName,
      userId,
      ...metadata
    });
  }

  /**
   * Track command execution
   * 
   * @param {string} commandName Name of the command
   * @param {string} userId User ID
   * @param {Object} metadata Additional metadata
   * @returns {Promise<void>}
   */
  async trackCommandExecution(commandName, userId, metadata = {}) {
    await this.trackEvent('command_execution', {
      commandName,
      userId,
      ...metadata
    });
  }

  /**
   * Track user activity
   * 
   * @param {string} userId User ID
   * @param {string} activityType Type of activity
   * @param {Object} metadata Additional metadata
   * @returns {Promise<void>}
   */
  async trackUserActivity(userId, activityType, metadata = {}) {
    await this.trackEvent('user_activity', {
      userId,
      activityType,
      ...metadata
    });
  }

  /**
   * Get recent events
   * 
   * @param {Object} options Query options
   * @param {string} options.eventType Type of event
   * @param {number} options.limit Maximum number of events to retrieve
   * @returns {Promise<Array>} Array of events
   */
  async getRecentEvents({ eventType, limit = 100 } = {}) {
    if (!this.database) {
      throw new AppError('Database not available for analytics queries', 'SERVICE_ERROR');
    }
    
    try {
      const query = eventType ? { eventType } : {};
      
      return await this.database.findMany(
        this.collection,
        query,
        { limit, sort: { timestamp: -1 } }
      );
    } catch (error) {
      this.logger.error('Failed to get recent events', { error });
      throw new AppError('Failed to get recent events', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Clean up resources when shutting down
   */
  async shutdown() {
    try {
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
      }
      
      await this.flushCache();
      this.logger.info('Analytics service shut down');
    } catch (error) {
      this.logger.error('Error during analytics service shutdown', { error });
    }
  }
}

module.exports = { AnalyticsService }; 