/**
 * Analytics Events Repository
 * 
 * Provides database access for analytics events.
 * Uses the MongoDB abstraction layer for database independence.
 */

const { getRepository } = require('../../core/shared/mongo');

// Define the event types
const EVENT_TYPES = {
  COMMAND: 'command',
  QUEUE: 'queue',
  GENERATION: 'generation',
  DELIVERY: 'delivery',
  ERROR: 'error',
  MENU_INTERACTION: 'menu_interaction',
  USER_JOIN: 'user_join',
  USER_LEAVE: 'user_leave',
  GATEKEEPING: 'gatekeeping',
  ASSET_CHECK: 'asset_check',
  ACCOUNT_ACTION: 'account_action',
  VERIFICATION: 'verification',
  WORKFLOW: 'workflow'
};

// Define schema for analytics events
const ANALYTICS_SCHEMA = {
  type: { type: String, required: true, enum: Object.values(EVENT_TYPES) },
  userId: { type: Number, required: true },
  username: { type: String, default: 'unknown' },
  timestamp: { type: Date, default: Date.now },
  data: { type: Object, default: {} },
  groupId: { type: Number, sparse: true },
  runId: { type: String, sparse: true },
  messageId: { type: String, sparse: true }
};

/**
 * Analytics Events Repository
 * Manages analytics events storage using the database abstraction layer
 */
class AnalyticsEventsRepository {
  /**
   * Create an instance of the analytics events repository
   */
  constructor() {
    this.repository = getRepository('analytics_events');
    this.collectionName = 'analytics_events';
  }

  /**
   * Find analytics events
   * @param {Object} query - Query to find events
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of analytics events
   */
  async findMany(query = {}, options = {}) {
    return this.repository.find(query, options);
  }

  /**
   * Find a single analytics event
   * @param {Object} query - Query to find event
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Found event or null
   */
  async findOne(query = {}, options = {}) {
    return this.repository.findOne(query, options);
  }

  /**
   * Create a new analytics event
   * @param {Object} data - Event data to save
   * @returns {Promise<Object>} Created document with _id
   */
  async create(data) {
    return this.repository.create(data);
  }

  /**
   * Update an analytics event
   * @param {Object} query - Query to find document to update
   * @param {Object} data - Data to update
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Update result
   */
  async updateOne(query, data, options = {}) {
    return this.repository.updateOne(query, data, options);
  }

  /**
   * Get analytics events with cursor-style API for backward compatibility
   * @param {Object} query - Query to find events
   * @returns {Object} Legacy-compatible cursor interface
   */
  find(query = {}) {
    // Provide a legacy-compatible interface for backward compatibility
    return {
      sort: (sortOptions) => ({
        limit: (limit) => ({
          toArray: async () => {
            const options = {
              sort: sortOptions,
              limit
            };
            return this.repository.find(query, options);
          }
        })
      })
    };
  }

  /**
   * Find events by run ID
   * @param {string} runId - Run ID to find events for
   * @returns {Promise<Array>} Array of events
   */
  async findByRunId(runId) {
    return this.findMany({ runId });
  }

  /**
   * Find events by user ID
   * @param {number|string} userId - User ID to find events for
   * @returns {Promise<Array>} Array of events
   */
  async findByUserId(userId) {
    return this.findMany({ userId });
  }

  /**
   * Find events by group ID
   * @param {number|string} groupId - Group ID to find events for
   * @returns {Promise<Array>} Array of events
   */
  async findByGroupId(groupId) {
    return this.findMany({ groupId });
  }

  /**
   * Find events by type
   * @param {string} type - Event type from EVENT_TYPES
   * @returns {Promise<Array>} Array of events
   */
  async findByType(type) {
    if (!Object.values(EVENT_TYPES).includes(type)) {
      throw new Error(`Invalid event type: ${type}`);
    }
    return this.findMany({ type });
  }
  
  /**
   * Get operation statistics
   * @returns {Object} Repository statistics
   */
  getStats() {
    return this.repository.getStats();
  }
}

// Create default singleton instance for common use
const analyticsEventsRepository = new AnalyticsEventsRepository();

module.exports = {
  EVENT_TYPES,
  ANALYTICS_SCHEMA,
  AnalyticsEventsRepository,
  // For backward compatibility
  analyticsEvents: analyticsEventsRepository
}; 