/**
 * InputParameterNormalizer
 * ------------------------
 * Normalizes input parameter names to match tool input schema expectations.
 * 
 * Handles common variations like:
 * - input_image → imageUrl, image_url, inputImage, etc.
 * - input_prompt → prompt, text, inputText, etc.
 * - input_video → videoUrl, video_url, etc.
 * 
 * This prevents parameter name mismatches between platforms and tools.
 */

class InputParameterNormalizer {
  /**
   * Normalizes input parameters to match tool's input schema
   * @param {Object} inputs - Raw input parameters
   * @param {Object} tool - Tool definition with inputSchema
   * @param {Object} options - Normalization options
   * @param {Object} options.logger - Logger instance (optional)
   * @returns {Object} - Normalized inputs matching tool schema
   */
  static normalize(inputs, tool, options = {}) {
    const logger = options.logger || console;
    
    if (!inputs || typeof inputs !== 'object') {
      return inputs || {};
    }
    
    if (!tool || !tool.inputSchema || typeof tool.inputSchema !== 'object') {
      // No schema to normalize against, return as-is
      return inputs;
    }

    const normalized = { ...inputs };
    const schemaKeys = Object.keys(tool.inputSchema);
    
    // Build parameter name mappings for each schema field
    const parameterMappings = this._buildParameterMappings(tool.inputSchema);
    
    // Apply normalizations
    for (const [schemaKey, variations] of Object.entries(parameterMappings)) {
      // If the schema key already exists with a non-empty value, skip (exact match)
      // This ensures we don't overwrite correctly set values
      if (normalized[schemaKey] !== undefined && normalized[schemaKey] !== null && normalized[schemaKey] !== '') {
        logger.debug(`[InputParameterNormalizer] Schema key "${schemaKey}" already set correctly, skipping normalization for tool ${tool.displayName || tool.toolId}`);
        continue;
      }
      
      // Check if any variation exists in inputs
      for (const variation of variations) {
        // Skip if variation is the same as schemaKey (already checked above)
        if (variation === schemaKey) {
          continue;
        }
        
        if (normalized[variation] !== undefined && normalized[variation] !== null && normalized[variation] !== '') {
          // Found a variation - map it to the schema key
          // Only set if schemaKey is not already set (double-check)
          if (normalized[schemaKey] === undefined || normalized[schemaKey] === null || normalized[schemaKey] === '') {
            normalized[schemaKey] = normalized[variation];
            logger.debug(`[InputParameterNormalizer] Mapped "${variation}" → "${schemaKey}" for tool ${tool.displayName || tool.toolId}`);
          }
          // Keep the variation key as well for backward compatibility
          break;
        }
      }
    }
    
    return normalized;
  }

  /**
   * Legacy parameter name mappings for specific tools
   * Maps new schema keys to their legacy equivalents
   */
  static LEGACY_MAPPINGS = {
    // string-primitive tool: old names → new names
    inputText: ['stringA'],
    appendText: ['stringB'],  // for concat operation
    replacementText: ['stringB'],  // for replace operation
    searchText: ['searchValue'],
    // chatgpt tool: old names → new names
    prompt: ['input_prompt'],
    instructions: ['input_instructions'],
  };

  /**
   * Builds parameter name variations for each schema field
   * @param {Object} inputSchema - Tool input schema
   * @returns {Object} - Map of schemaKey → [variations]
   * @private
   */
  static _buildParameterMappings(inputSchema) {
    const mappings = {};

    for (const [schemaKey, fieldDef] of Object.entries(inputSchema)) {
      const fieldType = (fieldDef.type || '').toLowerCase();
      const variations = this._generateVariations(schemaKey, fieldType);

      // Add any legacy mappings for this schema key
      if (this.LEGACY_MAPPINGS[schemaKey]) {
        this.LEGACY_MAPPINGS[schemaKey].forEach(legacy => variations.push(legacy));
      }

      mappings[schemaKey] = variations;
    }

    return mappings;
  }

  /**
   * Generates common parameter name variations
   * @param {string} schemaKey - The schema key (e.g., "imageUrl")
   * @param {string} fieldType - Field type (e.g., "image", "string", "video")
   * @returns {string[]} - Array of possible variations
   * @private
   */
  static _generateVariations(schemaKey, fieldType) {
    const variations = new Set();
    
    // Add the original key (for reference, though we check it separately)
    variations.add(schemaKey);
    
    // Common patterns based on field type
    if (fieldType === 'image') {
      // Image parameter variations
      variations.add('input_image');
      variations.add('inputImage');
      variations.add('image_url');
      variations.add('imageUrl');
      variations.add('image');
      variations.add('inputImageUrl');
      variations.add('input_image_url');
      
      // If schemaKey is camelCase, add snake_case and vice versa
      if (schemaKey.includes('_')) {
        // snake_case → camelCase
        const camelCase = schemaKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        variations.add(camelCase);
      } else {
        // camelCase → snake_case
        const snakeCase = schemaKey.replace(/([A-Z])/g, '_$1').toLowerCase();
        variations.add(snakeCase);
        // Also add with input_ prefix
        variations.add(`input_${snakeCase}`);
      }
    } else if (fieldType === 'video') {
      // Video parameter variations
      variations.add('input_video');
      variations.add('inputVideo');
      variations.add('video_url');
      variations.add('videoUrl');
      variations.add('video');
      variations.add('inputVideoUrl');
      variations.add('input_video_url');
      
      // Case conversions
      if (schemaKey.includes('_')) {
        const camelCase = schemaKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        variations.add(camelCase);
      } else {
        const snakeCase = schemaKey.replace(/([A-Z])/g, '_$1').toLowerCase();
        variations.add(snakeCase);
        variations.add(`input_${snakeCase}`);
      }
    } else if (fieldType === 'string' || fieldType === 'text') {
      // Text/prompt parameter variations
      variations.add('input_prompt');
      variations.add('inputPrompt');
      variations.add('prompt');
      variations.add('text');
      variations.add('input_text');
      variations.add('inputText');
      
      // Case conversions
      if (schemaKey.includes('_')) {
        const camelCase = schemaKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        variations.add(camelCase);
      } else {
        const snakeCase = schemaKey.replace(/([A-Z])/g, '_$1').toLowerCase();
        variations.add(snakeCase);
        variations.add(`input_${snakeCase}`);
      }
    } else {
      // Generic case conversions for other types
      if (schemaKey.includes('_')) {
        const camelCase = schemaKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        variations.add(camelCase);
        variations.add(`input${camelCase.charAt(0).toUpperCase() + camelCase.slice(1)}`);
      } else {
        const snakeCase = schemaKey.replace(/([A-Z])/g, '_$1').toLowerCase();
        variations.add(snakeCase);
        variations.add(`input_${snakeCase}`);
      }
    }
    
    return Array.from(variations);
  }

  /**
   * Finds the best matching parameter name for a given value
   * @param {string} candidateKey - Candidate parameter name (e.g., "input_image")
   * @param {Object} tool - Tool definition with inputSchema
   * @returns {string|null} - Best matching schema key, or null if no match
   */
  static findBestMatch(candidateKey, tool) {
    if (!tool || !tool.inputSchema) {
      return null;
    }
    
    const mappings = this._buildParameterMappings(tool.inputSchema);
    
    for (const [schemaKey, variations] of Object.entries(mappings)) {
      if (variations.includes(candidateKey)) {
        return schemaKey;
      }
    }
    
    return null;
  }
}

module.exports = InputParameterNormalizer;

