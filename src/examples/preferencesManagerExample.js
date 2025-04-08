const { createSessionAdapter } = require('../adapters/sessionAdapter');
const { createSessionManager } = require('../services/sessionManager');
const EventEmitter = require('events');

/**
 * PreferencesManager class that uses SessionAdapter to store and manage user preferences
 * with support for preferences validation, defaults, and change notifications
 */
class PreferencesManager extends EventEmitter {
  constructor(options) {
    super();
    this.sessionAdapter = options.sessionAdapter;
    this.schemas = new Map();
    this.defaults = new Map();
    
    // Register default preference schemas
    this.registerSchema('theme', {
      type: 'string',
      enum: ['light', 'dark', 'system'],
      default: 'system'
    });
    
    this.registerSchema('notifications', {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        sound: { type: 'boolean', default: true },
        email: { type: 'boolean', default: false },
        dailySummary: { type: 'boolean', default: false }
      }
    });
    
    this.registerSchema('language', {
      type: 'string',
      default: 'en'
    });
    
    this.registerSchema('fontSize', {
      type: 'number',
      minimum: 8,
      maximum: 32,
      default: 14
    });
  }

  /**
   * Register a preference schema
   * @param {string} key - Preference key
   * @param {object} schema - JSON Schema for validating the preference
   */
  registerSchema(key, schema) {
    this.schemas.set(key, schema);
    
    // Extract default value
    if ('default' in schema) {
      this.defaults.set(key, schema.default);
    } else if (schema.type === 'object' && schema.properties) {
      // For objects, collect defaults from properties
      const defaults = {};
      Object.entries(schema.properties).forEach(([propKey, propSchema]) => {
        if ('default' in propSchema) {
          defaults[propKey] = propSchema.default;
        }
      });
      
      if (Object.keys(defaults).length > 0) {
        this.defaults.set(key, defaults);
      }
    }
  }

  /**
   * Validate a preference value against its schema
   * @param {string} key - Preference key
   * @param {any} value - Preference value to validate
   * @returns {object} Result with { valid, errors }
   */
  validatePreference(key, value) {
    const schema = this.schemas.get(key);
    
    if (!schema) {
      return { valid: false, errors: [`Unknown preference: ${key}`] };
    }
    
    const errors = [];
    
    // Basic type validation
    if (schema.type && typeof value !== schema.type && 
        !(schema.type === 'number' && typeof value === 'number')) {
      errors.push(`Type mismatch: expected ${schema.type}, got ${typeof value}`);
    }
    
    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`Value must be one of: ${schema.enum.join(', ')}`);
    }
    
    // Number range validation
    if (schema.type === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`Value must be at least ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`Value must be at most ${schema.maximum}`);
      }
    }
    
    // Object property validation
    if (schema.type === 'object' && schema.properties && typeof value === 'object') {
      Object.entries(value).forEach(([propKey, propValue]) => {
        if (!schema.properties[propKey]) {
          errors.push(`Unknown property: ${propKey}`);
        } else {
          // Validate property type
          const propSchema = schema.properties[propKey];
          if (propSchema.type && typeof propValue !== propSchema.type) {
            errors.push(`Property ${propKey}: expected ${propSchema.type}, got ${typeof propValue}`);
          }
        }
      });
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Get all preferences for a user, with defaults applied
   * @param {string} userId - User ID
   * @returns {Promise<object>} User preferences
   */
  async getPreferences(userId) {
    try {
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      // Start with default preferences
      const preferences = {};
      this.defaults.forEach((defaultValue, key) => {
        preferences[key] = defaultValue;
      });
      
      // Apply user's saved preferences if they exist
      if (userSession && userSession.preferences) {
        Object.entries(userSession.preferences).forEach(([key, value]) => {
          preferences[key] = value;
        });
      }
      
      return preferences;
    } catch (error) {
      console.error('Error getting preferences:', error);
      // Return defaults on error
      const defaults = {};
      this.defaults.forEach((value, key) => {
        defaults[key] = value;
      });
      return defaults;
    }
  }

  /**
   * Get a specific preference for a user
   * @param {string} userId - User ID
   * @param {string} key - Preference key
   * @returns {Promise<any>} Preference value
   */
  async getPreference(userId, key) {
    if (!this.schemas.has(key)) {
      throw new Error(`Unknown preference: ${key}`);
    }
    
    const preferences = await this.getPreferences(userId);
    return preferences[key];
  }

  /**
   * Set a specific preference for a user
   * @param {string} userId - User ID
   * @param {string} key - Preference key
   * @param {any} value - Preference value
   * @returns {Promise<{success: boolean, errors: Array<string>}>}
   */
  async setPreference(userId, key, value) {
    try {
      // Validate preference
      const validation = this.validatePreference(key, value);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }
      
      // Get current user session
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      // Prepare updates
      const preferences = userSession?.preferences || {};
      const oldValue = preferences[key];
      const updates = {
        preferences: {
          ...preferences,
          [key]: value
        }
      };
      
      // Update session
      if (!userSession) {
        await this.sessionAdapter.createUserSession(userId, updates);
      } else {
        await this.sessionAdapter.updateUserSession(userId, updates);
      }
      
      // Track preference change
      await this.sessionAdapter.updateUserActivity(userId, {
        action: 'preference_changed',
        preference: key,
        oldValue,
        newValue: value,
        timestamp: new Date()
      });
      
      // Emit change event
      this.emit('preferenceChanged', {
        userId,
        key,
        oldValue,
        newValue: value
      });
      
      return { success: true };
    } catch (error) {
      console.error(`Error setting preference ${key}:`, error);
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Set multiple preferences at once
   * @param {string} userId - User ID
   * @param {object} preferencesObject - Object with preference key-value pairs
   * @returns {Promise<{success: boolean, errors: object}>}
   */
  async setPreferences(userId, preferencesObject) {
    const result = { success: true, errors: {} };
    
    // Validate all preferences first
    for (const [key, value] of Object.entries(preferencesObject)) {
      if (!this.schemas.has(key)) {
        result.success = false;
        result.errors[key] = [`Unknown preference: ${key}`];
        continue;
      }
      
      const validation = this.validatePreference(key, value);
      if (!validation.valid) {
        result.success = false;
        result.errors[key] = validation.errors;
      }
    }
    
    // If any validation failed, return errors
    if (!result.success) {
      return result;
    }
    
    // Apply all preferences
    try {
      // Get current user session
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      const currentPrefs = userSession?.preferences || {};
      
      // Update session
      const updates = {
        preferences: {
          ...currentPrefs,
          ...preferencesObject
        }
      };
      
      if (!userSession) {
        await this.sessionAdapter.createUserSession(userId, updates);
      } else {
        await this.sessionAdapter.updateUserSession(userId, updates);
      }
      
      // Track batch preference change
      await this.sessionAdapter.updateUserActivity(userId, {
        action: 'preferences_batch_updated',
        changes: Object.keys(preferencesObject),
        timestamp: new Date()
      });
      
      // Emit change events
      for (const [key, newValue] of Object.entries(preferencesObject)) {
        const oldValue = currentPrefs[key];
        this.emit('preferenceChanged', {
          userId,
          key,
          oldValue,
          newValue
        });
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error setting multiple preferences:', error);
      return { success: false, errors: { _general: [error.message] } };
    }
  }

  /**
   * Reset a preference to its default value
   * @param {string} userId - User ID
   * @param {string} key - Preference key
   * @returns {Promise<{success: boolean, error: string}>}
   */
  async resetPreference(userId, key) {
    if (!this.schemas.has(key)) {
      return { success: false, error: `Unknown preference: ${key}` };
    }
    
    if (!this.defaults.has(key)) {
      return { success: false, error: `No default value for preference: ${key}` };
    }
    
    const defaultValue = this.defaults.get(key);
    return this.setPreference(userId, key, defaultValue);
  }

  /**
   * Reset all preferences to their default values
   * @param {string} userId - User ID
   * @returns {Promise<{success: boolean, error: string}>}
   */
  async resetAllPreferences(userId) {
    try {
      const defaults = {};
      this.defaults.forEach((value, key) => {
        defaults[key] = value;
      });
      
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      if (!userSession) {
        await this.sessionAdapter.createUserSession(userId, { preferences: defaults });
      } else {
        await this.sessionAdapter.updateUserSession(userId, { preferences: defaults });
      }
      
      // Track reset action
      await this.sessionAdapter.updateUserActivity(userId, {
        action: 'preferences_reset',
        timestamp: new Date()
      });
      
      // Emit reset event
      this.emit('preferencesReset', { userId });
      
      return { success: true };
    } catch (error) {
      console.error('Error resetting preferences:', error);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Example demonstrating how to use the PreferencesManager with SessionAdapter
 */
async function runPreferencesManagerExample() {
  try {
    // Initialize core services
    const sessionManager = createSessionManager({
      databaseUrl: process.env.DATABASE_URL
    });

    // Create the session adapter
    const sessionAdapter = createSessionAdapter({
      sessionManager
    });

    // Create preferences manager
    const preferencesManager = new PreferencesManager({
      sessionAdapter
    });
    
    // Listen for preference changes
    preferencesManager.on('preferenceChanged', (data) => {
      console.log(`Preference changed: ${data.key} = ${data.newValue} (was: ${data.oldValue})`);
    });
    
    // Register a custom preference schema
    preferencesManager.registerSchema('chatSettings', {
      type: 'object',
      properties: {
        autoReply: { type: 'boolean', default: false },
        showTypingIndicator: { type: 'boolean', default: true },
        messageHistory: { 
          type: 'number', 
          minimum: 10,
          maximum: 1000,
          default: 50
        }
      }
    });
    
    const userId = 'user456';
    
    // Get default preferences (first user interaction)
    console.log('\nDefault preferences:');
    const defaults = await preferencesManager.getPreferences(userId);
    console.log(defaults);
    
    // Set some preferences
    console.log('\nSetting preferences:');
    const themeResult = await preferencesManager.setPreference(userId, 'theme', 'dark');
    console.log('Set theme result:', themeResult);
    
    const fontResult = await preferencesManager.setPreference(userId, 'fontSize', 18);
    console.log('Set fontSize result:', fontResult);
    
    // Try setting an invalid preference
    const invalidResult = await preferencesManager.setPreference(userId, 'fontSize', 50);
    console.log('Set invalid fontSize result:', invalidResult);
    
    // Set multiple preferences at once
    console.log('\nSetting multiple preferences:');
    const batchResult = await preferencesManager.setPreferences(userId, {
      'notifications': {
        enabled: true,
        sound: false,
        email: true,
        dailySummary: true
      },
      'language': 'es'
    });
    console.log('Batch update result:', batchResult);
    
    // Get updated preferences
    console.log('\nUpdated preferences:');
    const updatedPrefs = await preferencesManager.getPreferences(userId);
    console.log(updatedPrefs);
    
    // Get a specific preference
    const theme = await preferencesManager.getPreference(userId, 'theme');
    console.log('\nCurrent theme:', theme);
    
    // Reset a specific preference
    console.log('\nResetting theme preference:');
    await preferencesManager.resetPreference(userId, 'theme');
    const resetTheme = await preferencesManager.getPreference(userId, 'theme');
    console.log('Theme after reset:', resetTheme);
    
    // Get session data to see all the preference-related activity
    const userSession = await sessionAdapter.getUserSessionData(userId);
    console.log('\nUser session data:');
    console.log(JSON.stringify(userSession, null, 2));

  } catch (error) {
    console.error('Error in preferences manager example:', error);
  }
}

module.exports = { 
  runPreferencesManagerExample,
  PreferencesManager 
}; 