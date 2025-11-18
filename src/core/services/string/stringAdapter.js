const registry = require('../adapterRegistry');

class StringAdapter {
  /**
   * Extracts text value from various input formats (string, number, or generation output object)
   * @param {any} value - The value to extract text from
   * @returns {string} - The extracted text value
   */
  _extractTextValue(value) {
    if (value == null) return '';
    
    // If it's already a string or number, convert and return
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    
    // If it's an object, try to extract text from generation output structure
    if (typeof value === 'object') {
      // Handle generation output format: { type: 'text', data: { text: ['...'] } }
      if (value.data && value.data.text) {
        const textData = value.data.text;
        if (Array.isArray(textData) && textData.length > 0) {
          return String(textData[0]);
        } else if (typeof textData === 'string') {
          return textData;
        }
      }
      // Handle simpler format: { text: '...' }
      if (value.text) {
        return String(Array.isArray(value.text) ? value.text[0] : value.text);
      }
      // Handle result format: { result: '...' }
      if (value.result) {
        return String(value.result);
      }
      // Fallback: try to stringify the object
      return JSON.stringify(value);
    }
    
    return String(value);
  }

  /**
   * @param {object} params
   * @param {'concat'|'replace'} params.operation
   * @param {string} params.stringA
   * @param {string} [params.stringB]
   * @param {string} [params.searchValue]
   */
  async execute(params) {
    const { operation, stringA, stringB = '', searchValue } = params;
    if (!stringA) throw new Error('stringA required');
    let result;
    switch (operation) {
      case 'concat':
        result = stringA + stringB;
        break;
      case 'replace':
        if (searchValue == null) {
          throw new Error('searchValue is required for replace operation');
        }
        // Convert to strings to handle numbers or other types
        // Also handle generation output objects for stringA and searchValue
        const strA = this._extractTextValue(stringA);
        const strB = this._extractTextValue(stringB);
        // Extract text from searchValue (may be a generation output object)
        const strSearchValue = this._extractTextValue(searchValue).trim();
        
        // Validate after extraction
        if (strA === '') {
          throw new Error('stringA cannot be empty after extraction');
        }
        if (strSearchValue === '') {
          throw new Error('searchValue cannot be empty or only whitespace after extraction');
        }
        
        // Replace all occurrences by escaping regex special chars and using global + case-insensitive flags
        const escapedSearchValue = strSearchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedSearchValue, 'gi');
        result = strA.replace(regex, strB);
        break;
      default:
        throw new Error(`Unknown string operation ${operation}`);
    }
    return { type: 'text', data: { result }, status: 'succeeded' };
  }
}

const adapter = new StringAdapter();
registry.register('string', adapter);
module.exports = adapter;
