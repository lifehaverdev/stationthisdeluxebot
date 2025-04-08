/**
 * Analytics Module
 * 
 * Provides access to analytics tracking with support for both:
 * 1. Original implementation (saving to DB)
 * 2. Adapter implementation (using SessionAdapter and logging only)
 */

const { AnalyticsEvents, EVENT_TYPES: OriginalEventTypes } = require('../../db/models/analyticsEvents');
const { AnalyticsEventsAdapter, createAnalyticsEventsAdapter, EVENT_TYPES: AdapterEventTypes } = require('./analyticsEventsAdapter');
const { createSessionAdapter } = require('../session/adapter');

// Confirm event types are the same
const EVENT_TYPES = OriginalEventTypes;

// Default to original implementation
let currentImplementation = 'original';
let sessionAdapter = null;
let analyticsInstance = null;

/**
 * Get the analytics instance (original or adapter)
 * @returns {Object} - Analytics instance (either original or adapter)
 */
function getAnalyticsInstance() {
  if (analyticsInstance) {
    return analyticsInstance;
  }

  if (currentImplementation === 'adapter') {
    // Lazy-load session adapter if not provided
    if (!sessionAdapter) {
      sessionAdapter = createSessionAdapter();
    }
    analyticsInstance = createAnalyticsEventsAdapter({ sessionAdapter });
  } else {
    analyticsInstance = new AnalyticsEvents();
  }

  return analyticsInstance;
}

/**
 * Use the original implementation (saving to DB)
 */
function useOriginalImplementation() {
  currentImplementation = 'original';
  analyticsInstance = null; // Reset instance so it will be recreated on next access
  console.log('[Analytics] Using original implementation (saving to DB)');
}

/**
 * Use the adapter implementation (logging only)
 * @param {Object} options - Configuration options
 * @param {Object} [options.sessionAdapter] - Session adapter instance
 * @param {boolean} [options.logToConsole=true] - Whether to log to console
 * @param {Function} [options.logFunction] - Custom logging function
 */
function useAdapterImplementation(options = {}) {
  currentImplementation = 'adapter';
  sessionAdapter = options.sessionAdapter;
  analyticsInstance = null; // Reset instance so it will be recreated on next access
  console.log('[Analytics] Using adapter implementation (logging only)');
}

// Export a proxy to the current analytics instance
const analyticsProxy = new Proxy({}, {
  get(target, prop) {
    // Forward all property accesses to the current instance
    const instance = getAnalyticsInstance();
    return instance[prop];
  }
});

module.exports = {
  analytics: analyticsProxy,
  useOriginalImplementation,
  useAdapterImplementation,
  EVENT_TYPES,
  // Export classes for direct usage
  AnalyticsEvents,
  AnalyticsEventsAdapter,
  createAnalyticsEventsAdapter
}; 