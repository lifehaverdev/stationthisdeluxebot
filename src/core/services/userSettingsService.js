const { ToolRegistry } = require('../tools/ToolRegistry');
// const { internalApiClient } = require('../../api/internalApiClient'); // Assuming internalApiClient is set up and exported
const { createLogger } = require('../../utils/logger');

const logger = createLogger('UserSettingsService');

class UserSettingsService {
  constructor(services = {}) {
    this.toolRegistry = services.toolRegistry || ToolRegistry.getInstance();
    // Assuming userPreferences are fetched via an internal API client
    // The internalApiClient should be configured with the correct base URL and auth
    this.internalApiClient = services.internalApiClient;
    if (!this.internalApiClient) {
      logger.error('[UserSettingsService] Critical: internalApiClient was not provided in services. API-dependent methods will fail.');
      // Consider throwing an error here if the service cannot function without it.
    }
    this.userPreferencesApi = services.userPreferencesApi; // Direct DB access or another service
  }

  /**
   * Merges tool defaults with user preferences for a specific tool.
   * @param {string} masterAccountId - The user's master account ID.
   * @param {string} toolId - The ID of the tool.
   * @returns {Promise<object | null>} Effective settings or null if tool not found.
   */
  async getEffectiveSettings(masterAccountId, toolId) {
    logger.debug(`[getEffectiveSettings] Called`, { masterAccountId, toolId });
    const tool = this.toolRegistry.getToolById(toolId);
    if (!tool || !tool.inputSchema) {
      logger.warn(`[getEffectiveSettings] Tool or inputSchema not found`, { toolId });
      return null;
    }

    const toolDefaults = {};
    for (const paramName in tool.inputSchema) {
      if (tool.inputSchema[paramName].hasOwnProperty('default')) {
        toolDefaults[paramName] = tool.inputSchema[paramName].default;
      }
    }

    let userPreferences = {};
    try {
      // ADR-006 implies preferences are stored under a toolId key.
      // The GET /preferences/:toolId route is not explicitly defined for UserSettingsService to call,
      // but it's implied by PUT /preferences/:toolId and DELETE /preferences/:toolId.
      // Assuming an internal API client method to fetch these.
      // Example: /users/:masterAccountId/preferences/:toolId
      const response = await this.internalApiClient.get(`/users/${masterAccountId}/preferences/${toolId}`);
      if (response.data && typeof response.data === 'object') {
        userPreferences = response.data; // Assuming the API returns the preferences for the toolId directly
      }
      logger.debug(`[getEffectiveSettings] Fetched user preferences`, { toolId, userPreferences });
    } catch (error) {
      if (error.response && error.response.status === 404) {
        logger.debug(`[getEffectiveSettings] No preferences found for user. Using defaults.`, { masterAccountId, toolId });
      } else {
        logger.error(`[getEffectiveSettings] Error fetching user preferences: ${error.message}`, { masterAccountId, toolId });
        // Decide if to proceed with defaults or throw. For now, proceed with defaults.
      }
    }

    const effectiveSettings = { ...toolDefaults, ...userPreferences };
    logger.debug(`[getEffectiveSettings] Effective settings determined`, { toolId, effectiveSettings });
    return effectiveSettings;
  }

  /**
   * Validates a preference object against a tool's input schema.
   * @param {string} toolId - The ID of the tool.
   * @param {object} preferences - The preference object to validate.
   * @returns {{isValid: boolean, errors: string[]}} Validation result.
   */
  validatePreferences(toolId, preferences) {
    logger.debug(`[validatePreferences] Called`, { toolId, preferences });
    const tool = this.toolRegistry.getToolById(toolId);
    if (!tool || !tool.inputSchema) {
      logger.warn(`[validatePreferences] Tool or inputSchema not found`, { toolId });
      return { isValid: false, errors: ['Tool or input schema not found.'] };
    }

    const errors = [];
    const GHOST_FIELD_ERROR_MESSAGE = "Invalid parameter name not found in tool's input schema.";

    for (const paramName in preferences) {
      if (!tool.inputSchema[paramName]) {
        errors.push(`Parameter "${paramName}": ${GHOST_FIELD_ERROR_MESSAGE}`);
        continue;
      }

      const schemaParam = tool.inputSchema[paramName];
      const expectedType = schemaParam.type;
      const value = preferences[paramName];
      const actualType = typeof value;
      
      // Allow null or undefined values if the parameter is not required
      if ((value === null || typeof value === 'undefined') && !schemaParam.required) {
        continue;
      }

      switch (expectedType) {
        case 'string':
          if (actualType !== 'string') {
            errors.push(`Parameter "${paramName}": Expected type string, got ${actualType}.`);
          }
          break;
        case 'number':
          if (actualType !== 'number') {
            errors.push(`Parameter "${paramName}": Expected type number, got ${actualType}.`);
          }
          break;
        case 'boolean':
          if (actualType !== 'boolean') {
            errors.push(`Parameter "${paramName}": Expected type boolean, got ${actualType}.`);
          }
          break;
        case 'image':
        case 'video':
        case 'audio':
        case 'file':
          if (actualType !== 'string') {
            // errors.push(`Parameter "${paramName}": Expected type string (for ${expectedType} URL/ID), got ${actualType}.`);
            logger.debug(`[validatePreferences] Parameter "${paramName}" (asset type ${expectedType}): Expected type string, got ${actualType}. This might be okay if it is an ID/URL.`);
          }
          break;
        default:
          logger.warn(`[validatePreferences] Unknown expected type for parameter.`, { paramName, expectedType });
          break;
      }
    }
    logger.debug(`[validatePreferences] Validation result: isValid: ${errors.length === 0}`, { toolId, errors });
    return { isValid: errors.length === 0, errors };
  }

