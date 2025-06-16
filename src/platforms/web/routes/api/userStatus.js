const express = require('express');

// This module exports a function that creates and returns the router.
// Dependencies (like auth function, internal API client, logger, db services) are passed in.
module.exports = function createUserStatusApiRoutes(dependencies) {
  const { internalApiClient, logger /*, userCoreDb */ } = dependencies; // userCoreDb no longer needed here directly
  const router = express.Router();

  // Check for essential dependencies for this specific router
  if (!internalApiClient || !logger) {
    const errorMsg = '[userStatusApi] Missing critical dependencies (internalApiClient or logger). Endpoint will not function.';
    if (logger && typeof logger.error === 'function') {
      logger.error(errorMsg);
    } else {
      console.error(errorMsg);
    }
    router.use((req, res) => res.status(503).json({ error: 'Service configuration error for user status API.' }));
    return router;
  }
  
  // API Key Authentication is now done via an internal API call
  // async function authenticateUserByApiKey(apiKey) { ... } // This local function is removed

  router.get('/status', async (req, res) => {
    const authHeader = req.headers.authorization;
    let presentedApiKey;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      presentedApiKey = authHeader.split(' ')[1];
    }

    if (!presentedApiKey) {
      return res.status(401).json({ error: 'Authorization header with Bearer token is required.' });
    }

    let masterAccountId;

    try {
      // Step 1: Authenticate API Key via Internal Auth Endpoint
      logger.info('[userStatusApi] Attempting to validate API key via internal endpoint...');
      const authResponse = await internalApiClient.post('/internal/v1/data/users/apikeys/validate-token', 
        { apiKey: presentedApiKey }, 
        {
          headers: {
            'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB
          }
        }
      );

      if (authResponse.data && authResponse.data.masterAccountId) {
        masterAccountId = authResponse.data.masterAccountId;
        logger.info(`[userStatusApi] API key validated. MasterAccountId: ${masterAccountId}`);
      } else {
        // Should not happen if internal API returns proper 401/error structure, but as a safeguard:
        logger.warn('[userStatusApi] API key validation via internal endpoint did not return masterAccountId.');
        return res.status(403).json({ error: 'Invalid API key or user not found (auth failed internally).' });
      }

    } catch (authError) {
      logger.warn('[userStatusApi] Authentication failed via internal /validate-token endpoint: ' + (authError.response ? JSON.stringify(authError.response.data) : authError.message));
      const statusCode = authError.response && authError.response.status ? authError.response.status : 403;
      const errorMessage = authError.response && authError.response.data && authError.response.data.error ? authError.response.data.error.message : 'Invalid API key or permission denied.';
      return res.status(statusCode).json({ error: errorMessage });
    }
    
    // If authentication was successful and we have masterAccountId, proceed to get status report
    try {
      logger.info(`[userStatusApi] Authenticated user ${masterAccountId}. Fetching status report via internal API...`);

      const internalStatusPath = `/internal/v1/data/users/${masterAccountId}/status-report`;
      const statusReportResponse = await internalApiClient.get(internalStatusPath, {
        headers: {
          'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB 
        }
      });
      
      res.status(statusReportResponse.status).json(statusReportResponse.data);

    } catch (error) {
      const reqIdForLog = req.id || 'unknown-req';
      logger.error('[userStatusApi] Error processing /status for reqId ' + reqIdForLog + ' after successful auth:', error.response ? { status: error.response.status, data: error.response.data } : error.message, error.stack ? error.stack.substring(0, 300):'');
      
      if (error.response && error.response.status) {
         return res.status(error.response.status).json(error.response.data || { error: 'Failed to retrieve user status due to an upstream error.' });
      }
      res.status(500).json({ error: 'Failed to retrieve user status due to an internal server error after authentication.' });
    }
  });
  return router;
} 