/**
 * API Entry Point
 * 
 * This module sets up the Express API server and routes.
 * It provides HTTP access to the internal API functionality.
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Logger } = require('../utils/logger');
const internalAPI = require('../core/internalAPI');
const { SessionManager } = require('../core/session/manager');
const webhookRoutes = require('./routes/webhookRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const { flows, waiting, successors } = require('../bot/core/core')
const { sendPrivateMessage } = require('../bot/utils')
const { defaultUserData } = require('../bot/core/users/defaultUserData');
const { UserCore, UserEconomy, UserPref } = require('../db/index');
const { buildPromptObjFromWorkflow } = require('../bot/generation/prompt');
const { getDeploymentIdByType } = require('../comfyuideploy/deployment_ids');
const { generate } = require('../services/make');
const { handleApiCompletion } = require('../bot/business/queue');
// Track ongoing generations
const activeGenerations = new Map();

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'api'
});

/**
 * Create and configure API server
 * @param {Object} options - API server options
 * @param {SessionManager} options.sessionManager - Session manager instance
 * @returns {Object} - Express app instance
 */
function createAPIServer(options = {}) {
  // Get session manager from options or create new one
  const sessionManager = options.sessionManager || new SessionManager();

  // Initialize internal API
  internalAPI.setup({
    sessionManager
  });

  // Create Express app
  const app = express();

  // Configure middleware
  app.use(cors());
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    next();
  });

  // Mount routes
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/services', serviceRoutes);

  // API routes
  app.post('/api/commands/:command', async (req, res) => {
    try {
      const { command } = req.params;
      const { args = {}, userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          status: 'error',
          error: 'userId is required'
        });
      }

      const result = await internalAPI.runCommand(command, args, { userId });
      res.json(result);
    } catch (error) {
      logger.error('Error in command endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  app.get('/api/users/:userId/session', async (req, res) => {
    try {
      const { userId } = req.params;
      const result = await internalAPI.getSession(userId);
      res.json(result);
    } catch (error) {
      logger.error('Error in session endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  app.post('/api/users/:userId/tasks', async (req, res) => {
    try {
      const { userId } = req.params;
      const { taskName, payload = {} } = req.body;

      if (!taskName) {
        return res.status(400).json({
          status: 'error',
          error: 'taskName is required'
        });
      }

      const result = await internalAPI.startTask(taskName, payload, { userId });
      res.json(result);
    } catch (error) {
      logger.error('Error in task endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const userData = req.body;
      const result = await internalAPI.createUser(userData);
      res.json(result);
    } catch (error) {
      logger.error('Error in create user endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  app.put('/api/users/:userId/preferences', async (req, res) => {
    try {
      const { userId } = req.params;
      const preferences = req.body;
      const result = await internalAPI.updateUserPreferences(userId, preferences);
      res.json(result);
    } catch (error) {
      logger.error('Error in update preferences endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  app.get('/api/users/:userId/credit', async (req, res) => {
    try {
      const { userId } = req.params;
      const result = await internalAPI.getUserCredit(userId);
      res.json(result);
    } catch (error) {
      logger.error('Error in get credit endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  app.post('/api/users/:userId/credit', async (req, res) => {
    try {
      const { userId } = req.params;
      const { amount, source } = req.body;

      if (!amount || typeof amount !== 'number') {
        return res.status(400).json({
          status: 'error',
          error: 'amount is required and must be a number'
        });
      }

      const result = await internalAPI.addUserCredit(userId, amount, source);
      res.json(result);
    } catch (error) {
      logger.error('Error in add credit endpoint', { error });
      res.status(500).json({
        status: 'error',
        error: error.message || 'Internal server error'
      });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err });
    res.status(500).json({
      status: 'error',
      error: err.message || 'Internal server error'
    });
  });

  return app;
}

module.exports = {
  createAPIServer
};