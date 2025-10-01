const registry = require('../adapterRegistry');

class StringAdapter {
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
        if (searchValue == null) throw new Error('searchValue required for replace');
        result = stringA.replace(searchValue, stringB);
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
