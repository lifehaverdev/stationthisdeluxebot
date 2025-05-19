/**
 * API Module Index
 * 
 * Initializes and exports all API services, both internal and external
 */

const initializeInternalServices = require('./internal');
const { handleApiCompletion } = require('../bot/business/queue');
// Track ongoing generations
const activeGenerations = new Map();

// Import axios for making internal HTTP calls
const axios = require('axios');
const { ObjectId } = require('mongodb'); // Required if we re-implement logic, but also good for authenticateApiUser if it uses it.

/**
 * Initialize all API services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized API services
 */
function initializeAPI(options = {}) {
  const { 
    logger = console,
    appStartTime = new Date(),
    version = process.env.APP_VERSION || '1.0.0'
  } = options;
  
  // Initialize internal API services
  const internalServices = initializeInternalServices({
    logger,
    appStartTime,
    version,
    db: options.db
  });
  
  return {
    internal: internalServices
  };
}

// Image generation endpoint
router.post('/generations', async (req, res) => {
// ... existing code ...
});

// Progress checking endpoint
router.get('/generations/:runId', (req, res) => {
// ... existing code ...
});

// New Public Status Report Endpoint
router.get('/me/status-report', async (req, res) => {
  const { logger } = req.app.locals; // Assuming logger is available on app.locals

  try {
    // 1. Get API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: "Missing or invalid Authorization header. Expected: Bearer <YOUR_API_KEY>",
          type: "authentication_error"
        }
      });
    }
    const apiKey = authHeader.split(' ')[1];

    // 2. Authenticate and get user context (this should give masterAccountId)
    // Assuming authenticateApiUser is defined in this file and works by looking up apiKey in userCore
    const userContext = await authenticateApiUser(apiKey); 
    
    if (!userContext || !userContext.masterAccountId) {
      if (logger) logger.error('[publicStatusApi] Failed to get masterAccountId from authenticated user.');
      // Don't reveal if API key was valid but masterAccountId was missing for some reason
      return res.status(401).json({ 
        error: {
          message: "Authentication failed or user identifier not found.",
          type: "authentication_error"
        }
      });
    }
    const masterAccountId = userContext.masterAccountId;

    // 3. Fetch status report by calling the internal API
    // Define the internal API client here or get it from dependencies if app is structured for it.
    // For now, creating a new instance:
    const internalApiCaller = axios.create({
      baseURL: process.env.INTERNAL_API_BASE_URL_FROM_PUBLIC || 'http://localhost:4000/internal', // Adjust if needed
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        // Optional: If internal endpoints check for a specific key even for intra-app calls
        // 'X-Internal-Service-Key': process.env.SOME_INTERNAL_SERVICE_KEY 
      }
    });

    const statusReportResponse = await internalApiCaller.get(`/v1/data/users/${masterAccountId}/status-report`);
    
    res.status(200).json(statusReportResponse.data);

  } catch (error) {
    let statusCode = 500;
    let errorMessage = 'Failed to get status report due to an internal server error.';
    let errorType = 'internal_server_error';

    if (error.message && (error.message.includes('Invalid API key') || error.message.includes('Authentication failed'))) {
      statusCode = 401;
      errorMessage = error.message;
      errorType = 'authentication_error';
    } else if (error.message && error.message.includes('Insufficient qoints')) {
        statusCode = 403; // Forbidden, not just unauthorized
        errorMessage = error.message;
        errorType = 'insufficient_funds_error';
    } else if (error.isAxiosError && error.response) {
      // Error from calling the internal API
      if (logger) logger.error(`[publicStatusApi] Error calling internal status API for ${userContext ? userContext.masterAccountId : 'unknown_user'}: ${error.response.status}`, error.response.data);
      statusCode = error.response.status >= 500 ? 502 : error.response.status; // 502 Bad Gateway if internal service fails
      errorMessage = `Failed to retrieve status details. Internal service responded with ${error.response.status}.`;
      errorType = 'downstream_service_error';
    } else {
      // Generic internal error
      if (logger) logger.error('[publicStatusApi] Error processing /me/status-report:', error);
    }
    
    res.status(statusCode).json({ 
      error: {
        message: errorMessage,
        type: errorType
      }
    });
  }
});

module.exports = router; 