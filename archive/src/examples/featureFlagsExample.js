const { createSessionAdapter } = require('../adapters/sessionAdapter');
const { createSessionManager } = require('../services/sessionManager');

/**
 * FeatureFlagsManager class that uses SessionAdapter to manage and check
 * feature flags for users based on various conditions
 */
class FeatureFlagsManager {
  constructor(options) {
    this.sessionAdapter = options.sessionAdapter;
    this.globalFlags = new Map();
    this.rolloutRules = new Map();
    
    // Register default feature flags with global state
    this.registerFeature('dark_mode', { enabled: true });
    this.registerFeature('advanced_analytics', { enabled: false });
    this.registerFeature('new_editor', { enabled: true, rolloutPercentage: 50 });
    this.registerFeature('beta_features', { enabled: false });
    this.registerFeature('experimental_chat', { enabled: true, rolloutPercentage: 25 });
  }

  /**
   * Register a feature flag with its global configuration
   * @param {string} featureKey - Feature key
   * @param {object} config - Feature configuration
   */
  registerFeature(featureKey, config) {
    this.globalFlags.set(featureKey, {
      enabled: config.enabled ?? false,
      rolloutPercentage: config.rolloutPercentage ?? 100,
      description: config.description || '',
      defaultValue: config.defaultValue ?? config.enabled ?? false,
    });
  }

  /**
   * Register a rule for determining if a feature should be enabled for a user
   * @param {string} featureKey - Feature key
   * @param {Function} ruleFn - Function that takes user data and returns boolean
   */
  registerRule(featureKey, ruleFn) {
    if (!this.globalFlags.has(featureKey)) {
      throw new Error(`Cannot register rule for unknown feature: ${featureKey}`);
    }
    
    if (!this.rolloutRules.has(featureKey)) {
      this.rolloutRules.set(featureKey, []);
    }
    
    this.rolloutRules.get(featureKey).push(ruleFn);
  }

  /**
   * Check if a feature is enabled for a specific user
   * @param {string} userId - User ID
   * @param {string} featureKey - Feature key
   * @returns {Promise<boolean>} Whether the feature is enabled
   */
  async isFeatureEnabled(userId, featureKey) {
    try {
      // Check if feature exists
      if (!this.globalFlags.has(featureKey)) {
        console.warn(`Checking unknown feature flag: ${featureKey}`);
        return false;
      }
      
      const featureConfig = this.globalFlags.get(featureKey);
      
      // If feature is globally disabled, return false
      if (!featureConfig.enabled) {
        return false;
      }
      
      // Get user session data
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      if (!userSession) {
        // For users without a session, use percentage-based rollout
        return this._isInRolloutPercentage(userId, featureConfig.rolloutPercentage);
      }
      
      // Check for user-specific feature overrides
      if (userSession.featureFlags && userSession.featureFlags[featureKey] !== undefined) {
        return userSession.featureFlags[featureKey];
      }
      
      // Apply any custom rules
      if (this.rolloutRules.has(featureKey)) {
        for (const rule of this.rolloutRules.get(featureKey)) {
          // If any rule explicitly returns true or false (not undefined),
          // use that value
          const ruleResult = rule(userSession);
          if (ruleResult === true || ruleResult === false) {
            
            // Track rule application in analytics
            this._trackRuleApplication(userId, featureKey, ruleResult);
            
            return ruleResult;
          }
        }
      }
      
      // Fall back to percentage-based rollout
      return this._isInRolloutPercentage(userId, featureConfig.rolloutPercentage);
    } catch (error) {
      console.error(`Error checking feature flag ${featureKey}:`, error);
      
      // In case of error, use the default value for the feature
      const defaultValue = this.globalFlags.get(featureKey)?.defaultValue ?? false;
      return defaultValue;
    }
  }

