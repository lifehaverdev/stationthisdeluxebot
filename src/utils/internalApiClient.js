const axios = require('axios');

// Import our custom logger
const { createLogger } = require('./logger'); // Adjusted path for new location
const logger = createLogger('internal-api-client'); // More generic logger name

// Retry configuration for transient failures (503, 502, 504, network errors)
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
  retryableStatuses: [502, 503, 504],
  isRetryableError: (error) => {
    // Retry on network errors (no response)
    if (!error.response) return true;
    // Retry on transient HTTP status codes
    return RETRY_CONFIG.retryableStatuses.includes(error.response.status);
  }
};

/**
 * Creates a retry interceptor for axios
 * @param {object} client - The axios instance
 */
function addRetryInterceptor(client) {
  client.interceptors.response.use(null, async (error) => {
    const config = error.config;

    // Initialize retry count
    config.__retryCount = config.__retryCount || 0;

    // Check if we should retry
    if (config.__retryCount < RETRY_CONFIG.maxRetries && RETRY_CONFIG.isRetryableError(error)) {
      config.__retryCount += 1;

      // Calculate delay with exponential backoff
      const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, config.__retryCount - 1);

      logger.warn(`[InternalApiClient] Retrying request (attempt ${config.__retryCount}/${RETRY_CONFIG.maxRetries}) after ${delay}ms: ${config.method?.toUpperCase()} ${config.url}`, {
        status: error.response?.status,
        message: error.message
      });

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

      // Retry the request
      return client.request(config);
    }

    // Max retries exceeded or non-retryable error
    return Promise.reject(error);
  });
}

const internalApiClient = axios.create({
  baseURL: process.env.INTERNAL_API_BASE_URL || 'http://localhost:4000', // The base URL of the web/API server. Services will add the full path.
  timeout: 15000, // 15 second timeout
  headers: {
    'Content-Type': 'application/json',
    // IMPORTANT: Consider if this key should be more generic or configurable if different services need different keys
    'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_GENERAL || process.env.INTERNAL_API_KEY_TELEGRAM 
  }
});

// Create a separate client for long-running operations like salt mining
const longRunningApiClient = axios.create({
  baseURL: process.env.INTERNAL_API_BASE_URL || 'http://localhost:4000',
  timeout: 120000, // 2 minute timeout for salt mining operations
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_GENERAL || process.env.INTERNAL_API_KEY_TELEGRAM 
  }
});

// Add retry interceptors for transient failures (must be added before error logging interceptor)
addRetryInterceptor(internalApiClient);
addRetryInterceptor(longRunningApiClient);

// Optional: Add interceptors for logging or centralized error handling
internalApiClient.interceptors.request.use(request => {
  logger.debug('Starting Internal API Request:', { method: request.method.toUpperCase(), url: request.url, data: request.data });
  return request;
});

internalApiClient.interceptors.response.use(response => {
  logger.debug('Internal API Response Status:', { status: response.status, data: response.data });
  return response;
}, error => {
  logger.error('[InternalApiClient] API Call Error:', { 
    message: error.message,
    status: error.response ? error.response.status : null,
    method: error.config ? error.config.method.toUpperCase() : null,
    url: error.config ? error.config.url : null,
    responseData: error.response ? error.response.data : null
  });
  // It's important to re-throw the error so the calling function knows it failed
  return Promise.reject(error);
});

// Add the same interceptors to the long-running client
longRunningApiClient.interceptors.request.use(request => {
  logger.debug('Starting Long-Running Internal API Request:', { method: request.method.toUpperCase(), url: request.url, data: request.data });
  return request;
});

longRunningApiClient.interceptors.response.use(response => {
  logger.debug('Long-Running Internal API Response Status:', { status: response.status, data: response.data });
  return response;
}, error => {
  logger.error('[LongRunningApiClient] API Call Error:', { 
    message: error.message,
    status: error.response ? error.response.status : null,
    method: error.config ? error.config.method.toUpperCase() : null,
    url: error.config ? error.config.url : null,
    responseData: error.response ? error.response.data : null
  });
  return Promise.reject(error);
});

// Check if the API key is configured
// Consider making this check more generic or allowing for different key names
if (!internalApiClient.defaults.headers['X-Internal-Client-Key']) {
  logger.error('FATAL ERROR: An INTERNAL_API_KEY (e.g., INTERNAL_API_KEY_GENERAL or INTERNAL_API_KEY_TELEGRAM) environment variable is not set. API client cannot authenticate.');
  // Optionally, throw an error to prevent startup if this is critical
  // throw new Error('Internal API Key is not set.');
}

// Add a method to rate a generation (keeping it for now, can be refactored later if needed)
internalApiClient.rateGeneration = async function(generationId, ratingType, masterAccountId) {
  try {
    const response = await this.post(`/generations/rate_gen/${generationId}`, {
      ratingType,
      masterAccountId
    });
    logger.debug(`[InternalApiClient] Successfully rated generation ${generationId} as ${ratingType}.`);
    return response.data;
  } catch (error) {
    logger.error(`[InternalApiClient] Failed to rate generation ${generationId}: ${error.message}`);
    throw error;
  }
};

module.exports = internalApiClient;
module.exports.longRunningApiClient = longRunningApiClient; 