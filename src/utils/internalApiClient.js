const axios = require('axios');

// Import our custom logger
const { createLogger } = require('./logger'); // Adjusted path for new location
const logger = createLogger('internal-api-client'); // More generic logger name

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

// Optional: Add interceptors for logging or centralized error handling
const seenErrors = new Set();
const ERROR_WINDOW_MS = 1000;

function shouldLogError(key) {
  const now = Date.now();
  if (seenErrors.has(key)) {
    return false;
  }
  seenErrors.add(key);
  setTimeout(() => seenErrors.delete(key), ERROR_WINDOW_MS).unref?.();
  return true;
}

internalApiClient.interceptors.request.use(request => {
  logger.debug({
    method: request.method?.toUpperCase(),
    url: request.url,
  }, 'Starting internal API request');
  return request;
});

internalApiClient.interceptors.response.use(response => {
  logger.debug({
    status: response.status,
    url: response.config?.url,
  }, 'Internal API response');
  return response;
}, error => {
  const key = `${error.config?.method}:${error.config?.url}:${error.response?.status}:${error.config?.headers?.['x-action-id'] || ''}`;
  if (shouldLogError(key)) {
    logger.error({
      err: error,
      status: error.response ? error.response.status : null,
      method: error.config ? error.config.method?.toUpperCase() : null,
      url: error.config ? error.config.url : null,
    }, '[InternalApiClient] API call error');
  } else {
    logger.debug({
      status: error.response ? error.response.status : null,
      method: error.config ? error.config.method?.toUpperCase() : null,
      url: error.config ? error.config.url : null,
    }, '[InternalApiClient] Suppressed duplicate error');
  }
  // It's important to re-throw the error so the calling function knows it failed
  return Promise.reject(error);
});

// Add the same interceptors to the long-running client
longRunningApiClient.interceptors.request.use(request => {
  logger.debug({
    method: request.method?.toUpperCase(),
    url: request.url,
  }, 'Starting long-running internal API request');
  return request;
});

longRunningApiClient.interceptors.response.use(response => {
  logger.debug({
    status: response.status,
    url: response.config?.url,
  }, 'Long-running internal API response');
  return response;
}, error => {
  const key = `long:${error.config?.method}:${error.config?.url}:${error.response?.status}:${error.config?.headers?.['x-action-id'] || ''}`;
  if (shouldLogError(key)) {
    logger.error({
      err: error,
      status: error.response ? error.response.status : null,
      method: error.config ? error.config.method?.toUpperCase() : null,
      url: error.config ? error.config.url : null,
    }, '[LongRunningApiClient] API call error');
  } else {
    logger.debug({
      status: error.response ? error.response.status : null,
      method: error.config ? error.config.method?.toUpperCase() : null,
      url: error.config ? error.config.url : null,
    }, '[LongRunningApiClient] Suppressed duplicate error');
  }
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
    logger.info({ generationId, ratingType }, '[InternalApiClient] Successfully rated generation.');
    return response.data;
  } catch (error) {
    logger.error({ err: error, generationId }, '[InternalApiClient] Failed to rate generation');
    throw error;
  }
};

module.exports = internalApiClient;
module.exports.longRunningApiClient = longRunningApiClient; 
