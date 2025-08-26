class StringService {
  /**
   * @param {object} options
   * @param {object} options.logger
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
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
        if (searchValue === '') return stringA;
        return stringA.split(searchValue).join(stringB);
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

module.exports = StringService;
