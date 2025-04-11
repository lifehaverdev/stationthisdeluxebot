/**
 * Analytics Module
 * 
 * Provides a unified interface for tracking user activities and events.
 * Centralizes event tracking, session monitoring, and analytics reporting.
 */

const { AnalyticsEventsAdapter, createAnalyticsEventsAdapter, EVENT_TYPES } = require('./analyticsEventsAdapter');
const { AnalyticsService, createAnalyticsService } = require('./analyticsService');
const { EVENT_TYPES: OriginalEventTypes } = require('../../db/models/analyticsEventsRepository');

// Combine and re-export event types from both sources
const COMBINED_EVENT_TYPES = {
  ...EVENT_TYPES,
  ...OriginalEventTypes
};

/**
 * Create a default analytics manager instance
 * @param {Object} options - Configuration options
 * @returns {AnalyticsService} - Configured analytics service
 */
function createDefaultAnalytics(options = {}) {
  const adapter = createAnalyticsEventsAdapter(options);
  return createAnalyticsService({ adapter, ...options });
}

// Create a singleton instance for common use
let defaultAnalytics = null;

/**
 * Get the default analytics instance
 * @param {Object} options - Configuration options (only used on first call)
 * @returns {AnalyticsService} - Configured analytics service
 */
function getDefaultAnalytics(options = {}) {
  if (!defaultAnalytics) {
    defaultAnalytics = createDefaultAnalytics(options);
  }
  return defaultAnalytics;
}

module.exports = {
  AnalyticsEventsAdapter,
  AnalyticsService,
  createAnalyticsEventsAdapter,
  createAnalyticsService,
  createDefaultAnalytics,
  getDefaultAnalytics,
  EVENT_TYPES: COMBINED_EVENT_TYPES
}; 