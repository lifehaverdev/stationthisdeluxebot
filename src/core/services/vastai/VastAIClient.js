const axios = require('axios');
const VastAIError = require('./VastAIError');

const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class VastAIClient {
  constructor({ apiKey, apiBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, logger }) {
    if (!apiKey) {
      throw new Error('VastAIClient requires an API key');
    }
    this.apiKey = apiKey;
    this.logger = logger || console;
    this.http = axios.create({
      baseURL: apiBaseUrl.replace(/\/$/, ''),
      timeout: timeoutMs
    });
  }

  async request({ method, url, params, data, headers = {}, retries = 2 }) {
    const finalUrl = url.startsWith('/') ? url : `/${url}`;
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      try {
        const response = await this.http.request({
          method,
          url: finalUrl,
          params,
          data,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            ...headers
          }
        });
        return response.data;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const errCode = error.code || error.response?.data?.error;
        const shouldRetry = RETRYABLE_STATUS.has(status) && attempt < retries;
        const body = error.response?.data;
        this.logger.warn(
          `[VastAIClient] ${method} ${finalUrl} failed (status=${status} code=${errCode || 'n/a'} msg=${error.message}) attempt=${attempt + 1}/${retries + 1}`
        );
        if (!shouldRetry) {
          throw new VastAIError(body?.msg || error.message || 'VastAI request failed', {
            status,
            code: body?.error || body?.code,
            requestId: error.response?.headers?.['x-request-id'],
            cause: error
          });
        }
        const backoff = 2 ** attempt * 250;
        await delay(backoff);
        attempt += 1;
      }
    }

    throw lastError;
  }

  async searchOffers(body = {}) {
    return this.request({
      method: 'PUT',
      url: '/search/asks/',
      data: body,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async listTemplates(params = {}) {
    return this.request({ method: 'GET', url: '/templates/', params });
  }

  async getAccount() {
    return this.request({ method: 'GET', url: '/users/current/' });
  }

  async listKeys() {
    return this.request({ method: 'GET', url: '/keys/' });
  }

  async createInstance(offerId, payload) {
    if (!offerId) {
      throw new Error('createInstance requires an offerId');
    }
    return this.request({
      method: 'PUT',
      url: `/asks/${offerId}/`,
      data: payload,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getInstance(instanceId) {
    return this.request({ method: 'GET', url: `/instances/${instanceId}/` });
  }

  async deleteInstance(instanceId) {
    return this.request({ method: 'DELETE', url: `/instances/${instanceId}/` });
  }

  async stopInstance(instanceId) {
    return this.request({ method: 'POST', url: `/instances/${instanceId}/stop/` });
  }

  async listInstances(params = {}) {
    return this.request({ method: 'GET', url: '/instances/', params });
  }

  async attachSshKey(instanceId, sshKey) {
    return this.request({
      method: 'POST',
      url: `/instances/${instanceId}/ssh/`,
      data: { ssh_key: sshKey },
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

module.exports = VastAIClient;
