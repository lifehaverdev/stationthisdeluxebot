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
   * Execute an immediate OpenAI operation.
   * @param {object} params - Inputs for the tool.
   * @param {'chat'|'image'} params.action - Which OpenAI endpoint to hit.
   * For chat: prompt, instructions, temperature, model; for image: prompt, model, size, quality, responseFormat.
   * @returns {Promise<import('../adapterTypes').ToolResult>}
   */
  async execute(params) {
    const { action = 'chat' } = params;
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
        const { prompt, model, size, quality, responseFormat } = params;
        const resultObj = await this.svc.generateImage({ prompt, model, size, quality, responseFormat });
        const image = resultObj.url ? { url: resultObj.url } : { b64_json: resultObj.b64_json };
        const toolResult = { type: 'image', data: { images: [image] }, status: 'succeeded', costUsd: 0 };
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
