const axios = require('axios');
require('dotenv').config(); // Ensure environment variables are loaded

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
  // console.log('Starting Internal API Request:', request.method.toUpperCase(), request.url);
  // console.log('Data:', request.data);
  return request;
});

internalApiClient.interceptors.response.use(response => {
  // console.log('Internal API Response Status:', response.status);
  // console.log('Response Data:', response.data);
  return response;
}, error => {
  console.error('[InternalApiClient] API Call Error:', error.response ? `${error.response.status} ${error.config.method.toUpperCase()} ${error.config.url}` : error.message);
  if (error.response) {
    console.error('[InternalApiClient] Error Data:', error.response.data);
  }
  // It's important to re-throw the error so the calling function knows it failed
  return Promise.reject(error);
});

// Check if the API key is configured
if (!process.env.INTERNAL_API_KEY_TELEGRAM) {
  console.error('FATAL ERROR: INTERNAL_API_KEY_TELEGRAM environment variable is not set. Telegram adapter cannot authenticate with the Internal API.');
  // Optionally, throw an error to prevent startup if this is critical
  // throw new Error('INTERNAL_API_KEY_TELEGRAM is not set.');
}

module.exports = internalApiClient; 