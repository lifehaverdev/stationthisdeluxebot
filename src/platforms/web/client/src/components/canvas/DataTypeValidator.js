// DataTypeValidator for StationThis web interface
// Manages data type validation and conversion between workflow tile connections

export class DataTypeValidator {
  constructor() {
    // Map of compatible data types for automatic conversion
    this.compatibilityMap = {
      'image': ['image'],
      'text': ['text', 'prompt', 'string'],
      'number': ['number', 'integer', 'float'],
      'array': ['array', 'list', 'collection'],
      'object': ['object', 'json', 'map'],
      'boolean': ['boolean', 'binary', 'toggle'],
      'prompt': ['text', 'prompt', 'string'],
      'parameter': ['parameter', 'setting', 'config'],
      'media': ['image', 'video', 'audio', 'media'],
      'collection': ['collection', 'array', 'list'],
      'workflow': ['workflow', 'pipeline', 'process'],
      'model': ['model', 'checkpoint', 'weights']
    };

    // Conversion functions for compatible types
    this.converters = {
      'number_to_text': (value) => String(value),
      'text_to_number': (value) => Number(value),
      'boolean_to_text': (value) => String(value),
      'text_to_boolean': (value) => value.toLowerCase() === 'true',
      'array_to_text': (value) => JSON.stringify(value),
      'text_to_array': (value) => {
        try {
          return JSON.parse(value);
        } catch (e) {
          return [value];
        }
      },
      'object_to_text': (value) => JSON.stringify(value),
      'text_to_object': (value) => {
        try {
          return JSON.parse(value);
        } catch (e) {
          return { value };
        }
      }
    };
  }

  /**
   * Check if two data types are compatible (directly or via conversion)
   * @param {string} sourceType - The type of the source port
   * @param {string} targetType - The type of the target port
   * @returns {boolean} Whether the types are compatible
   */
  areTypesCompatible(sourceType, targetType) {
    // Handle undefined types (assume compatible for now)
    if (!sourceType || !targetType) return true;
    
    // Direct match
    if (sourceType === targetType) return true;
    
    // Check compatibility based on maps
    const sourceCompatible = this.compatibilityMap[sourceType] || [];
    if (sourceCompatible.includes(targetType)) return true;
    
    const targetCompatible = this.compatibilityMap[targetType] || [];
    if (targetCompatible.includes(sourceType)) return true;
    
    // Advanced compatibility check based on available converters
    const converterKey = `${sourceType}_to_${targetType}`;
    return this.converters.hasOwnProperty(converterKey);
  }

  /**
   * Attempt to convert data from source type to target type
   * @param {any} data - The data to convert
   * @param {string} sourceType - The type of the source data
   * @param {string} targetType - The desired target type
   * @returns {Object} Result with success flag and converted data or error
   */
  convertData(data, sourceType, targetType) {
    // No conversion needed for same types
    if (sourceType === targetType) {
      return { success: true, data };
    }
    
    // Try direct conversion if available
    const converterKey = `${sourceType}_to_${targetType}`;
    if (this.converters[converterKey]) {
      try {
        const convertedData = this.converters[converterKey](data);
        return { success: true, data: convertedData };
      } catch (error) {
        return {
          success: false,
          error: `Conversion failed: ${error.message}`,
          data: null
        };
      }
    }
    
    // Try common category conversion if direct conversion not available
    // For example, 'prompt' and 'text' are in the same category
    if (this.compatibilityMap[sourceType]?.includes(targetType) ||
        this.compatibilityMap[targetType]?.includes(sourceType)) {
      return { success: true, data };
    }
    
    // Cannot convert
    return {
      success: false,
      error: `Cannot convert data from '${sourceType}' to '${targetType}'`,
      data: null
    };
  }

  /**
   * Generate an error message for type mismatch
   * @param {string} sourcePort - Source port name
   * @param {string} sourceType - Source data type
   * @param {string} targetPort - Target port name
   * @param {string} targetType - Target data type
   * @returns {string} Error message
   */
  getTypeMismatchError(sourcePort, sourceType, targetPort, targetType) {
    return `Type mismatch: Cannot connect '${sourcePort}' (${sourceType}) to '${targetPort}' (${targetType})`;
  }

  /**
   * Generate a suggestion for resolving type mismatch
   * @param {string} sourceType - Source data type
   * @param {string} targetType - Target data type
   * @returns {string} Suggestion message
   */
  getSuggestionForMismatch(sourceType, targetType) {
    // Find potential conversion paths
    const sourcePaths = this.compatibilityMap[sourceType] || [];
    const targetPaths = this.compatibilityMap[targetType] || [];
    
    // Check for common compatible types
    const commonTypes = sourcePaths.filter(type => targetPaths.includes(type));
    
    if (commonTypes.length > 0) {
      return `Try adding a converter tile to transform '${sourceType}' to '${commonTypes[0]}'`;
    }
    
    // Check for possible direct converters
    for (const key in this.converters) {
      const [from, to] = key.split('_to_');
      if (from === sourceType && this.compatibilityMap[to]?.includes(targetType)) {
        return `Try adding a converter tile to transform '${sourceType}' to '${to}'`;
      }
    }
    
    return `These types are not directly compatible. You may need a custom transformation`;
  }
}

// Export a singleton instance
export const dataTypeValidator = new DataTypeValidator(); 