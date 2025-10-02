const HuggingFaceService = require('./huggingfaceService');
const registry = require('../adapterRegistry');

class HuggingFaceAdapter {
  constructor() {
    this.svc = new HuggingFaceService({ logger: console });

    /** @type {Map<string, { promise: Promise<any>, result?: import('../adapterTypes').ToolResult }> } */
    this._jobs = new Map();
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
    const costUsd = 0.0019; // static cost per request per tool definition
    return { type: 'text', data: { text: [description] }, status: 'succeeded', costUsd };
  }

  async startJob(params) {
    const { imageUrl } = params;
    if (!imageUrl) throw new Error('HuggingFaceAdapter.startJob requires imageUrl');

    const { randomUUID } = require('crypto');
    const runId = randomUUID();

    const jobPromise = (async () => {
      try {
        const description = await this.svc.interrogateImage({ imageUrl });
        const costUsd = 0.0019;
        return { type: 'text', data: { text: [description] }, status: 'succeeded', costUsd };
      } catch (err) {
        return { type: 'text', data: null, status: 'failed', error: err.message };
      }
    })();

    this._jobs.set(runId, { promise: jobPromise });
    jobPromise.then(res => {
      const rec = this._jobs.get(runId);
      if (rec) rec.result = res;
    }).catch(err => {
      const rec = this._jobs.get(runId);
      if (rec) rec.result = { type: 'text', data: null, status: 'failed', error: err.message };
    });

    return { runId };
  }

  async pollJob(runId) {
    const rec = this._jobs.get(runId);
    if (!rec) throw new Error(`Unknown runId ${runId}`);
    if (rec.result) return rec.result;
    return { type: 'text', data: null, status: 'processing' };
  }

  parseWebhook() {
    throw new Error('parseWebhook not supported for HuggingFace');
  }
}

const adapter = new HuggingFaceAdapter();
registry.register('huggingface', adapter);
module.exports = adapter;