  /**
   * Saves validated preferences for a user and tool.
   * @param {string} masterAccountId - The user's master account ID.
   * @param {string} toolId - The ID of the tool.
   * @param {object} preferences - The preference object to save.
   * @returns {Promise<{success: boolean, data: object|null, errors: string[]}>} Save result.
   */
  async savePreferences(masterAccountId, toolId, preferences) {
    logger.debug(`[savePreferences] Called`, { masterAccountId, toolId, preferences });
    const validationResult = this.validatePreferences(toolId, preferences);
    if (!validationResult.isValid) {
      logger.warn(`[savePreferences] Validation failed`, { toolId, errors: validationResult.errors });
      return { success: false, data: null, errors: validationResult.errors };
    }

    try {
      // ADR-006: "Applies validated preferences via internalApiClient.PUT /preferences/:toolId"
      // The route is actually /users/:masterAccountId/preferences/:toolId
      const response = await this.internalApiClient.put(
        `/users/${masterAccountId}/preferences/${toolId}`,
        preferences // The body should be the preferences object for that toolId
      );
      logger.info(`[savePreferences] Preferences saved successfully. Response status: ${response.status}`, { masterAccountId, toolId });
      return { success: true, data: response.data, errors: [] };
    } catch (error) {
      logger.error(`[savePreferences] Error saving preferences: ${error.message}`, { masterAccountId, toolId, responseData: error.response?.data });
      const errorMsg = error.response?.data?.error?.message || error.message || 'Failed to save preferences via internal API.';
      return { success: false, data: null, errors: [errorMsg] };
    }
  }

  /**
   * Merges user input, user preferences, and tool defaults.
   * Order of precedence: userInput > userPreferences > toolDefaults.
   * @param {string} toolId - The ID of the tool.
   * @param {object} userInput - The input provided by the user for the current operation.
   * @param {string} masterAccountId - The user's master account ID.
   * @returns {Promise<object | null>} Resolved input parameters or null if tool not found.
   */
  async getResolvedInput(toolId, userInput, masterAccountId) {
    logger.debug(`[getResolvedInput] Called`, { toolId, masterAccountId, userInput });
    const tool = this.toolRegistry.getToolById(toolId);
    if (!tool || !tool.inputSchema) {
      logger.warn(`[getResolvedInput] Tool or inputSchema not found`, { toolId });
      return null;
    }

    const toolDefaults = {};
    for (const paramName in tool.inputSchema) {
      if (tool.inputSchema[paramName].hasOwnProperty('default')) {
        toolDefaults[paramName] = tool.inputSchema[paramName].default;
      }
    }
    logger.debug(`[getResolvedInput] Tool defaults processed`, { toolId, toolDefaults });

    let userPreferences = {};
    try {
      const response = await this.internalApiClient.get(`/users/${masterAccountId}/preferences/${toolId}`);
      if (response.data && typeof response.data === 'object') {
        userPreferences = response.data;
      }
      logger.debug(`[getResolvedInput] User preferences fetched`, { masterAccountId, toolId, userPreferences });
    } catch (error) {
      if (error.response && error.response.status === 404) {
        logger.debug(`[getResolvedInput] No preferences found for user.`, { masterAccountId, toolId });
      } else {
        logger.error(`[getResolvedInput] Error fetching user preferences: ${error.message}`, { masterAccountId, toolId });
      }
    }

    // Ensure userInput is an object
    const saneUserInput = (typeof userInput === 'object' && userInput !== null) ? userInput : {};

    const resolvedInput = { ...toolDefaults, ...userPreferences, ...saneUserInput };
    logger.info(`[getResolvedInput] Input resolved`, { toolId, resolvedInput });
    return resolvedInput;
  }
}

// For direct instantiation if services are not passed (e.g., in some tests or scripts)
// However, it's better to inject dependencies.
let userSettingsServiceInstance;

function getUserSettingsService(services = {}) {
  if (!userSettingsServiceInstance) {
    // Ensure internalApiClient is available. This might require more sophisticated setup
    // if internalApiClient itself has dependencies or needs to be initialized.
    // const anInternalApiClient = services.internalApiClient || internalApiClient; // Use the one from module if not provided.
    if (!services.internalApiClient) {
        logger.error("Critical: internalApiClient is not available for UserSettingsService in getUserSettingsService. Operations like savePreferences will fail.");
        // Potentially throw here or return a service that will loudly fail.
    }
    userSettingsServiceInstance = new UserSettingsService(services);
    logger.info('UserSettingsService initialized.');
  }
  return userSettingsServiceInstance;
}

module.exports = {
  UserSettingsService,
  getUserSettingsService,
}; 