const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const GradioSpaceService = require('./GradioSpaceService');
const registry = require('../adapterRegistry');

// HuggingFace cost model:
// $9.99/month subscription → ~$0.333/day for 25 min (1500s) ZeroGPU inference
// Base rate: $0.000222/s. With 2× platform markup: $0.000444/s.
const HF_GPU_RATE_PER_SEC = 0.000444;

// Auto-load mappers from mappers/ directory
const mappers = {};
const mappersDir = path.join(__dirname, 'mappers');
const mapperFiles = fs.readdirSync(mappersDir).filter(f => f.endsWith('Mapper.js'));
for (const file of mapperFiles) {
  const mapper = require(path.join(mappersDir, file));
  mappers[mapper.toolId] = mapper;
}

class HuggingFaceAdapter {
  constructor() {
    /** @type {Map<string, import('./GradioSpaceService')>} */
    this._spaceCache = new Map();

    /** @type {Map<string, { promise: Promise<any>, result?: object }>} */
    this._jobs = new Map();
  }

  /**
   * Get or create a GradioSpaceService for a given space URL.
   * @param {string} spaceUrl
   * @returns {GradioSpaceService}
   */
  _getSpace(spaceUrl) {
    if (!this._spaceCache.has(spaceUrl)) {
      this._spaceCache.set(spaceUrl, new GradioSpaceService({
        spaceUrl,
        logger: console
      }));
    }
    return this._spaceCache.get(spaceUrl);
  }

  /**
   * Resolve mapper for a tool ID.
   * @param {string} toolId
   * @returns {object}
   */
  _getMapper(toolId) {
    const mapper = mappers[toolId];
    if (!mapper) throw new Error(`No mapper for HuggingFace tool: ${toolId}`);
    return mapper;
  }

  /**
   * Core dispatch: mapper.buildInput → service.invoke → mapper.parseOutput
   * @param {object} params
   * @returns {Promise<object>}
   */
  async _runTool(params) {
    const { toolId, spaceUrl, ...toolParams } = params;
    const mapper = this._getMapper(toolId);
    const service = this._getSpace(spaceUrl);

    const gradioFunction = mapper.gradioFunction || mapper.toolId;

    const startTime = Date.now();
    const dataArray = await mapper.buildInput(toolParams, service);
    const rawResult = await service.invoke(gradioFunction, dataArray, {
      timeout: mapper.sseTimeout
    });
    const durationMs = Date.now() - startTime;

    const result = mapper.parseOutput(rawResult, spaceUrl);

    // Compute cost from actual GPU execution time
    const gpuSeconds = durationMs / 1000;
    result.costUsd = gpuSeconds * HF_GPU_RATE_PER_SEC;
    result.durationMs = durationMs;

    console.log(`[HuggingFaceAdapter] ${toolId} completed in ${gpuSeconds.toFixed(1)}s, costUsd: $${result.costUsd.toFixed(4)}`);

    return result;
  }

  /**
   * Synchronous execution — runs tool and returns result.
   * @param {object} params
   * @returns {Promise<object>}
   */
  async execute(params = {}) {
    // Backward compat: if no toolId, assume joycaption
    if (!params.toolId) {
      const { imageUrl } = params;
      if (!imageUrl) throw new Error('HuggingFaceAdapter.execute requires imageUrl');
      params.toolId = 'joycaption';
      params.spaceUrl = 'https://fancyfeast-joy-caption-beta-one.hf.space';
    }

    const result = await this._runTool(params);
    result.status = 'succeeded';
    return result;
  }

  /**
   * Start an async job — returns runId immediately, executes in background.
   * @param {object} params
   * @returns {Promise<{ runId: string }>}
   */
  async startJob(params = {}) {
    // Backward compat: if no toolId, assume joycaption
    if (!params.toolId) {
      const { imageUrl } = params;
      if (!imageUrl) throw new Error('HuggingFaceAdapter.startJob requires imageUrl');
      params.toolId = 'joycaption';
      params.spaceUrl = 'https://fancyfeast-joy-caption-beta-one.hf.space';
    }

    const runId = randomUUID();

    const jobPromise = (async () => {
      try {
        const result = await this._runTool(params);
        result.status = 'succeeded';
        return result;
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

  /**
   * Poll for async job result.
   * @param {string} runId
   * @returns {Promise<object>}
   */
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
