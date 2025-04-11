/**
 * Feature Flags Configuration
 * 
 * Controls which new architecture features are enabled.
 * This is used during the transition from legacy to new architecture.
 */

const environmentOverrides = process.env.FEATURE_FLAGS ? 
  JSON.parse(process.env.FEATURE_FLAGS) : {};

// Default feature flag settings
const featureFlags = {
  // Account-related features
  useNewAccountPoints: false,
  useNewAccountCommands: false,
  
  // Service-related features
  useServices: true,  // Make sure this is always true
  
  // Integration-related features
  useInternalAPI: true,
  
  // Additional features
  enableLogging: true,
  enableMetrics: false,
  
  // Override from environment
  ...environmentOverrides
};

/**
 * Check if a feature flag is enabled
 * @param {string} flag - The feature flag to check
 * @returns {boolean} Whether the feature is enabled
 */
function isEnabled(flag) {
  return featureFlags[flag] === true;
}

/**
 * Get the value of a feature flag
 * @param {string} flag - The feature flag to get
 * @returns {*} The feature flag value
 */
function get(flag) {
  return featureFlags[flag];
}

/**
 * Set a feature flag
 * @param {string} flag - The feature flag to set
 * @param {*} value - The value to set
 * @returns {void}
 */
function set(flag, value) {
  featureFlags[flag] = value;
}

/**
 * Get all feature flags
 * @returns {Object} All feature flags
 */
function getAllFlags() {
  return { ...featureFlags };
}

module.exports = {
  isEnabled,
  get,
  set,
  getAllFlags
}; 