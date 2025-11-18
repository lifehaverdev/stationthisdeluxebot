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
   * @param {string} params.stringA
   * @param {string} [params.stringB]
   * @param {string} [params.searchValue]
   * @returns {string}
   */
  execute({ operation, stringA, stringB = '', searchValue = '' }) {
    switch (operation) {
      case 'concat':
        return `${stringA}${stringB}`;
      case 'replace':
        // Validate required parameters
        if (stringA == null) {
          throw new Error('stringA is required for replace operation');
        }
        if (searchValue == null) {
          throw new Error('searchValue is required for replace operation');
        }
        
        // Convert to strings to handle numbers or other types
        // Also handle generation output objects for stringA and searchValue
        const strA = this._extractTextValue(stringA);
        const strB = this._extractTextValue(stringB);
        // Extract text from searchValue (may be a generation output object)
        const strSearchValue = this._extractTextValue(searchValue).trim();
        
        // Validate after extraction (in case object extracted to empty string)
        if (strA === '') {
          throw new Error('stringA cannot be empty after extraction');
        }
        if (strSearchValue === '') {
          throw new Error('searchValue cannot be empty or only whitespace after extraction');
        }
        
        // Logging to diagnose issues - use info level so it's visible
        this.logger.info(`[StringService] Replace operation - searchValue: "${strSearchValue}", stringB: "${strB}", stringA length: ${strA.length}`);
        this.logger.info(`[StringService] First 200 chars of stringA: "${strA.substring(0, 200)}"`);
        
        // Count occurrences before replacement
        const escapedForCount = strSearchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const beforeCount = (strA.match(new RegExp(escapedForCount, 'gi')) || []).length;
        this.logger.info(`[StringService] Found ${beforeCount} occurrences of "${strSearchValue}" (case-insensitive)`);
        
        // Escape special regex characters to treat searchValue as a literal string
        const escapedSearchValue = strSearchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use case-insensitive flag to match all variations (girl, Girl, GIRL, etc.)
        const regex = new RegExp(escapedSearchValue, 'gi');
        const result = strA.replace(regex, strB);
        
        // Count occurrences after replacement
        const afterCount = (result.match(new RegExp(escapedForCount, 'gi')) || []).length;
        this.logger.info(`[StringService] After replacement: ${afterCount} occurrences remaining. Result length: ${result.length}`);
        
        // Log a sample of the result to verify replacement worked
        if (beforeCount > 0 && afterCount > 0) {
          const sampleMatch = result.match(new RegExp(escapedForCount, 'i'));
          this.logger.warn(`[StringService] WARNING: Replacement may have failed. Found "${sampleMatch ? sampleMatch[0] : 'none'}" in result`);
        }
        
        return result;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

module.exports = StringService;
