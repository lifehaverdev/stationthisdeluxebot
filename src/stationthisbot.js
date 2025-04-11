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
// Import the internal API
const internalAPI = require('./core/internalAPI');
// Import the web command route
const commandRoute = require('./integrations/web/commandRoute');
// Import the telegram command handler
const { registerCommandHandlers } = require('./integrations/telegram/commandHandler');
// Import the web router
const { setupWebRouter } = require('./integrations/web/router');

// Check for webonly mode
const isWebOnly = process.argv.includes('--webonly');

console.log('🚀 Starting StationThis Bot with new architecture...');
console.log('📦 Loading environment variables and dependencies...');
if (isWebOnly) {
  console.log('⚠️ Running in web-only mode - Telegram polling disabled');
}

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
const botToken = process.env.TELEGRAM_TOKEN || (
  process.env.NODE_ENV === 'production' 
    ? (() => {
        throw new AppError('TELEGRAM_TOKEN required in production', 'CONFIG_ERROR');
      })()
    : 'mock-telegram-token-for-dev'
);

if (process.env.NODE_ENV !== 'production' && botToken === 'mock-telegram-token-for-dev') {
  console.warn('⚠️  Using mock Telegram token - for development only');
  console.warn('⚠️  Set TELEGRAM_TOKEN in .env for production use');
}

// Define reference variables outside the try block for module exports
let bot;
let sessionManager;
let commandRegistry;
let workflowManager;

try {
  // Initialize bot with polling disabled in web-only mode
  bot = new TelegramBot(botToken, { polling: !isWebOnly });
  logger.info('Telegram bot instance created' + (isWebOnly ? ' (polling disabled)' : ''));
  console.log('✅ Telegram bot instance created successfully' + (isWebOnly ? ' (polling disabled)' : ''));

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

  // Initialize internal API
  console.log('  ↳ Initializing internal API...');
  internalAPI.setup({
    sessionManager,
    // Any other dependencies can be passed here
  });
  logger.info('Internal API initialized');
  console.log('  ✓ Internal API initialized');

  // Initialize services for interface-agnostic functionality
  console.log('🔌 Initializing service layer...');
  const { initializeAllServices } = require('./services/initializer');
  
  let services = {};
  if (featureFlags.isEnabled('useServices')) {
    console.log('  ↳ Initializing services...');
    // Use an immediately invoked async function
    (async () => {
      try {
        services = await initializeAllServices({
          comfyDeploy: {
            workflowRefreshInterval: 3600000, // 1 hour
            config: {
              apiKey: process.env.COMFY_DEPLOY_API_KEY,
              baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
              webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL
            }
          }
        });
        
        const serviceNames = services.registry.getServiceNames();
        logger.info('Services initialized', { serviceNames });
        console.log(`  ✓ Services initialized (${serviceNames.length} services)`);
        serviceNames.forEach(name => console.log(`    - ${name}`));
      } catch (error) {
        logger.error('Error initializing services', { error });
        console.error('  ❌ Error initializing services:', error.message);
        console.log('    Continuing startup without services');
      }
    })();
  } else {
    console.log('  ⚠️ Services disabled by feature flag');
  }

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
    
    // Set up Telegram command handlers via internalAPI
    if (featureFlags.isEnabled('useInternalAPI')) {
      console.log('  ↳ Registering Telegram commands with internal API...');
      registerCommandHandlers(bot, commandRegistry.getAll());
      logger.info('Telegram command handlers registered with internal API');
      console.log('  ✓ Telegram command handlers registered with internal API');
    }
    
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
  • Internal API: ${internalAPI ? '✅' : '❌'}
  • Telegram Polling: ${!isWebOnly ? '✅' : '❌ (web-only mode)'}
  
🛠 Visit the dashboard at http://localhost:3001/interface for more details
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
      if (!commandRegistry.has('points')) {
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
    // Get command information
    const commands = commandRegistry.getAll().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      category: cmd.metadata?.category
    }));

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: process.env.VERSION || '1.0.0',
      activeSessions: sessionManager ? sessionManager.countActiveSessions() : 'N/A',
      commandCount: commands.length,
      commands: commands,
      services: {
        enabled: featureFlags.isEnabled('useServices'),
        count: services.registry?.getServiceNames().length || 0,
        names: services.registry?.getServiceNames() || []
      },
      components: {
        bot: !!bot,
        telegramPolling: !isWebOnly,
        webOnly: isWebOnly,
        sessionManager: !!sessionManager,
        commandRegistry: !!commandRegistry,
        workflowManager: !!workflowManager,
        internalAPI: !!internalAPI,
        featureFlags: featureFlags.getAllFlags()
      }
    });
  });

  // Mount the command route
  if (featureFlags.isEnabled('useInternalAPI')) {
    console.log('  ↳ Mounting command route...');
    app.use('/api/commands', commandRoute);
    logger.info('Command route mounted at /api/commands');
    console.log('  ✓ Command route mounted');
  }

  // Mount the web interface
  console.log('  ↳ Setting up web interface...');
  const webRouter = setupWebRouter({ app });
  app.use('/interface', webRouter);
  logger.info('Web interface mounted at /interface');
  console.log('  ✓ Web interface mounted');

  // Legacy redirect from root to web interface
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
} catch (error) {
  console.error('❌ Error initializing StationThis Bot:', error);
  logger.error('Initialization failed', { error });
  process.exit(1);
}

// Export references to key components
module.exports = {
  bot,
  commandRegistry,
  sessionManager,
  workflowManager,
  featureFlags,
  internalAPI,
  app
};

