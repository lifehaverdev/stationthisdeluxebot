/**
 * Settings Workflow
 * 
 * Platform-agnostic workflow for managing user generation settings.
 * Replaces the platform-specific settings functionality from the original codebase.
 */

/**
 * Default size limit for image generation
 * @type {number}
 */
const DEFAULT_SIZE_LIMIT = 2048;

/**
 * Default batch limit for image generation
 * @type {number}
 */
const DEFAULT_BATCH_LIMIT = 6;

/**
 * Default steps limit for image generation
 * @type {number}
 */
const DEFAULT_STEPS_LIMIT = 48;

/**
 * Settings workflow constructor
 * @param {Object} services - Services required by the workflow
 * @param {Object} services.session - Session service for storing user preferences
 * @param {Object} services.points - Points service for calculating limits based on balance
 * @param {Object} services.logger - Logger service for logging operations
 * @returns {Object} Settings workflow methods
 */
function createSettingsWorkflow(services = {}) {
  const { 
    session = {}, 
    points = {}, 
    logger = console 
  } = services;

  /**
   * Calculate the maximum size a user can set based on their balance
   * @param {string|number} userId - User ID
   * @returns {number} Maximum size allowed
   */
  const calculateMaxSize = (userId) => {
    const userSession = session.getSession(userId);
    const balance = userSession.balance || 0;
    
    let possibleSize = Math.floor(balance / 1000) + 1024;
    
    if (possibleSize > DEFAULT_SIZE_LIMIT) {
      possibleSize = DEFAULT_SIZE_LIMIT;
    }
    
    return possibleSize;
  };

  /**
   * Calculate the maximum batch size a user can set based on their balance
   * @param {string|number} userId - User ID
   * @returns {number} Maximum batch size allowed
   */
  const calculateMaxBatch = (userId) => {
    const userSession = session.getSession(userId);
    const balance = userSession.balance || 0;
    
    let possibleBatch = Math.floor(balance / 1000000) + 1;
    
    if (possibleBatch > DEFAULT_BATCH_LIMIT) {
      possibleBatch = DEFAULT_BATCH_LIMIT;
    }
    
    return possibleBatch;
  };

  /**
   * Calculate the maximum steps a user can set based on their balance
   * @param {string|number} userId - User ID
   * @returns {number} Maximum steps allowed
   */
  const calculateMaxSteps = (userId) => {
    const userSession = session.getSession(userId);
    const balance = userSession.balance || 0;
    
    let possibleSteps = Math.floor(balance / 1000000) + 30;
    
    if (possibleSteps > DEFAULT_STEPS_LIMIT) {
      possibleSteps = DEFAULT_STEPS_LIMIT;
    }
    
    return possibleSteps;
  };

  /**
   * Get all settings for a user
   * @param {string|number} userId - User ID
   * @returns {Object} All user settings
   */
  const getAllSettings = (userId) => {
    try {
      const userSession = session.getSession(userId);
      
      // Extract only the settings from the session
      const settings = {
        input_width: userSession.input_width || 1024,
        input_height: userSession.input_height || 1024,
        batch_size: userSession.batch_size || 1,
        steps: userSession.steps || 30,
        cfg_scale: userSession.cfg_scale || 6,
        strength: userSession.strength || 0.75,
        prompt: userSession.prompt || "",
        negative_prompt: userSession.negative_prompt || "",
        user_prompt: userSession.user_prompt || "",
        seed: userSession.seed || -1,
        input_image: userSession.input_image || null,
        input_control_image: userSession.input_control_image || null,
        input_pose_image: userSession.input_pose_image || null,
        input_style_image: userSession.input_style_image || null,
        checkpoint: userSession.checkpoint || "default"
      };
      
      logger.debug(`Retrieved settings for user ${userId}`);
      
      return {
        success: true,
        settings,
        limits: {
          maxSize: calculateMaxSize(userId),
          maxBatch: calculateMaxBatch(userId),
          maxSteps: calculateMaxSteps(userId)
        }
      };
    } catch (error) {
      logger.error(`Error getting settings for user ${userId}:`, error);
      return {
        success: false,
        error: `Failed to get settings: ${error.message}`
      };
    }
  };

  /**
   * Update a specific setting for a user
   * @param {string|number} userId - User ID
   * @param {string} setting - Setting key to update
   * @param {*} value - New value for the setting
   * @returns {Object} Result object with updated settings or error
   */
  const updateSetting = (userId, setting, value) => {
    try {
      const userSession = session.getSession(userId);
      const currentSettings = getAllSettings(userId).settings;
      
      // Validate settings based on their type
      switch (setting) {
        case 'input_width':
        case 'input_height': {
          const intValue = parseInt(value, 10);
          if (isNaN(intValue)) {
            return {
              success: false,
              error: 'Size must be a valid number'
            };
          }
          
          const maxSize = calculateMaxSize(userId);
          if (intValue > maxSize) {
            return {
              success: false,
              error: `Size must be less than ${maxSize}`
            };
          }
          
          session.setValue(userId, setting, intValue);
          break;
        }
        
        case 'batch_size': {
          const intValue = parseInt(value, 10);
          if (isNaN(intValue) || intValue < 1) {
            return {
              success: false,
              error: 'Batch size must be a positive number'
            };
          }
          
          const maxBatch = calculateMaxBatch(userId);
          if (intValue > maxBatch) {
            return {
              success: false,
              error: `Batch size must be less than ${maxBatch}`
            };
          }
          
          session.setValue(userId, setting, intValue);
          break;
        }
        
        case 'steps': {
          const intValue = parseInt(value, 10);
          if (isNaN(intValue) || intValue < 1) {
            return {
              success: false,
              error: 'Steps must be a positive number'
            };
          }
          
          const maxSteps = calculateMaxSteps(userId);
          if (intValue > maxSteps) {
            return {
              success: false,
              error: `Steps must be less than ${maxSteps}`
            };
          }
          
          session.setValue(userId, setting, intValue);
          break;
        }
        
        case 'cfg_scale': {
          const floatValue = parseFloat(value);
          if (isNaN(floatValue) || floatValue < 0 || floatValue > 30) {
            return {
              success: false,
              error: 'CFG scale must be a number between 0 and 30'
            };
          }
          
          session.setValue(userId, setting, floatValue);
          break;
        }
        
        case 'strength': {
          const floatValue = parseFloat(value);
          if (isNaN(floatValue) || floatValue < 0 || floatValue > 1) {
            return {
              success: false,
              error: 'Strength must be a number between 0 and 1'
            };
          }
          
          session.setValue(userId, setting, floatValue);
          break;
        }
        
        case 'seed': {
          // Special case: -1 is allowed for random seed
          if (value === -1 || value === '-1') {
            session.setValue(userId, setting, -1);
            break;
          }
          
          const intValue = parseInt(value, 10);
          if (isNaN(intValue)) {
            return {
              success: false,
              error: 'Seed must be a valid number or -1 for random'
            };
          }
          
          session.setValue(userId, setting, intValue);
          break;
        }
        
        case 'prompt':
        case 'negative_prompt':
        case 'user_prompt': {
          // Validate string
          if (typeof value !== 'string') {
            return {
              success: false,
              error: `${setting} must be a string`
            };
          }
          
          session.setValue(userId, setting, value);
          break;
        }
        
        case 'input_image':
        case 'input_control_image':
        case 'input_pose_image':
        case 'input_style_image': {
          // Validate URL or null
          if (value !== null && typeof value !== 'string') {
            return {
              success: false,
              error: `${setting} must be a valid URL or null`
            };
          }
          
          session.setValue(userId, setting, value);
          break;
        }
        
        case 'checkpoint': {
          // Validate string
          if (typeof value !== 'string') {
            return {
              success: false,
              error: 'Checkpoint must be a string'
            };
          }
          
          session.setValue(userId, setting, value);
          break;
        }
        
        default:
          return {
            success: false,
            error: `Unknown setting: ${setting}`
          };
      }
      
      // Get the updated settings
      const updatedSettings = getAllSettings(userId).settings;
      
      logger.debug(`Updated setting ${setting} for user ${userId}`);
      
      return {
        success: true,
        setting,
        oldValue: currentSettings[setting],
        newValue: updatedSettings[setting],
        settings: updatedSettings
      };
    } catch (error) {
      logger.error(`Error updating setting ${setting} for user ${userId}:`, error);
      return {
        success: false,
        error: `Failed to update setting: ${error.message}`
      };
    }
  };

  /**
   * Update multiple settings at once
   * @param {string|number} userId - User ID
   * @param {Object} settings - Object with settings to update
   * @returns {Object} Result object with updated settings or error
   */
  const updateMultipleSettings = (userId, settings) => {
    try {
      if (!settings || typeof settings !== 'object') {
        return {
          success: false,
          error: 'Settings must be an object'
        };
      }
      
      const results = {};
      let hasErrors = false;
      
      // Update each setting
      for (const [setting, value] of Object.entries(settings)) {
        const result = updateSetting(userId, setting, value);
        results[setting] = result;
        
        if (!result.success) {
          hasErrors = true;
        }
      }
      
      // Get all updated settings
      const updatedSettings = getAllSettings(userId).settings;
      
      return {
        success: !hasErrors,
        results,
        settings: updatedSettings
      };
    } catch (error) {
      logger.error(`Error updating multiple settings for user ${userId}:`, error);
      return {
        success: false,
        error: `Failed to update settings: ${error.message}`
      };
    }
  };

  /**
   * Reset settings to defaults
   * @param {string|number} userId - User ID
   * @returns {Object} Result object with updated settings or error
   */
  const resetSettings = (userId) => {
    try {
      const defaultSettings = {
        input_width: 1024,
        input_height: 1024,
        batch_size: 1,
        steps: 30,
        cfg_scale: 6,
        strength: 0.75,
        prompt: "",
        negative_prompt: "",
        user_prompt: "",
        seed: -1,
        input_image: null,
        input_control_image: null,
        input_pose_image: null,
        input_style_image: null,
        checkpoint: "default"
      };
      
      // Update each setting
      for (const [setting, value] of Object.entries(defaultSettings)) {
        session.setValue(userId, setting, value);
      }
      
      logger.debug(`Reset settings for user ${userId}`);
      
      return {
        success: true,
        settings: defaultSettings
      };
    } catch (error) {
      logger.error(`Error resetting settings for user ${userId}:`, error);
      return {
        success: false,
        error: `Failed to reset settings: ${error.message}`
      };
    }
  };

  /**
   * Set size (width and height) in one operation
   * @param {string|number} userId - User ID
   * @param {string|number} width - Width value
   * @param {string|number} height - Height value
   * @returns {Object} Result object with updated settings or error
   */
  const setSize = (userId, width, height) => {
    try {
      const widthInt = parseInt(width, 10);
      const heightInt = parseInt(height, 10);
      
      if (isNaN(widthInt) || isNaN(heightInt)) {
        return {
          success: false,
          error: 'Width and height must be valid numbers'
        };
      }
      
      const maxSize = calculateMaxSize(userId);
      
      if (widthInt > maxSize || heightInt > maxSize) {
        return {
          success: false,
          error: `Size must be less than ${maxSize}x${maxSize}`
        };
      }
      
      session.setValue(userId, 'input_width', widthInt);
      session.setValue(userId, 'input_height', heightInt);
      
      logger.debug(`Set size to ${widthInt}x${heightInt} for user ${userId}`);
      
      const updatedSettings = getAllSettings(userId).settings;
      
      return {
        success: true,
        width: widthInt,
        height: heightInt,
        settings: updatedSettings
      };
    } catch (error) {
      logger.error(`Error setting size for user ${userId}:`, error);
      return {
        success: false,
        error: `Failed to set size: ${error.message}`
      };
    }
  };

  // Return the public API
  return {
    getAllSettings,
    updateSetting,
    updateMultipleSettings,
    resetSettings,
    setSize,
    calculateMaxSize,
    calculateMaxBatch,
    calculateMaxSteps
  };
}

module.exports = createSettingsWorkflow; 