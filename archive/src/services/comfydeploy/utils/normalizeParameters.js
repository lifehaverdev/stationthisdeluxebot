/**
 * Parameter Handling Utility
 * 
 * Provides minimal functions for parameter compatibility.
 * This is a simplified version that removes the overengineered normalization
 * in favor of simple parameter filtering at the API boundary.
 */

/**
 * Normalize a parameter key by adding the input_ prefix if not already present
 * (Kept for backward compatibility)
 * @param {string} key - The parameter key to normalize
 * @returns {string} - The normalized parameter key with input_ prefix
 */
function normalizeParameterKey(key) {
  if (!key) return key;
  return key.startsWith('input_') ? key : `input_${key}`;
}

/**
 * Filter object to ensure only primitive values (strings, numbers, booleans)
 * are included, removing nested objects that would cause API errors
 * @param {Object} parameters - Object containing parameters to filter
 * @returns {Object} - New object with only primitive values
 */
function filterPrimitiveParameters(parameters) {
  if (!parameters || typeof parameters !== 'object') {
    return parameters;
  }

  // Create output object
  const filtered = {};

  // Process each parameter
  Object.entries(parameters).forEach(([key, value]) => {
    // Only keep primitive values
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      filtered[key] = value;
    }
  });

  return filtered;
}

/**
 * Normalize API parameters to be compatible with ComfyDeploy API
 * (Simplified version that just filters out objects)
 * @param {Object} requestPayload - The API request payload
 * @returns {Object} - New request payload with only compatible parameter types
 */
function normalizeAPIParameters(requestPayload) {
  if (!requestPayload || typeof requestPayload !== 'object') {
    return requestPayload;
  }

  // Create a copy of the request payload
  const normalized = { ...requestPayload };
  
  // Filter inputs if they exist to have only primitive values
  if (normalized.inputs && typeof normalized.inputs === 'object') {
    normalized.inputs = filterPrimitiveParameters(normalized.inputs);
  }

  return normalized;
}

module.exports = {
  normalizeParameterKey,
  filterPrimitiveParameters,
  normalizeAPIParameters
}; 