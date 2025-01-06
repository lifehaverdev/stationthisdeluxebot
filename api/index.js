const express = require('express');
const router = express.Router();
const { flows, waiting } = require('../utils/bot/bot')
const { defaultUserData } = require('../utils/users/defaultUserData');
const { UserCore, UserEconomy, UserPref } = require('../db/index');
const { buildPromptObjFromWorkflow } = require('../utils/bot/prompt');
const { getDeploymentIdByType } = require('../utils/comfydeploy/deployment_ids');
const { generate } = require('../commands/make');
// Track ongoing generations
const activeGenerations = new Map();

// Image generation endpoint
router.post('/generations', async (req, res) => {
  try {
    // Get API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: "Missing or invalid Authorization header",
          type: "authentication_error"
        }
      });
    }
    const apiKey = authHeader.split(' ')[1];

    // Authenticate and get user context
    const userContext = await authenticateApiUser(apiKey);

    const { ids, inputs } = getDeploymentIdByType('MAKE');

    // Get the workflow from our flows
    const workflow = flows.find(flow => flow.name === 'MAKE'); // Default to MAKE for now
    if (!workflow) {
        return res.status(400).json({
            error: {
                message: "Invalid workflow type",
                type: "invalid_workflow_error"
            }
        });
    }

    // Create a simplified message object that mimics Telegram structure
    const message = {
        from: {
            id: userContext.userId,
            username: 'api_user',
        },
        chat: {
            id: `${userContext.userId}`
        },
        
    };

    // Set up userContext with the prompt from the request
    userContext.prompt = req.body.prompt;
    userContext.type = 'MAKE'; // Set the type in userContext
        
    // Use our existing function to build the promptObj
    const promptObj = buildPromptObjFromWorkflow(
        workflow,           // The actual workflow object from flows
        userContext,        // user context with preferences
        message            // simplified message object
    );
    
    
    // Create an API-specific task
    const apiTask = {
        message,
        promptObj,
        timestamp: Date.now(),
        isApiRequest: true, // Special flag for API requests
    };

    // Generate directly (skipping queue)
    const run_id = await generate(promptObj);

    if (run_id !== -1 && run_id !== undefined) {
        // Add to waiting array with API identifier
        waiting.push({
            ...apiTask,
            run_id,
            timestamp: Date.now(),
            isAPI: true
        });

        // Return success response
        res.status(202).json({
            status: 'processing',
            run_id,
            message: 'Generation started. You will be notified via webhook when complete.'
        });
    } else {
        throw new Error('Failed to generate run_id');
    }
    
    // Initialize generation tracking
    activeGenerations.set(runId, {
      status: 'processing',
      progress: 0,
      startTime: Date.now(),
      defaultUser,
      webhook_url
    });

    // Immediately return the run ID
    res.status(202).json({
      status: 'processing',
      run_id: runId,
      message: 'Generation started. You will be notified via webhook when complete.'
    });

    // Start the generation process asynchronously
    startGeneration(runId, prompt, defaultUser).catch(error => {
      console.error(`Generation failed for run ${runId}:`, error);
      notifyWebhook(webhook_url, {
        status: 'failed',
        run_id: runId,
        error: error.message
      });
    });

  } catch (error) {
    console.error('Error initiating generation:', error);
    res.status(500).json({
      error: {
        message: 'Failed to initiate generation',
        type: 'internal_server_error'
      }
    });
  }
});

async function startGeneration(runId, prompt, defaultUser) {
  try {
    const generation = activeGenerations.get(runId);
    
    // Your actual generation logic here
    // This will take ~90 seconds with the flux model
    
    // Update progress periodically
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 1;
      if (generation) {
        generation.progress = progress;
      }
    }, 900); // Update every 900ms to reach ~100 in 90 seconds

    // Simulate your flux model generation
    await new Promise(resolve => setTimeout(resolve, 90000));
    
    clearInterval(progressInterval);

    // Generation complete
    const result = {
      status: 'complete',
      run_id: runId,
      created: Math.floor(Date.now() / 1000),
      data: [{
        url: `https://your-storage-domain.com/images/${runId}.png`
      }]
    };

    // Notify via webhook
    if (generation && generation.webhook_url) {
      await notifyWebhook(generation.webhook_url, result);
    }

    // Clean up
    activeGenerations.delete(runId);

    return result;
  } catch (error) {
    activeGenerations.delete(runId);
    throw error;
  }
}

async function notifyWebhook(webhookUrl, data) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      console.error(`Webhook notification failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Webhook notification error:', error);
  }
}

// Progress checking endpoint
router.get('/generations/:runId', (req, res) => {
  const { runId } = req.params;
  const generation = activeGenerations.get(runId);
  
  if (!generation) {
    return res.status(404).json({
      error: {
        message: 'Generation not found or already complete',
        type: 'not_found_error'
      }
    });
  }

  res.json({
    status: generation.status,
    progress: generation.progress,
    run_id: runId
  });
});

// Pseudo code for api/index.js

async function authenticateApiUser(apiKey) {
    try {
        // 1. Search UserCore for matching API key
        // We'll need to add an apiKey field to UserCore schema
        const userCoreData = new UserCore();
        const userCore = await userCoreData.findOne({ apiKey: apiKey });
        if (!userCore) {
            throw new Error('Invalid API key');
        }

        // 2. Get user's economic data (for qoints balance)
        const userEconomyData = new UserEconomy();
        const userEconomy = await userEconomyData.findOne({ userId: userCore.userId });
        if (!userEconomy || !userEconomy.qoints || userEconomy.qoints < 50) {
            throw new Error('Insufficient qoints');
        }

        // 3. Get user's preferences (for generation settings)
        const userPrefData = new UserPref();
        const userPref = await userPrefData.findOne({ userId: userCore.userId });

        // 4. Combine into a user context object similar to what we use for Telegram
        const userContext = {
            ...defaultUserData, // Base defaults
            ...userCore,        // Core data
            ...userEconomy,     // Economic data (qoints)
            ...userPref,        // User preferences
            type: 'MAKE'        // Default type for API requests
        };

        return userContext;
    } catch (error) {
        console.error('Authentication error:', error);
        throw error;
    }
}

module.exports = router;