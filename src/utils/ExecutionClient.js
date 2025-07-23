// Core ExecutionClient – platform-agnostic
// Usage: new ExecutionClient({ baseUrl, authStrategy, fetchImpl, logger }).execute({ toolId, inputs, user, ... })

/* eslint-disable camelcase */
const DEFAULT_NORMALISER = (raw) => {
  const final = raw.status === 'completed' || raw.deliveryMode === 'immediate';
  const outputs = raw.outputs || (raw.response ? { response: raw.response } : undefined);
  return {
    final,
    status: raw.status,
    generationId: raw.generationId,
    outputs,
    service: raw.service,
    toolId: raw.toolId,
  };
};

class ExecutionError extends Error {
  constructor(message, statusCode, payload) {
    super(message);
    this.name = 'ExecutionError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

class ExecutionClient {
  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl               Root URL (no trailing slash) leading to the /execute endpoint.
   * @param {() => Promise<Object>|() => Object} [opts.authStrategy]  Returns extra headers (e.g. API-Key, CSRF).
   * @param {Function} [opts.fetchImpl]         fetch implementation (window.fetch or node-fetch)
   * @param {Function} [opts.normaliser]        Function to convert raw response → uniform envelope
   * @param {Object}   [opts.logger]            Logger with info/warn/error methods
   */
  constructor({ baseUrl, authStrategy, fetchImpl, normaliser, logger } = {}) {
    if (!baseUrl) throw new Error('ExecutionClient requires a baseUrl');
    this.baseUrl = baseUrl.replace(/\/$/, ''); // remove trailing slash
    this.authStrategy = authStrategy || (() => ({}));
    // Lazy import node-fetch if not supplied and not in browser
    if (!fetchImpl) {
      if (typeof window !== 'undefined' && window.fetch) {
        this.fetch = window.fetch.bind(window);
      } else {
        // eslint-disable-next-line global-require
        this.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
      }
    } else {
      this.fetch = fetchImpl;
    }
    this.normalise = normaliser || DEFAULT_NORMALISER;
    this.logger = logger || console;
  }

  /**
   * Execute a generation request.
   * @param {Object} params
   * @param {string} params.toolId
   * @param {Object} params.inputs
   * @param {Object} params.user    Should minimally contain masterAccountId or userId
   * @param {string} [params.sessionId]
   * @param {string} [params.eventId]
   * @param {Object} [params.metadata]
   * @returns {Promise<Object>} Normalised envelope { final, status, outputs, generationId, ... }
   */
  async execute(params = {}) {
    const headers = { 'Content-Type': 'application/json', ...(await this._resolveAuthHeaders()) };
    const res = await this.fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
      credentials: 'include', // harmless in node
    });
    let json;
    try {
      json = await res.json();
    } catch (err) {
      json = { error: { message: 'Invalid JSON response' } };
    }

    if (!res.ok) {
      const message = json.error?.message || `Execution failed with status ${res.status}`;
      throw new ExecutionError(message, res.status, json);
    }
    return this.normalise(json);
  }

  async _resolveAuthHeaders() {
    try {
      const extra = await this.authStrategy();
      if (extra && typeof extra === 'object') return extra;
      return {};
    } catch (err) {
      this.logger.warn('[ExecutionClient] authStrategy threw:', err);
      return {};
    }
  }
}

module.exports = { ExecutionClient, ExecutionError }; 