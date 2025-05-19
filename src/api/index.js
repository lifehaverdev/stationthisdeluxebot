/**
 * API Module Index
 * 
 * Initializes and exports all API services, both internal and external
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { ObjectId } = require('mongodb');

// Assuming this is the correct path for the UserCore DB model.
// Adjust path if it is incorrect based on your project structure.
const { UserCore } = require('../core/services/db'); // Or wherever UserCore is exported

const initializeInternalServices = require('./internal'); // For initializing internal services

// const initializeInternalServices = require('./internal'); // This seems to be for setting up internal routes separately

// Commenting out problematic import - /generations endpoint might be broken until this is resolved
// const { handleApiCompletion } = require('../bot/business/queue'); 

// Track ongoing generations - specific to /generations, keep if that route is kept
const activeGenerations = new Map(); 

// Placeholder for flows, getDeploymentIdByType, buildPromptObjFromWorkflow, generate if /generations route is to be kept functional
// These would need correct imports or definitions
const flows = []; // Placeholder
const getDeploymentIdByType = () => ({ ids: [], inputs: [] }); // Placeholder
const buildPromptObjFromWorkflow = () => ({}); // Placeholder
const generate = async () => 'mock-run-id'; // Placeholder
const waiting = []; // Placeholder for /generations logic
const successors = []; // Placeholder for /generations logic


// --- Helper function to get masterAccountId from API Key (for public routes) ---
async function getMasterAccountIdForApiKey(apiKey, logger = console) {
    if (!apiKey) {
        throw new Error('API key is required.');
    }
    try {
        const userCoreDb = new UserCore({ logger });
        const user = await userCoreDb.findOne({ apiKey: apiKey });
        if (!user) {
            throw new Error('Invalid API key.');
        }
        const masterAccountId = user.masterAccountId || (user._id ? user._id.toString() : null);
        if (!masterAccountId) {
            logger.error(`[getMasterAccountIdForApiKey] User found, but no masterAccountId/ _id. API Key: ${apiKey.substring(0, 5)}...`);
            throw new Error('User identifier (masterAccountId) not found for API key.');
        }
        return masterAccountId;
    } catch (error) {
        logger.error(`[getMasterAccountIdForApiKey] Error: ${error.message}. API Key: ${apiKey.substring(0,5)}...`);
        if (error.message === 'Invalid API key.' || error.message.includes('User identifier (masterAccountId) not found')) {
            throw error; 
        }
        throw new Error('Error validating API key and retrieving user identifier.');
    }
}

// Public Image Generation Endpoint (potentially broken due to handleApiCompletion)
router.post('/generations', async (req, res) => {
  const logger = req.app.locals.logger || console;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: "Missing or invalid Authorization header", type: "authentication_error" } });
    }
    const apiKey = authHeader.split(' ')[1];
    const userContext = await authenticateApiUser(apiKey, logger);

    // --- Original /generations logic below - may need adjustments for missing dependencies ---
    // const { ids, inputs } = getDeploymentIdByType('MAKE'); // Placeholder
    // const workflow = flows.find(flow => flow.name === 'MAKE'); // Placeholder
    // if (!workflow) {
    //     return res.status(400).json({ error: { message: "Invalid workflow type", type: "invalid_workflow_error" } });
    // }
    // const message = { from: { id: userContext.userId, username: 'api_user' }, chat: { id: `${userContext.userId}` } };
    // userContext.prompt = req.body.prompt;
    // userContext.type = 'MAKE';
    // const promptObj = buildPromptObjFromWorkflow(workflow, userContext, message); // Placeholder
    // promptObj.isAPI = true;
    // const apiTask = { message, promptObj, timestamp: Date.now(), isApiRequest: true };
    // const run_id = await generate(promptObj); // Placeholder
    // if (run_id !== -1 && run_id !== undefined) {
    //     waiting.push({ ...apiTask, run_id, timestamp: Date.now(), isAPI: true, awaitedRequest: req.body.wait === true });
    //     if (req.body.wait === true) {
    //         // ... (logic for waiting, using handleApiCompletion - currently commented out) ...
    //         return res.status(501).json({ message: "Synchronous wait is temporarily unavailable." }); 
    //     }
    // }
    // res.status(202).json({ status: 'processing', run_id, message: 'Generation started.' });
    // --- End of original /generations logic ---
    return res.status(501).json({ error: { message: "/generations endpoint is temporarily under maintenance due to dependency issues.", type: "maintenance" } });

  } catch (error) {
    logger.error('Error in /generations endpoint:', error.message);
    let statusCode = 500;
    if (error.message.includes('Invalid API key') || error.message.includes('Insufficient qoints')) {
        statusCode = 401;
    }
    res.status(statusCode).json({ error: { message: error.message || 'Failed to initiate generation', type: 'internal_server_error' } });
  }
});

// Public Progress Checking Endpoint (part of original /generations suite)
router.get('/generations/:runId', (req, res) => {
  // const { runId } = req.params;
  // const generation = activeGenerations.get(runId);
  // if (!generation) {
  //   return res.status(404).json({ error: { message: 'Generation not found or already complete', type: 'not_found_error' } });
  // }
  // res.json({ status: generation.status, progress: generation.progress, run_id: runId });
  return res.status(501).json({ error: { message: "/generations/:runId endpoint is temporarily under maintenance.", type: "maintenance" } });
});

// New Public Status Report Endpoint
router.get('/me/status-report', async (req, res) => {
  const logger = req.app.locals.logger || console;
  let masterAccountIdForLog = 'unknown_user';

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: "Missing or invalid Authorization header.", type: "authentication_error" } });
    }
    const apiKey = authHeader.split(' ')[1];
    
    const masterAccountId = await getMasterAccountIdForApiKey(apiKey, logger);
    masterAccountIdForLog = masterAccountId;

    const internalApiCaller = axios.create({
      baseURL: process.env.INTERNAL_API_BASE_URL_FROM_PUBLIC || 'http://localhost:4000/internal',
      timeout: process.env.INTERNAL_API_TIMEOUT_MS || 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    logger.info(`[publicStatusApi] Calling internal status for masterAccountId: ${masterAccountId}`);
    const statusReportResponse = await internalApiCaller.get(`/v1/data/users/${masterAccountId}/status-report`);
    
    res.status(200).json(statusReportResponse.data);

  } catch (error) {
    let statusCode = 500;
    let errorMessage = 'Failed to get status report.';
    let errorType = 'internal_server_error';

    if (error.message && (error.message.includes('Invalid API key') || error.message.includes('User identifier (masterAccountId) not found') || error.message.includes('API key is required'))) {
      statusCode = 401;
      errorMessage = error.message;
      errorType = 'authentication_error';
    } else if (error.isAxiosError && error.response) {
      logger.error(`[publicStatusApi] Error from internal API for ${masterAccountIdForLog}: ${error.response.status}`, error.response.data);
      statusCode = error.response.status >= 500 ? 502 : error.response.status; 
      errorMessage = `Internal service error (${error.response.status}).`;
      errorType = 'downstream_service_error';
    } else {
      logger.error(`[publicStatusApi] Generic error for ${masterAccountIdForLog}:`, error);
    }
    
    res.status(statusCode).json({ error: { message: errorMessage, type: errorType } });
  }
});

// This was the original export in the user-provided file that I based the edit on.
// If the app expects initializeAPI, this needs to be re-evaluated.
// For now, exporting the router directly as is common for Express route modules.
module.exports = router;

// The initializeAPI function from the original file structure, if needed elsewhere or for internal setup:
/*
const initializeInternalServices = require('./internal');
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
    internal: internalServices,
    publicApiRouter: router // Export the public router if this function is the main entry point
  };
}
// If initializeAPI is the main export: 
// module.exports = { initializeAPI };
*/ 

// --- Main initializeAPI function to be exported ---
function initializeAPI(options = {}) {
  const { 
    logger = console,
    // appStartTime, // These were passed to internalServices, ensure they are needed/provided by options
    // version, 
    db // db services are needed by internalServices
  } = options;
  
  // Initialize internal API services
  // Ensure initializeInternalServices receives all its required dependencies from 'options'
  const internalServices = initializeInternalServices({
    logger,
    appStartTime: options.appStartTime || new Date(), // Pass through or default
    version: options.version || process.env.APP_VERSION || '1.0.0', // Pass through or default
    db: db 
  });
  
  return {
    internal: internalServices, // Contains { router: mainInternalRouter, client: apiClient, status: statusService }
    publicApiRouter: router     // The router defined above for public APIs like /me/status-report
  };
}

module.exports = { initializeAPI }; 