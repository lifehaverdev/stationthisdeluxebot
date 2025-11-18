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

    /**
     * Map to keep track of in-flight asynchronous jobs keyed by runId.
     * Value shape: { promise: Promise<ToolResult>, result?: ToolResult }
     * Once promise resolves the result will be cached for polling.
     * This is an in-memory store which means jobs will not survive process
     * restarts – acceptable for now until we move to a persistent queue.
     * @type {Map<string, { promise: Promise<any>, result?: import('../adapterTypes').ToolResult, error?: Error }>}
     */
    this._jobs = new Map();
  }

  /**
   * Calculate cost for ChatGPT based on token usage
   * @param {string} model - Model name (e.g., 'gpt-3.5-turbo', 'gpt-4')
   * @param {object} usage - Usage object with prompt_tokens, completion_tokens, total_tokens
   * @returns {number} Cost in USD
   */
  _calculateChatCost(model, usage) {
    if (!usage || !usage.total_tokens) return 0;

    // OpenAI pricing per 1K tokens (as of 2024)
    // Source: https://openai.com/pricing
    const pricing = {
      'gpt-3.5-turbo': { input: 0.0005 / 1000, output: 0.0015 / 1000 },
      'gpt-4': { input: 0.03 / 1000, output: 0.06 / 1000 },
      'gpt-4-turbo': { input: 0.01 / 1000, output: 0.03 / 1000 },
      'gpt-4o': { input: 0.005 / 1000, output: 0.015 / 1000 },
    };

    const modelKey = model.toLowerCase();
    const rates = pricing[modelKey] || pricing['gpt-3.5-turbo']; // Default to gpt-3.5-turbo pricing

    const inputCost = (usage.prompt_tokens || 0) * rates.input;
    const outputCost = (usage.completion_tokens || 0) * rates.output;

    return inputCost + outputCost;
  }

  /**
   * Calculate cost for DALL-E based on model, size, and quality
   * @param {string} model - Model name (e.g., 'dall-e-3', 'dall-e-2')
   * @param {string} size - Image size (e.g., '1024x1024')
   * @param {string} quality - Quality setting (e.g., 'standard', 'hd')
   * @param {object} costTable - Cost table from tool metadata
   * @returns {number} Cost in USD
   */
  _calculateImageCost(model, size, quality, costTable) {
    if (!costTable || !costTable[model]) return 0;

    const modelCosts = costTable[model];
    if (!modelCosts[size]) return 0;

    const sizeCosts = modelCosts[size];
    return sizeCosts[quality] || sizeCosts.standard || 0;
  }

  /**
   * Execute an immediate OpenAI operation.
   * @param {object} params - Inputs for the tool.
   * @param {'chat'|'image'} params.action - Which OpenAI endpoint to hit.
   * For chat: prompt, instructions, temperature, model; for image: prompt, model, size, quality, responseFormat.
   * @param {object} [params.costTable] - Cost table for DALL-E (from tool metadata)
   * @returns {Promise<import('../adapterTypes').ToolResult>}
   */
  async execute(params) {
    const { action = 'chat' } = params;
    if (action === 'chat') {
      const { prompt, instructions, temperature, model } = params;
      const result = await this.svc.executeChatCompletion({ prompt, instructions, temperature, model });
      
      // Handle both old format (string) and new format (object with content, usage)
      const text = typeof result === 'string' ? result : result.content;
      const usage = typeof result === 'object' ? result.usage : null;
      const actualModel = typeof result === 'object' ? (result.model || model) : model;
      
      // Calculate cost based on token usage
      const costUsd = usage ? this._calculateChatCost(actualModel, usage) : 0;
      
      return { 
        type: 'text', 
        data: { text }, 
        status: 'succeeded',
        costUsd 
      };
    }
    if (action === 'image') {
      const { prompt, model, size, quality, responseFormat, costTable } = params;
      const resultObj = await this.svc.generateImage({ prompt, model, size, quality, responseFormat });
      
      // Normalize result
      const image = resultObj.url ? { url: resultObj.url } : { b64_json: resultObj.b64_json };
      
      // Calculate cost based on costTable
      const costUsd = costTable ? this._calculateImageCost(model || 'dall-e-3', size || '1024x1024', quality || 'standard', costTable) : 0;
      
      return { 
        type: 'image', 
        data: { images: [image] }, 
        status: 'succeeded',
        costUsd 
      };
    }
    throw new Error(`OpenAIAdapter.execute: unknown action '${action}'`);
  }

  /**
   * Start an asynchronous generation job. Currently only supports the "image"
   * action (DALL·E). Chat remains immediate so callers should use execute().
   *
   * @param {object} params - Same params object accepted by execute(). Must
   *   include action==='image'.
   * @returns {Promise<{runId:string, meta?:object}>}
   */
  async startJob(params) {
    const { action } = params;
    if (action !== 'image') {
      throw new Error(`OpenAIAdapter.startJob only supports action 'image' at the moment`);
    }

    const { randomUUID } = require('crypto');
    const runId = randomUUID();

    // Kick off async generation but do not await
    const jobPromise = (async () => {
      try {
        const { prompt, model, size, quality, responseFormat, costTable } = params;
        const resultObj = await this.svc.generateImage({ prompt, model, size, quality, responseFormat });
        const image = resultObj.url ? { url: resultObj.url } : { b64_json: resultObj.b64_json };
        
        // Calculate cost based on costTable
        const costUsd = costTable ? this._calculateImageCost(model || 'dall-e-3', size || '1024x1024', quality || 'standard', costTable) : 0;
        
        const toolResult = { type: 'image', data: { images: [image] }, status: 'succeeded', costUsd };
        return toolResult;
      } catch (err) {
        return { type: 'image', data: null, status: 'failed', error: err.message };
      }
    })();

    // store placeholder so pollJob can check status
    this._jobs.set(runId, { promise: jobPromise });

    // When promise resolves cache result
    jobPromise.then(res => {
      const record = this._jobs.get(runId);
      if (record) {
        record.result = res;
      }
    }).catch(err => {
      const record = this._jobs.get(runId);
      if (record) {
        record.result = { type: 'image', data: null, status: 'failed', error: err.message };
      }
    });

    return { runId };
  }

  /**
   * Poll an existing asynchronous job. Returns ToolResult when ready or
   * status:'processing' if still running.
   * @param {string} runId
   * @returns {Promise<import('../adapterTypes').ToolResult>}
   */
  async pollJob(runId) {
    const record = this._jobs.get(runId);
    if (!record) {
      throw new Error(`Unknown runId ${runId}`);
    }
    if (record.result) return record.result;
    // not finished yet
    return { type: 'image', data: null, status: 'processing' };
  }

  /**
   * OpenAI image generation does not deliver webhooks. Provided for interface
   * completeness – will simply throw to indicate not supported.
   */
  parseWebhook() {
    throw new Error('parseWebhook not supported for OpenAI');
  }
}

// Create singleton and register
const openAIAdapter = new OpenAIAdapter();
registry.register('openai', openAIAdapter);
module.exports = openAIAdapter;
