const axios = require('axios');
const RunPodError = require('./RunPodError');

const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// RunPod job statuses
const JobStatus = {
  IN_QUEUE: 'IN_QUEUE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED'
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RunPod Serverless API Client
 *
 * API Reference: https://docs.runpod.io/serverless/endpoints/job-operations
 *
 * Base URL: https://api.runpod.ai/v2/{ENDPOINT_ID}
 * Auth: Header "authorization: {API_KEY}"
 */
class RunPodClient {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - RunPod API key
   * @param {string} [options.apiBaseUrl] - Base URL (default: https://api.runpod.ai/v2)
   * @param {number} [options.timeoutMs] - Request timeout in ms
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ apiKey, apiBaseUrl = 'https://api.runpod.ai/v2', timeoutMs = DEFAULT_TIMEOUT_MS, logger }) {
    if (!apiKey) {
      throw new Error('RunPodClient requires an API key');
    }
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.logger = logger || console;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Create axios instance for a specific endpoint
   * RunPod requires endpoint ID in the URL path
   */
  _createHttp(endpointId) {
    return axios.create({
      baseURL: `${this.apiBaseUrl}/${endpointId}`,
      timeout: this.timeoutMs
    });
  }

  /**
   * Core request method with retry logic
   */
  async request({ endpointId, method, path = '', params, data, headers = {}, retries = 2, timeoutMs }) {
    if (!endpointId) {
      throw new Error('request requires an endpointId');
    }

    const http = this._createHttp(endpointId);
    const finalPath = path.startsWith('/') ? path : `/${path}`;
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      try {
        const response = await http.request({
          method,
          url: finalPath,
          params,
          data,
          timeout: timeoutMs || this.timeoutMs,
          headers: {
            authorization: this.apiKey, // RunPod uses lowercase, no Bearer prefix
            Accept: 'application/json',
            'Content-Type': 'application/json',
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
          `[RunPodClient] ${method} ${endpointId}${finalPath} failed (status=${status} code=${errCode || 'n/a'} msg=${error.message}) attempt=${attempt + 1}/${retries + 1}`
        );

        if (!shouldRetry) {
          throw new RunPodError(body?.error || error.message || 'RunPod request failed', {
            status,
            code: body?.error,
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

  // ==================== Job Operations ====================

  /**
   * Submit an asynchronous job
   * Returns immediately with job ID, use getStatus() to poll for results
   *
   * @param {string} endpointId - The endpoint ID
   * @param {Object} input - Job input parameters (passed to worker handler)
   * @param {Object} [options] - Additional options
   * @param {string} [options.webhook] - URL for completion callback
   * @param {Object} [options.policy] - Execution policy (timeout, ttl)
   * @param {Object} [options.s3Config] - S3 config for large payloads
   * @returns {Promise<{id: string, status: string}>}
   */
  async run(endpointId, input, options = {}) {
    const payload = { input, ...options };
    return this.request({
      endpointId,
      method: 'POST',
      path: '/run',
      data: payload
    });
  }

  /**
   * Submit a synchronous job and wait for completion
   * Blocks until job completes or times out (max ~90s recommended)
   *
   * @param {string} endpointId - The endpoint ID
   * @param {Object} input - Job input parameters
   * @param {Object} [options] - Additional options
   * @param {number} [options.timeoutMs] - Override request timeout for long jobs
   * @returns {Promise<{id: string, status: string, output: any}>}
   */
  async runSync(endpointId, input, options = {}) {
    const { timeoutMs, ...payload } = options;
    return this.request({
      endpointId,
      method: 'POST',
      path: '/runsync',
      data: { input, ...payload },
      timeoutMs: timeoutMs || 90000 // Longer timeout for sync jobs
    });
  }

  /**
   * Get job status and results
   *
   * @param {string} endpointId - The endpoint ID
   * @param {string} jobId - The job ID returned from run()
   * @returns {Promise<{id: string, status: string, output?: any, error?: string}>}
   */
  async getStatus(endpointId, jobId) {
    if (!jobId) {
      throw new Error('getStatus requires a jobId');
    }
    return this.request({
      endpointId,
      method: 'GET',
      path: `/status/${jobId}`
    });
  }

  /**
   * Cancel a queued or running job
   *
   * @param {string} endpointId - The endpoint ID
   * @param {string} jobId - The job ID to cancel
   * @returns {Promise<{id: string, status: string}>}
   */
  async cancel(endpointId, jobId) {
    if (!jobId) {
      throw new Error('cancel requires a jobId');
    }
    return this.request({
      endpointId,
      method: 'POST',
      path: `/cancel/${jobId}`
    });
  }

  /**
   * Retry a failed or timed-out job
   *
   * @param {string} endpointId - The endpoint ID
   * @param {string} jobId - The job ID to retry
   * @returns {Promise<{id: string, status: string}>}
   */
  async retry(endpointId, jobId) {
    if (!jobId) {
      throw new Error('retry requires a jobId');
    }
    return this.request({
      endpointId,
      method: 'POST',
      path: `/retry/${jobId}`
    });
  }

  /**
   * Get streaming results (for jobs with streaming enabled)
   *
   * @param {string} endpointId - The endpoint ID
   * @param {string} jobId - The job ID
   * @returns {Promise<{id: string, status: string, stream: any[]}>}
   */
  async getStream(endpointId, jobId) {
    if (!jobId) {
      throw new Error('getStream requires a jobId');
    }
    return this.request({
      endpointId,
      method: 'GET',
      path: `/stream/${jobId}`
    });
  }

  // ==================== Endpoint Operations ====================

  /**
   * Check endpoint health
   *
   * @param {string} endpointId - The endpoint ID
   * @returns {Promise<{workers: {idle: number, running: number, throttled: number}}>}
   */
  async getHealth(endpointId) {
    return this.request({
      endpointId,
      method: 'GET',
      path: '/health'
    });
  }

  /**
   * Purge all queued jobs from endpoint
   *
   * @param {string} endpointId - The endpoint ID
   * @returns {Promise<{removed: number, status: string}>}
   */
  async purgeQueue(endpointId) {
    return this.request({
      endpointId,
      method: 'POST',
      path: '/purge-queue'
    });
  }

  // ==================== Polling Helpers ====================

  /**
   * Poll for job completion with configurable interval
   *
   * @param {string} endpointId - The endpoint ID
   * @param {string} jobId - The job ID
   * @param {Object} [options]
   * @param {number} [options.intervalMs=1000] - Poll interval in ms
   * @param {number} [options.maxAttempts=300] - Max poll attempts (0 = unlimited)
   * @param {Function} [options.onStatus] - Callback on each status check
   * @returns {Promise<{id: string, status: string, output?: any, error?: string}>}
   */
  async waitForCompletion(endpointId, jobId, options = {}) {
    const { intervalMs = 1000, maxAttempts = 300, onStatus } = options;
    let attempts = 0;

    while (maxAttempts === 0 || attempts < maxAttempts) {
      const result = await this.getStatus(endpointId, jobId);

      if (onStatus) {
        onStatus(result);
      }

      if (result.status === JobStatus.COMPLETED) {
        return result;
      }

      if (result.status === JobStatus.FAILED) {
        throw new RunPodError(result.error || 'Job failed', {
          jobId,
          code: 'JOB_FAILED'
        });
      }

      if (result.status === JobStatus.TIMED_OUT) {
        throw new RunPodError('Job timed out', {
          jobId,
          code: 'JOB_TIMED_OUT'
        });
      }

      if (result.status === JobStatus.CANCELLED) {
        throw new RunPodError('Job was cancelled', {
          jobId,
          code: 'JOB_CANCELLED'
        });
      }

      await delay(intervalMs);
      attempts += 1;
    }

    throw new RunPodError(`Job did not complete within ${maxAttempts} poll attempts`, {
      jobId,
      code: 'POLL_TIMEOUT'
    });
  }
}

// Export class and constants
RunPodClient.JobStatus = JobStatus;
module.exports = RunPodClient;
