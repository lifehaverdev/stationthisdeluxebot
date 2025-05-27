const axios = require('axios');
require('dotenv').config(); // Ensure environment variables are loaded

// Import our custom logger
const { createLogger } = require('../../../utils/logger'); // Adjusted path
const logger = createLogger('internal-api-client-telegram');

const internalApiClient = axios.create({
  baseURL: process.env.INTERNAL_API_BASE_URL || 'http://localhost:4000/internal/v1/data', // Use port 4000 where the web/API server runs
  timeout: 5000, // 5 second timeout
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_TELEGRAM
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
if (!process.env.INTERNAL_API_KEY_TELEGRAM) {
  logger.error('FATAL ERROR: INTERNAL_API_KEY_TELEGRAM environment variable is not set. Telegram adapter cannot authenticate with the Internal API.');
  // Optionally, throw an error to prevent startup if this is critical
  // throw new Error('INTERNAL_API_KEY_TELEGRAM is not set.');
}

// Add a method to rate a generation
internalApiClient.rateGeneration = async function(generationId, ratingType, masterAccountId) {
  try {
    const response = await this.post(`/rate_gen/${generationId}`, {
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