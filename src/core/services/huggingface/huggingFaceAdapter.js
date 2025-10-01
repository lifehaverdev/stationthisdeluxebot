const HuggingFaceService = require('./huggingfaceService');
const registry = require('../adapterRegistry');

class HuggingFaceAdapter {
  constructor() {
    this.svc = new HuggingFaceService({ logger: console });
  }

  /**
   * JoyCaption and similar image interrogation are immediate operations.
   * @param {object} params
   * @param {string} params.imageUrl
   * @returns {Promise<import('../adapterTypes').ToolResult>}
   */
  async execute(params) {
    const { imageUrl } = params;
    if (!imageUrl) throw new Error('HuggingFaceAdapter.execute requires imageUrl');
    const description = await this.svc.interrogateImage({ imageUrl });
    return { type: 'text', data: { description }, status: 'succeeded' };
  }
}

const adapter = new HuggingFaceAdapter();
registry.register('huggingface', adapter);
module.exports = adapter;
