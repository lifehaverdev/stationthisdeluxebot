/**
 * StationThis Bot - New Architecture Entry Point
 * 
 * This is the main entry point for the refactored bot architecture.
 * It initializes all the components from the new architecture and
 * starts the Express server for webhooks.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { bootstrap, featureFlags } = require('./bootstrap');
const { CommandRegistry } = require('./core/command/registry');
const { WorkflowManager } = require('./core/workflow/manager');
const { SessionManager } = require('./core/session/manager');
const { Logger } = require('./utils/logger');
const { AppError } = require('./core/shared/errors/AppError');
const AccountPointsService = require('./core/account/points');
const { createAccountPointsWorkflow } = require('./core/workflow/workflows/accountPoints');
const { registerAccountCommands } = require('./commands/accountCommands');
const { initializeTelegramIntegration } = require('./integrations/telegram');

console.log('🚀 Starting StationThis Bot with new architecture...');
console.log('📦 Loading environment variables and dependencies...');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Increase timeout for long-running requests
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 minutes
  next();
});

// Create logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'stationthisbot'
});

logger.info('Initializing StationThis Bot with new architecture...');
console.log('🔍 Logging system initialized');

// Create Telegram bot instance
console.log('🤖 Creating Telegram bot instance...');
const botToken = process.env.TELEGRAM_TOKEN;
if (!botToken) {
  console.error('❌ ERROR: TELEGRAM_TOKEN environment variable is not set');
  throw new AppError('TELEGRAM_TOKEN environment variable is not set', 'CONFIG_ERROR');
}

// Define reference variables outside the try block for module exports
let bot;
let sessionManager;
let commandRegistry;
let workflowManager;

try {
  bot = new TelegramBot(botToken, { polling: true });
  logger.info('Telegram bot instance created');
  console.log('✅ Telegram bot instance created successfully');

  // Initialize core services
  console.log('🧩 Initializing core services...');
  
  console.log('  ↳ Creating session manager...');
  sessionManager = new SessionManager({
    logger,
    persistence: {
      type: 'memory', // Use in-memory storage for now
      options: {}
    }
  });
  console.log('  ✓ Session manager created');

  console.log('  ↳ Creating command registry...');
  commandRegistry = new CommandRegistry();
  logger.info('Command registry initialized');
  console.log('  ✓ Command registry created');

  console.log('  ↳ Creating workflow manager...');
  workflowManager = new WorkflowManager({
    sessionManager,
    logger
  });
  logger.info('Workflow manager initialized');
  console.log('  ✓ Workflow manager created');

  // Initialize account points service
  console.log('💰 Initializing account points service...');
  const accountPointsService = new AccountPointsService({
    sessionManager,
    logger
  });
  logger.info('Account points service initialized');
  console.log('  ✓ Account points service created');

  // Register account points workflow
  if (featureFlags.isEnabled('useNewAccountPoints')) {
    console.log('🔄 Registering account points workflow...');
    const accountPointsWorkflow = createAccountPointsWorkflow({
      accountPointsService,
      sessionManager
    });
    
    workflowManager.registerWorkflowDefinition('account-points', accountPointsWorkflow);
    logger.info('Account points workflow registered');
    console.log('  ✓ Account points workflow registered');
  } else {
    console.log('  ⚠️ Account points workflow disabled by feature flag');
  }

  // Initialize Telegram integration
  console.log('🔌 Initializing Telegram integration...');
  try {
    initializeTelegramIntegration({
      bot,
      commandRegistry,
      sessionManager,
      workflowManager,
      accountPointsService,
      logger
    });
    logger.info('Telegram integration initialized');
    console.log('  ✓ Telegram integration initialized');
    
    // Add a simple ping command to verify the bot is working
    console.log('  ↳ Adding basic command handlers...');
    bot.onText(/\/ping/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, '🏓 Pong! Bot is up and running.');
      logger.info('Responded to ping command', { 
        userId: msg.from.id, 
        username: msg.from.username,
        chatId
      });
    });
    
    // Add a status command
    bot.onText(/\/status/, (msg) => {
      const chatId = msg.chat.id;
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);
      
      const statusMessage = `
🤖 *StationThis Bot Status*
✅ *Online* | Uptime: ${hours}h ${minutes}m ${seconds}s
🔗 *Components*:
  • Session Manager: ${sessionManager ? '✅' : '❌'}
  • Command Registry: ${commandRegistry ? '✅' : '❌'}
  • Workflow Manager: ${workflowManager ? '✅' : '❌'}
  
🛠 Visit the dashboard at http://localhost:3001 for more details
      `;
      
      bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
      logger.info('Responded to status command', { 
        userId: msg.from.id, 
        username: msg.from.username,
        chatId
      });
    });
    
    console.log('  ✓ Basic command handlers added');
  } catch (error) {
    console.error('  ❌ Error initializing Telegram integration:', error);
    throw error;
  }

  // Register commands - skip if already registered during bootstrap
  if (featureFlags.isEnabled('useNewAccountCommands') && !bot.initedAccountCommands) {
    console.log('📝 Registering account commands...');
    try {
      // Check if the points command is already registered
      if (!commandRegistry.hasCommand('points')) {
        registerAccountCommands(commandRegistry, {
          accountPointsService,
          workflowManager,
          sessionManager,
          logger
        });
        bot.initedAccountCommands = true;
        logger.info('Account commands registered');
        console.log('  ✓ Account commands registered');
      } else {
        logger.info('Account commands already registered');
        console.log('  ✓ Account commands already registered');
        bot.initedAccountCommands = true;
      }
    } catch (error) {
      logger.error('Failed to register account commands', { error });
      console.error('  ❌ Error registering account commands:', error.message);
    }
  } else if (featureFlags.isEnabled('useNewAccountCommands')) {
    console.log('  ⚠️ Account commands already registered in bootstrap');
  } else {
    console.log('  ⚠️ Account commands disabled by feature flag');
  }

  // Comment out or modify this section to avoid double-initialization
  // Bootstrap with legacy components
  console.log('🔄 Legacy integration disabled for testing...');
  /* 
  try {
    bootstrap({
      bot,
      commandRegistry,
      sessionManager,
      workflowManager,
      accountPointsService,
      logger
    });
    console.log('  ✓ Legacy components bootstrapped');
  } catch (error) {
    console.error('  ❌ Error bootstrapping legacy components:', error);
    throw error;
  }
  */

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
  
  // Status endpoint with more detailed information
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: process.env.VERSION || '1.0.0',
      activeSessions: sessionManager ? sessionManager.countActiveSessions() : 'N/A',
      components: {
        bot: !!bot,
        sessionManager: !!sessionManager,
        commandRegistry: !!commandRegistry,
        workflowManager: !!workflowManager,
        featureFlags: featureFlags.getAllFlags()
      }
    });
  });
  
  // Web dashboard
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>StationThis Bot Dashboard</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 1rem;
            }
            header {
              background: #5865F2;
              color: white;
              padding: 1rem;
              border-radius: 0.5rem;
              margin-bottom: 2rem;
              text-align: center;
            }
            .card {
              background: white;
              border-radius: 0.5rem;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              padding: 1.5rem;
              margin-bottom: 1.5rem;
            }
            .status {
              display: flex;
              align-items: center;
              margin-bottom: 0.5rem;
            }
            .status-indicator {
              width: 12px;
              height: 12px;
              border-radius: 50%;
              margin-right: 0.75rem;
            }
            .status-active {
              background-color: #43B581;
            }
            .status-inactive {
              background-color: #F04747;
            }
            .feature-flags {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
              gap: 1rem;
            }
            .feature-flag {
              background: #f5f5f5;
              padding: 0.5rem;
              border-radius: 0.25rem;
            }
            .tag {
              display: inline-block;
              background: #5865F2;
              color: white;
              padding: 0.25rem 0.5rem;
              border-radius: 0.25rem;
              font-size: 0.75rem;
              margin-right: 0.5rem;
            }
          </style>
        </head>
        <body>
          <header>
            <h1>StationThis Bot Dashboard</h1>
            <p>New Architecture Status</p>
          </header>
          
          <div class="card">
            <h2>System Status</h2>
            <div class="status">
              <div class="status-indicator status-active"></div>
              <span>System Active - Uptime: <span id="uptime">calculating...</span></span>
            </div>
            <div class="status">
              <div class="status-indicator ${bot ? 'status-active' : 'status-inactive'}"></div>
              <span>Telegram Bot: ${bot ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div class="status">
              <div class="status-indicator ${workflowManager ? 'status-active' : 'status-inactive'}"></div>
              <span>Workflow System: ${workflowManager ? 'Active' : 'Inactive'}</span>
            </div>
          </div>
          
          <div class="card">
            <h2>Feature Flags</h2>
            <div class="feature-flags">
              ${Object.entries(featureFlags.getAllFlags()).map(([key, value]) => `
                <div class="feature-flag">
                  <div class="status">
                    <div class="status-indicator ${value ? 'status-active' : 'status-inactive'}"></div>
                    <span>${key}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="card">
            <h2>Quick Links</h2>
            <p><a href="/api/health">Health Check API</a></p>
            <p><a href="/api/status">Status API</a></p>
          </div>
          
          <script>
            // Update uptime in real-time
            function updateUptime() {
              fetch('/api/health')
                .then(response => response.json())
                .then(data => {
                  const uptime = Math.floor(data.uptime);
                  const hours = Math.floor(uptime / 3600);
                  const minutes = Math.floor((uptime % 3600) / 60);
                  const seconds = uptime % 60;
                  
                  document.getElementById('uptime').textContent = 
                    \`\${hours}h \${minutes}m \${seconds}s\`;
                })
                .catch(error => console.error('Error fetching uptime:', error));
            }
            
            // Initial update and set interval
            updateUptime();
            setInterval(updateUptime, 1000);
          </script>
        </body>
      </html>
    `);
  });
  
  console.log('  ✓ Health endpoint configured');
  console.log('  ✓ Status endpoint configured');
  console.log('  ✓ Web dashboard configured');

  // Start server
  console.log('🚀 Starting Express server...');
  const port = process.env.PORT || 3001; // Use a different port than the legacy server
  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    logger.info('StationThis Bot is ready!');
    console.log(`✅ Server started on port ${port}`);
    console.log('🎉 StationThis Bot is ready!');
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

} catch (error) {
  console.error('❌ STARTUP ERROR:', error);
  logger.error('Error starting bot', { error });
  process.exit(1);
}

// Export for testing
module.exports = {
  app,
  bot,
  sessionManager,
  commandRegistry,
  workflowManager
};

