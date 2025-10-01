const OpenAIService = require('./openaiService');
const registry = require('../adapterRegistry');

/**
 * Adapter for OpenAI-based tools. Supports both chat completion (text) and
 * image generation via DALL·E. For now, both operations are treated as
 * immediate – callers decide which parameters to supply.
 *
 * Usage contract: the caller passes an `action` field identifying
 * "chat" or "image" plus the relevant params expected by OpenAIService.
 */
class OpenAIAdapter {
  constructor() {
    this.svc = new OpenAIService({ logger: console });
  }

  /**
   * Execute an immediate OpenAI operation.
   * @param {object} params - Inputs for the tool.
   * @param {'chat'|'image'} params.action - Which OpenAI endpoint to hit.
   * For chat: prompt, instructions, temperature, model; for image: prompt, model, size, quality, responseFormat.
   * @returns {Promise<import('../adapterTypes').ToolResult>}
   */
  async execute(params) {
    const { action } = params;
    if (action === 'chat') {
      const { prompt, instructions, temperature, model } = params;
      const text = await this.svc.executeChatCompletion({ prompt, instructions, temperature, model });
      return { type: 'text', data: { text }, status: 'succeeded' };
    }
    if (action === 'image') {
      const { prompt, model, size, quality, responseFormat } = params;
      const resultObj = await this.svc.generateImage({ prompt, model, size, quality, responseFormat });
      // Normalize result
      const image = resultObj.url ? { url: resultObj.url } : { b64_json: resultObj.b64_json };
      return { type: 'image', data: { images: [image] }, status: 'succeeded' };
    }
    throw new Error(`OpenAIAdapter.execute: unknown action '${action}'`);
  }
}

// Create singleton and register
const openAIAdapter = new OpenAIAdapter();
registry.register('openai', openAIAdapter);
module.exports = openAIAdapter;
