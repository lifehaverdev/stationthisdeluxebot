/**
 * Analytics Events Model
 * 
 * Defines the schema and event types for analytics events.
 * Used by the analytics events adapter for tracking user actions.
 */

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
 * Mock implementation of the analytics events model
 * This is a placeholder for the actual MongoDB model
 */
class AnalyticsEvents {
  /**
   * Create an instance of the analytics events model
   */
  constructor() {
    this.collection = 'analytics_events';
    this.schema = ANALYTICS_SCHEMA;
  }

  /**
   * Mock implementation of updateOne
   * @param {Object} query - Query to find document
   * @param {Object} update - Update to apply
   * @param {Object} options - Options for update
   * @returns {Promise<Object>} - Result of update
   */
  async updateOne(query, update, options = {}) {
    console.log('AnalyticsEvents.updateOne called', { query, update, options });
    return {
      acknowledged: true,
      modifiedCount: 1,
      upsertedId: options.upsert ? 'mock-id-' + Date.now() : null,
      upsertedCount: options.upsert ? 1 : 0,
      matchedCount: 1
    };
  }

  /**
   * Mock implementation of findOne
   * @param {Object} query - Query to find document
   * @returns {Promise<Object>} - Result of find
   */
  async findOne(query) {
    console.log('AnalyticsEvents.findOne called', { query });
    return null;
  }

  /**
   * Mock implementation of find
   * @param {Object} query - Query to find documents
   * @returns {Object} - Find cursor
   */
  find(query) {
    console.log('AnalyticsEvents.find called', { query });
    return {
      sort: () => ({
        limit: () => ({
          toArray: async () => []
        })
      })
    };
  }
}

// Export the model and event types
module.exports = {
  EVENT_TYPES,
  ANALYTICS_SCHEMA,
  AnalyticsEvents: new AnalyticsEvents()
}; 