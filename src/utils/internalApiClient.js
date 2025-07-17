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
    logger.info(`[InternalApiClient] Successfully rated generation ${generationId} as ${ratingType}.`);
    return response.data;
  } catch (error) {
    logger.error(`[InternalApiClient] Failed to rate generation ${generationId}: ${error.message}`);
    throw error;
  }
};

module.exports = internalApiClient; 