  /**
   * Check if user is in rollout percentage based on user ID
   * @param {string} userId - User ID
   * @param {number} percentage - Rollout percentage (0-100)
   * @returns {boolean} Whether user is in the rollout group
   * @private
   */
  _isInRolloutPercentage(userId, percentage) {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    
    // Use a hash of the user ID to determine if they're in the percentage
    // This ensures the same user always gets the same result for a feature
    const hash = this._hashString(userId);
    const normalizedHash = hash % 100; // Get a value from 0-99
    
    return normalizedHash < percentage;
  }

  /**
   * Simple string hash function
   * @param {string} str - String to hash
   * @returns {number} Hash value
   * @private
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Track feature flag rule application for analytics
   * @param {string} userId - User ID
   * @param {string} featureKey - Feature key
   * @param {boolean} result - Result of rule application
   * @private
   */
  async _trackRuleApplication(userId, featureKey, result) {
    await this.sessionAdapter.updateUserActivity(userId, {
      action: 'feature_flag_evaluated',
      feature: featureKey,
      result,
      timestamp: new Date()
    });
  }

  /**
   * Get all available features and their status for a specific user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Map of feature keys to enabled status
   */
  async getAllFeatures(userId) {
    const result = {};
    const features = Array.from(this.globalFlags.keys());
    
    // Check each feature
    for (const featureKey of features) {
      result[featureKey] = await this.isFeatureEnabled(userId, featureKey);
    }
    
    return result;
  }

  /**
   * Override a feature flag for a specific user
   * @param {string} userId - User ID
   * @param {string} featureKey - Feature key
   * @param {boolean} enabled - Whether the feature should be enabled
   * @returns {Promise<boolean>} Success
   */
  async overrideFeature(userId, featureKey, enabled) {
    try {
      if (!this.globalFlags.has(featureKey)) {
        throw new Error(`Cannot override unknown feature: ${featureKey}`);
      }
      
      // Get user session data
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      const updates = {
        featureFlags: {
          ...(userSession?.featureFlags || {}),
          [featureKey]: enabled
        }
      };
      
      // Create or update session
      if (!userSession) {
        await this.sessionAdapter.createUserSession(userId, updates);
      } else {
        await this.sessionAdapter.updateUserSession(userId, updates);
      }
      
      // Track override
      await this.sessionAdapter.updateUserActivity(userId, {
        action: 'feature_flag_override',
        feature: featureKey,
        enabled,
        timestamp: new Date()
      });
      
      return true;
    } catch (error) {
      console.error(`Error overriding feature flag ${featureKey}:`, error);
      return false;
    }
  }

  /**
   * Remove a user-specific feature override
   * @param {string} userId - User ID
   * @param {string} featureKey - Feature key
   * @returns {Promise<boolean>} Success
   */
  async removeOverride(userId, featureKey) {
    try {
      // Get user session data
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      if (!userSession || !userSession.featureFlags || 
          userSession.featureFlags[featureKey] === undefined) {
        // No override exists
        return true;
      }
      
      // Create new feature flags object without the specified key
      const { [featureKey]: removed, ...remainingFlags } = userSession.featureFlags;
      
      // Update session
      await this.sessionAdapter.updateUserSession(userId, {
        featureFlags: remainingFlags
      });
      
      // Track override removal
      await this.sessionAdapter.updateUserActivity(userId, {
        action: 'feature_flag_override_removed',
        feature: featureKey,
        timestamp: new Date()
      });
      
      return true;
    } catch (error) {
      console.error(`Error removing feature flag override ${featureKey}:`, error);
      return false;
    }
  }

  /**
   * Update global feature flag configuration
   * @param {string} featureKey - Feature key
   * @param {object} config - New configuration
   * @returns {boolean} Success
   */
  updateFeatureConfig(featureKey, config) {
    try {
      if (!this.globalFlags.has(featureKey)) {
        throw new Error(`Cannot update unknown feature: ${featureKey}`);
      }
      
      const currentConfig = this.globalFlags.get(featureKey);
      
      this.globalFlags.set(featureKey, {
        ...currentConfig,
        ...config
      });
      
      return true;
    } catch (error) {
      console.error(`Error updating feature config ${featureKey}:`, error);
      return false;
    }
  }
}

