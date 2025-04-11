/**
 * Web Command Route
 * 
 * Provides Express route handlers for executing commands via the internal API.
 */

const express = require('express');
const { runCommand, getSession } = require('../../core/internalAPI');
const { Logger } = require('../../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'web-command'
});

// Create router
const router = express.Router();

/**
 * Simple API key validation middleware
 * This is a basic implementation for MVP purposes
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    logger.warn('Unauthorized API access attempt', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    return res.status(401).json({
      status: 'error',
      error: 'Unauthorized',
      code: 'UNAUTHORIZED'
    });
  }
  
  next();
}

// Apply auth middleware to all routes
router.use(apiKeyAuth);

/**
 * Execute a command
 * POST /api/commands/:commandName
 */
router.post('/:commandName', async (req, res) => {
  const { commandName } = req.params;
  const args = req.body || {};
  
  // Get user ID from request
  // This could come from a session, token, or query parameter
  const userId = req.headers['x-user-id'] || req.query.userId;
  
  if (!userId) {
    return res.status(400).json({
      status: 'error',
      error: 'User ID is required',
      code: 'MISSING_USER_ID'
    });
  }
  
  // Prepare session context
  const sessionContext = {
    userId,
    userInfo: {
      // Additional user info could be added here
      ip: req.ip
    },
    platform: {
      type: 'web',
      request: {
        id: req.id,
        method: req.method,
        path: req.path
      }
    }
  };
  
  try {
    // Execute command through internal API
    const result = await runCommand(commandName, args, sessionContext);
    
    // Return the result
    res.status(result.status === 'ok' ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Command route error', { error, commandName, userId });
    
    res.status(500).json({
      status: 'error',
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * Get session data
 * GET /api/commands/session/:userId
 */
router.get('/session/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    // Get session through internal API
    const result = await getSession(userId);
    
    // Return the result
    res.status(result.status === 'ok' ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Session route error', { error, userId });
    
    res.status(500).json({
      status: 'error',
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router; 