/**
 * Feature flags management for controlling rollout of new components
 * 
 * This system allows gradual rollout of new features with easy rollback capability
 */

class FeatureFlags {
  constructor(initialFlags = {}) {
    this.flags = {
      // Default all flags to false
      useNewSessionManager: false,
      useNewErrorHandler: false,
      useNewCommandRouter: false,
      // Override with any provided initial values
      ...initialFlags
    };
  }

  /**
   * Check if a feature flag is enabled
   * @param {string} flagName - Name of the flag to check
   * @returns {boolean} - Whether the flag is enabled
   */
  isEnabled(flagName) {
    if (!this.flags.hasOwnProperty(flagName)) {
      console.warn(`Unknown feature flag checked: ${flagName}`);
      return false;
    }
    return this.flags[flagName];
  }

  /**
   * Enable a feature flag
   * @param {string} flagName - Name of the flag to enable
   */
  enable(flagName) {
    if (!this.flags.hasOwnProperty(flagName)) {
      console.warn(`Unknown feature flag enabled: ${flagName}`);
    }
    this.flags[flagName] = true;
    console.log(`Feature flag enabled: ${flagName}`);
  }

  /**
   * Disable a feature flag
   * @param {string} flagName - Name of the flag to disable
   */
  disable(flagName) {
    if (!this.flags.hasOwnProperty(flagName)) {
      console.warn(`Unknown feature flag disabled: ${flagName}`);
    }
    this.flags[flagName] = false;
    console.log(`Feature flag disabled: ${flagName}`);
  }

  /**
   * Get all feature flags and their status
   * @returns {Object} - All flags with their current values
   */
  getAllFlags() {
    return { ...this.flags };
  }
}

// Export a singleton instance with default settings
// Enable the session manager for our initial integration
const featureFlags = new FeatureFlags({
  useNewSessionManager: true
});

module.exports = featureFlags; 