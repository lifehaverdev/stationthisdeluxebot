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
   * @param {string} [params.inputText] - New parameter name for main text
   * @param {string} [params.appendText] - New parameter name for concat text
   * @param {string} [params.searchText] - New parameter name for search string
   * @param {string} [params.replacementText] - New parameter name for replacement
   * @param {string} [params.stringA] - Legacy parameter name (maps to inputText)
   * @param {string} [params.stringB] - Legacy parameter name (maps to appendText/replacementText)
   * @param {string} [params.searchValue] - Legacy parameter name (maps to searchText)
   */
  async execute(params) {
    const {
      operation,
      // New parameter names
      inputText,
      appendText,
      searchText,
      replacementText,
      // Legacy parameter names
      stringA,
      stringB = '',
      searchValue
    } = params;

    // Map new names to legacy names (new names take precedence)
    const mainText = inputText ?? stringA;
    if (!mainText) throw new Error('inputText (or stringA) required');

    let result;
    switch (operation) {
      case 'concat': {
        const textToAppend = appendText ?? stringB ?? '';
        result = this._extractTextValue(mainText) + this._extractTextValue(textToAppend);
        break;
      }
      case 'replace': {
        const findText = searchText ?? searchValue;
        const replaceWithText = replacementText ?? stringB ?? '';

        if (findText == null) {
          throw new Error('searchText (or searchValue) is required for replace operation');
        }
        // Convert to strings to handle numbers or other types
        // Also handle generation output objects
        const strA = this._extractTextValue(mainText);
        const strB = this._extractTextValue(replaceWithText);
        // Extract text from searchText (may be a generation output object)
        const strSearchValue = this._extractTextValue(findText).trim();

        // Validate after extraction
        if (strA === '') {
          throw new Error('inputText cannot be empty after extraction');
        }
        if (strSearchValue === '') {
          throw new Error('searchText cannot be empty or only whitespace after extraction');
        }

        // Replace all occurrences by escaping regex special chars and using global + case-insensitive flags
        const escapedSearchValue = strSearchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedSearchValue, 'gi');
        result = strA.replace(regex, strB);
        break;
      }
      default:
        throw new Error(`Unknown string operation ${operation}`);
    }
    return { type: 'text', data: { result }, status: 'succeeded' };
  }
}

const adapter = new StringAdapter();
registry.register('string', adapter);
module.exports = adapter;
