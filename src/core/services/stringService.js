class StringService {
  /**
   * @param {object} options
   * @param {object} options.logger
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
  }

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
      // Fallback: try to stringify the object (shouldn't happen, but better than "[object Object]")
      this.logger.warn(`[StringService] Could not extract text from object: ${JSON.stringify(value)}`);
      return JSON.stringify(value);
    }
    
    return String(value);
  }

  /**
   * Perform an operation.
   * @param {object} params
   * @param {'concat'|'replace'} params.operation
   * @param {string} params.inputText - Main text input
   * @param {string} [params.appendText] - Text to append (concat)
   * @param {string} [params.searchText] - Text to find (replace)
   * @param {string} [params.replacementText] - Replacement text (replace)
   * @param {string} [params.stringA] - Legacy: maps to inputText
   * @param {string} [params.stringB] - Legacy: maps to appendText/replacementText
   * @param {string} [params.searchValue] - Legacy: maps to searchText
   * @returns {string}
   */
  execute({
    operation,
    // New field names
    inputText,
    appendText,
    searchText,
    replacementText,
    // Legacy field names for backwards compatibility
    stringA,
    stringB = '',
    searchValue = ''
  }) {
    // Map legacy names to new names (new names take precedence)
    const mainText = inputText ?? stringA;

    switch (operation) {
      case 'concat': {
        const textToAppend = appendText ?? stringB ?? '';
        return `${mainText}${textToAppend}`;
      }
      case 'replace': {
        // Map legacy names to new names (new names take precedence)
        const sourceText = inputText ?? stringA;
        const findText = searchText ?? searchValue;
        const replaceWithText = replacementText ?? stringB ?? '';

        // Validate required parameters
        if (sourceText == null) {
          throw new Error('inputText is required for replace operation');
        }
        if (findText == null) {
          throw new Error('searchText is required for replace operation');
        }

        // Convert to strings to handle numbers or other types
        // Also handle generation output objects
        const strA = this._extractTextValue(sourceText);
        const strB = this._extractTextValue(replaceWithText);
        // Extract text from searchText (may be a generation output object)
        const strSearchValue = this._extractTextValue(findText).trim();
        
        // Validate after extraction (in case object extracted to empty string)
        if (strA === '') {
          throw new Error('inputText cannot be empty after extraction');
        }
        if (strSearchValue === '') {
          throw new Error('searchText cannot be empty or only whitespace after extraction');
        }

        // Logging to diagnose issues
        this.logger.debug(`[StringService] Replace operation - searchText: "${strSearchValue}", replacementText: "${strB}", inputText length: ${strA.length}`);
        this.logger.debug(`[StringService] First 200 chars of inputText: "${strA.substring(0, 200)}"`);

        // Count occurrences before replacement
        const escapedForCount = strSearchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const beforeCount = (strA.match(new RegExp(escapedForCount, 'gi')) || []).length;
        this.logger.debug(`[StringService] Found ${beforeCount} occurrences of "${strSearchValue}" (case-insensitive)`);
        
        // Escape special regex characters to treat searchValue as a literal string
        const escapedSearchValue = strSearchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use case-insensitive flag to match all variations (girl, Girl, GIRL, etc.)
        const regex = new RegExp(escapedSearchValue, 'gi');
        const result = strA.replace(regex, strB);
        
        // Count occurrences after replacement
        const afterCount = (result.match(new RegExp(escapedForCount, 'gi')) || []).length;
        this.logger.debug(`[StringService] After replacement: ${afterCount} occurrences remaining. Result length: ${result.length}`);
        
        // Log a sample of the result to verify replacement worked
        if (beforeCount > 0 && afterCount > 0) {
          const sampleMatch = result.match(new RegExp(escapedForCount, 'i'));
          this.logger.warn(`[StringService] WARNING: Replacement may have failed. Found "${sampleMatch ? sampleMatch[0] : 'none'}" in result`);
        }
        
        return result;
      }
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

module.exports = StringService;