/**
 * Example demonstrating how to use the FeatureFlagsManager with SessionAdapter
 */
async function runFeatureFlagsExample() {
  try {
    // Initialize core services
    const sessionManager = createSessionManager({
      databaseUrl: process.env.DATABASE_URL
    });

    // Create the session adapter
    const sessionAdapter = createSessionAdapter({
      sessionManager
    });

    // Create feature flags manager
    const featureFlagsManager = new FeatureFlagsManager({
      sessionAdapter
    });
    
    // Register some custom rules
    
    // Premium users always get advanced analytics
    featureFlagsManager.registerRule('advanced_analytics', (userSession) => {
      return userSession.subscription?.tier === 'premium';
    });
    
    // Users who have used the app more than 5 times get the new editor
    featureFlagsManager.registerRule('new_editor', (userSession) => {
      return (userSession.usageStats?.loginCount || 0) > 5;
    });
    
    // Users who have opted into beta get access to beta features
    featureFlagsManager.registerRule('beta_features', (userSession) => {
      return userSession.preferences?.beta_opt_in === true;
    });
    
    // Register a new feature flag
    featureFlagsManager.registerFeature('ai_assistant', {
      enabled: true,
      rolloutPercentage: 30,
      description: 'AI-powered assistant for content creation'
    });
    
    // Users who are content creators get the AI assistant
    featureFlagsManager.registerRule('ai_assistant', (userSession) => {
      return userSession.userType === 'content_creator';
    });
    
    // Create test users with different profiles
    const newUser = 'new_user_123';
    const premiumUser = 'premium_user_456';
    const betaUser = 'beta_user_789';
    const contentCreator = 'creator_user_101';
    
    // Set up premium user profile
    await sessionAdapter.createUserSession(premiumUser, {
      subscription: {
        tier: 'premium',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      usageStats: {
        loginCount: 27,
        lastLoginAt: new Date()
      }
    });
    
    // Set up beta user profile
    await sessionAdapter.createUserSession(betaUser, {
      preferences: {
        beta_opt_in: true
      },
      usageStats: {
        loginCount: 12,
        lastLoginAt: new Date()
      }
    });
    
    // Set up content creator profile
    await sessionAdapter.createUserSession(contentCreator, {
      userType: 'content_creator',
      usageStats: {
        loginCount: 45,
        lastLoginAt: new Date()
      }
    });
    
    // Override a feature flag for a specific user
    await featureFlagsManager.overrideFeature(newUser, 'experimental_chat', true);
    
    // Check feature flags for different users
    console.log('\nFeature flags for new user:');
    const newUserFeatures = await featureFlagsManager.getAllFeatures(newUser);
    console.log(newUserFeatures);
    
    console.log('\nFeature flags for premium user:');
    const premiumUserFeatures = await featureFlagsManager.getAllFeatures(premiumUser);
    console.log(premiumUserFeatures);
    
    console.log('\nFeature flags for beta user:');
    const betaUserFeatures = await featureFlagsManager.getAllFeatures(betaUser);
    console.log(betaUserFeatures);
    
    console.log('\nFeature flags for content creator:');
    const creatorUserFeatures = await featureFlagsManager.getAllFeatures(contentCreator);
    console.log(creatorUserFeatures);
    
    // Remove a feature override
    await featureFlagsManager.removeOverride(newUser, 'experimental_chat');
    
    // Check if removal worked
    console.log('\nAfter removing override for new user:');
    const newUserFeaturesAfter = await featureFlagsManager.getAllFeatures(newUser);
    console.log(newUserFeaturesAfter);
    
    // Get session data to inspect feature flag activity
    const newUserSession = await sessionAdapter.getUserSessionData(newUser);
    console.log('\nNew user session data:');
    console.log(JSON.stringify(newUserSession, null, 2));

  } catch (error) {
    console.error('Error in feature flags example:', error);
  }
}

module.exports = { 
  runFeatureFlagsExample,
  FeatureFlagsManager 
}; 