/**
 * StationThis Bot - Standalone Web Interface
 * 
 * A simplified server that only runs the web interface without any Telegram integration.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

// Import the web router
const { setupWebRouter } = require('./src/integrations/web/router');

console.log('🚀 Starting StationThis Bot - Standalone Web Interface...');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Increase timeout for long-running requests
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 minutes
  next();
});

// Simple logger
const logger = {
  info: (message, data) => console.log(`[INFO] ${message}`, data || ''),
  error: (message, data) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data || '')
};

logger.info('Initializing Standalone Web Interface...');

// API routes
console.log('🌐 Setting up API routes...');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: process.env.VERSION || '1.0.0',
    components: {
      bot: false,
      webOnly: true
    },
    commands: [
      {
        name: "ping",
        description: "Simple ping command to test the API",
        category: "utility"
      },
      {
        name: "status",
        description: "Get detailed system status information",
        category: "system"
      },
      {
        name: "echo",
        description: "Echo back the message provided",
        category: "utility"
      }
    ]
  });
});

// Simple command endpoint that responds to ping and echo commands
app.post('/api/commands/:commandName', (req, res) => {
  const { commandName } = req.params;
  const userId = req.query.userId || req.headers['x-user-id'] || 'anonymous';
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  // Skip authentication for public commands or if skip auth is enabled
  const skipAuth = process.env.SKIP_AUTH === 'true' || 
                  ['ping', 'status'].includes(commandName);
  
  if (!skipAuth && apiKey !== process.env.API_KEY) {
    logger.warn(`Unauthorized API access attempt by ${userId}`, {
      apiKey,
      commandName,
      expectedApiKey: process.env.API_KEY || 'not-set'
    });
    return res.status(401).json({
      status: 'error',
      error: 'Unauthorized',
      code: 'UNAUTHORIZED'
    });
  }
  
  // Handle ping command
  if (commandName === 'ping') {
    logger.info(`Executing ping command for user ${userId}`);
    return res.json({
      status: 'ok',
      result: {
        message: 'Pong!',
        timestamp: Date.now()
      }
    });
  }
  
  // Handle status command
  if (commandName === 'status') {
    logger.info(`Executing status command for user ${userId}`);
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    return res.json({
      status: 'ok',
      result: {
        uptime: {
          total: uptime,
          formatted: `${hours}h ${minutes}m ${seconds}s`
        },
        system: {
          version: process.env.VERSION || '1.0.0',
          platform: process.platform,
          node: process.version
        },
        timestamp: Date.now()
      }
    });
  }
  
  // Handle echo command
  if (commandName === 'echo') {
    const message = req.body.message || 'No message provided';
    logger.info(`Executing echo command for user ${userId} with message "${message}"`);
    return res.json({
      status: 'ok',
      result: {
        message: message,
        timestamp: Date.now()
      }
    });
  }
  
  // Unknown command
  logger.warn(`Unknown command ${commandName} requested by user ${userId}`);
  return res.status(404).json({
    status: 'error',
    error: `Command ${commandName} not found`,
    code: 'COMMAND_NOT_FOUND'
  });
});

// Mount the web interface
console.log('  ↳ Setting up web interface...');
const webRouter = setupWebRouter({ app });
app.use('/interface', webRouter);
logger.info('Web interface mounted at /interface');
console.log('  ✓ Web interface mounted');

// Redirect root to interface
app.get('/', (req, res) => {
  res.redirect('/interface');
});

console.log('✅ Web routes configured');

// Start server
const port = process.env.PORT || 3002;
app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
  console.log(`✅ Server started on port ${port}`);
  console.log(`🌎 Web interface available at http://localhost:${port}/interface`);
  console.log('🎉 StationThis Bot - Standalone Web Interface is ready!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  logger.error('Uncaught exception', { error });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  logger.error('Unhandled rejection', { reason });
}); 