/**
 * StationThis Bot - Clean Architecture Entry Point
 * 
 * A fresh implementation that serves both the web interface and Telegram bot
 * using a clean architecture approach with proper separation of concerns.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { Logger } = require('./src/utils/logger');
const { AppError } = require('./src/core/shared/errors/AppError');
const { CommandRegistry } = require('./src/core/command/registry');
const { SessionManager } = require('./src/core/session/manager');
const { WorkflowManager } = require('./src/core/workflow/manager');

// Import the internal API
const { setup: setupInternalAPI } = require('./src/core/internalAPI');

// Service imports
const AccountPointsService = require('./src/core/account/points');
const { createAccountPointsWorkflow } = require('./src/core/workflow/workflows/accountPoints');
const { registerAccountCommands } = require('./src/commands/accountCommands');

// Command handler registrations
const { registerCommandHandlers } = require('./src/integrations/telegram/commandHandler');
const commandRoute = require('./src/integrations/web/commandRoute');

// Add generation routes
const generationRoutes = require('./src/integrations/web/generationRoutes');

// Add ComfyDeploy service
const { ComfyDeployService } = require('./src/services/comfydeploy/service');

// Create logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'stationthisbot'
});

// Configuration flags
const isWebOnly = process.argv.includes('--webonly');
const useWebhook = process.env.USE_WEBHOOK === 'true';
const VERSION = process.env.VERSION || '1.0.0';

// Feature flags - simplified approach
const featureFlags = {
  useInternalAPI: true,
  useNewAccountCommands: true,
  useNewAccountPoints: true,
  useServices: true,
  isEnabled: (flag) => featureFlags[flag] === true
};

logger.info('Initializing StationThis Bot with clean architecture...');
console.log('🚀 Starting StationThis Bot with clean architecture...');
console.log('📦 Loading environment variables and dependencies...');

if (isWebOnly) {
  console.log('⚠️ Running in web-only mode - Telegram polling disabled');
}

// Initialize Express app
const app = express();
app.use(express.json());

// Increase timeout for long-running requests
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 minutes
  next();
});

// Create core components - using a singleton pattern to avoid duplication
let botInstance = null;
let sessionManager = null; 
let commandRegistry = null;
let workflowManager = null;

// Create Telegram bot instance (singleton pattern)
function initializeBot() {
  if (botInstance) return botInstance;
  
  console.log('🤖 Creating Telegram bot instance...');
  const botToken = process.env.TELEGRAM_TOKEN || (
    process.env.NODE_ENV === 'production' 
      ? (() => {
          throw new AppError('TELEGRAM_TOKEN required in production', 'CONFIG_ERROR');
        })()
      : 'mock-telegram-token-for-dev'
  );

  if (process.env.NODE_ENV !== 'production' && botToken === 'mock-telegram-token-for-dev') {
    console.warn('⚠️  Using mock Telegram token - for development only');
  }

  // Only enable polling if not using webhooks and not in web-only mode
  const polling = !useWebhook && !isWebOnly;
  botInstance = new TelegramBot(botToken, { polling });
  
  logger.info(`Telegram bot instance created (polling: ${polling})`);
  console.log(`✅ Telegram bot instance created (polling: ${polling ? 'enabled' : 'disabled'})`);
  
  return botInstance;
}

function initializeCore() {
  // Initialize session manager
  console.log('  ↳ Creating session manager...');
  sessionManager = new SessionManager({
    logger,
    persistence: {
      type: 'memory', // Use in-memory storage for now
      options: {}
    }
  });
  console.log('  ✓ Session manager created');

  // Initialize command registry
  console.log('  ↳ Creating command registry...');
  commandRegistry = new CommandRegistry();
  console.log('  ✓ Command registry created');

  // Initialize workflow manager
  console.log('  ↳ Creating workflow manager...');
  workflowManager = new WorkflowManager({
    sessionManager,
    logger
  });
  console.log('  ✓ Workflow manager created');

  return {
    sessionManager,
    commandRegistry,
    workflowManager
  };
}

// Main initialization function
async function initialize() {
  try {
    // Get singleton bot instance
    const bot = initializeBot();
    
    // Initialize core components
    console.log('🧩 Initializing core services...');
    const core = initializeCore();
    
    // Initialize internal API
    console.log('  ↳ Initializing internal API...');
    const internalApiRouter = setupInternalAPI({
      sessionManager: core.sessionManager,
      commandRegistry: core.commandRegistry,
      workflowManager: core.workflowManager
    });
    
    // Mount the internal API router
    app.use('/api/internal', internalApiRouter);
    console.log('  ✓ Internal API initialized and mounted at /api/internal');

    // Initialize account points service
    console.log('💰 Initializing account points service...');
    const accountPointsService = new AccountPointsService({
      sessionManager: core.sessionManager,
      logger
    });
    console.log('  ✓ Account points service created');

    // Register account points workflow
    if (featureFlags.isEnabled('useNewAccountPoints')) {
      console.log('🔄 Registering account points workflow...');
      const accountPointsWorkflow = createAccountPointsWorkflow({
        accountPointsService,
        sessionManager: core.sessionManager
      });
      
      core.workflowManager.registerWorkflowDefinition('account-points', accountPointsWorkflow);
      console.log('  ✓ Account points workflow registered');
    }

    // Initialize Telegram integration
    if (!isWebOnly) {
      console.log('🔌 Initializing Telegram integration...');
      
      // Register Telegram command handlers
      if (featureFlags.isEnabled('useInternalAPI')) {
        console.log('  ↳ Registering Telegram commands with internal API...');
        registerCommandHandlers(bot, core.commandRegistry.getAll());
        console.log('  ✓ Telegram command handlers registered');
      }
      
      // Register account commands
      if (featureFlags.isEnabled('useNewAccountCommands')) {
        console.log('📝 Registering account commands...');
        registerAccountCommands(core.commandRegistry, {
          accountPointsService,
          workflowManager: core.workflowManager,
          sessionManager: core.sessionManager,
          logger
        });
        console.log('  ✓ Account commands registered');
      }
      
      // Add basic command handlers
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
  • Session Manager: ${core.sessionManager ? '✅' : '❌'}
  • Command Registry: ${core.commandRegistry ? '✅' : '❌'}
  • Workflow Manager: ${core.workflowManager ? '✅' : '❌'}
  • Internal API: ${'✅'}
  • Telegram Polling: ${!isWebOnly && !useWebhook ? '✅' : '❌ (disabled)'}
  
🛠 Visit the dashboard at ${process.env.PUBLIC_URL || 'http://localhost:3001'}/interface for more details
        `;
        
        bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
      });
      
      console.log('  ✓ Basic command handlers added');
    }

    // Set up API routes
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
      // Get command information
      const commands = core.commandRegistry.getAll().map(cmd => ({
        name: cmd.name,
        description: cmd.description,
        category: cmd.metadata?.category
      }));

      res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now(),
        version: VERSION,
        activeSessions: core.sessionManager ? core.sessionManager.countActiveSessions() : 'N/A',
        commandCount: commands.length,
        commands: commands,
        services: {
          enabled: featureFlags.isEnabled('useServices'),
        },
        components: {
          bot: !!bot,
          telegramPolling: !isWebOnly && !useWebhook,
          webOnly: isWebOnly,
          sessionManager: !!core.sessionManager,
          commandRegistry: !!core.commandRegistry,
          workflowManager: !!core.workflowManager,
          internalAPI: true,
          featureFlags: featureFlags
        }
      });
    });

    // Mount the command route
    if (featureFlags.isEnabled('useInternalAPI')) {
      console.log('  ↳ Mounting command route...');
      app.use('/api/commands', commandRoute);
      console.log('  ✓ Command route mounted');
      
      // Mount generation routes
      console.log('  ↳ Mounting generation routes...');
      app.use('/api/generation', generationRoutes);
      console.log('  ✓ Generation routes mounted at /api/generation');
    }

    // Serve static files from the user-interface directory
    console.log('🌐 Setting up web interface...');
    app.use('/interface', express.static(path.join(__dirname, 'user-interface')));
    console.log('  ✓ Web interface mounted at /interface');

    // Redirect from root to interface
    app.get('/', (req, res) => {
      res.redirect('/interface');
    });

    // Start Express server
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`🌐 Express server running on port ${PORT}`);
      logger.info(`Express server started on port ${PORT}`);
      console.log(`🌎 Web interface available at http://localhost:${PORT}/interface`);
    });

    console.log('✅ StationThis Bot initialization complete');
    
    // Set up webhook if needed
    if (useWebhook && !isWebOnly) {
      const webhookUrl = process.env.WEBHOOK_URL;
      if (webhookUrl) {
        console.log('🔗 Setting up webhook...');
        await bot.setWebHook(webhookUrl);
        console.log(`  ✓ Webhook set to ${webhookUrl}`);
        
        // Add webhook endpoint
        app.post(`/webhook/${bot.token}`, (req, res) => {
          bot.processUpdate(req.body);
          res.sendStatus(200);
        });
      } else {
        console.error('❌ WEBHOOK_URL environment variable not set but USE_WEBHOOK is true');
      }
    }

    // Initialize ComfyDeploy service
    console.log('🎨 Initializing ComfyDeploy service...');
    try {
      process.env.NODE_ENV = process.env.NODE_ENV || 'development';
      const comfyDeployService = new ComfyDeployService({
        apiKey: process.env.COMFY_DEPLOY_API_KEY || 'dev-key',
        baseUrl: process.env.COMFY_DEPLOY_BASE_URL || 'https://www.comfydeploy.com/api',
        webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL,
        workflowRefreshInterval: 3600000 // 1 hour
      });
      await comfyDeployService.initialize();
      console.log('  ✓ ComfyDeploy service initialized');
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ Failed to initialize ComfyDeploy service (required in production):', error);
        throw error;
      } else {
        console.warn('⚠️ ComfyDeploy service initialization failed, but continuing in development mode');
        console.warn('   Set COMFY_DEPLOY_API_KEY in .env for full functionality');
      }
    }
    
    return {
      bot,
      app,
      core
    };
  } catch (error) {
    console.error('❌ Error initializing StationThis Bot:', error);
    logger.error('Initialization failed', { error });
    throw error;
  }
}

// Start the application and export components
let appComponents = null;

(async () => {
  try {
    appComponents = await initialize();
  } catch (error) {
    console.error('Fatal error during initialization:', error);
    process.exit(1);
  }
})();

// Export components for external use
module.exports = {
  getBotInstance: () => botInstance,
  getApp: () => app,
  getSessionManager: () => sessionManager,
  getCommandRegistry: () => commandRegistry,
  getWorkflowManager: () => workflowManager,
  featureFlags
};