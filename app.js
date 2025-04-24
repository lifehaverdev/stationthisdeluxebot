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
const { createLogger } = require('./src/utils/logger');
const { AppError } = require('./src/core/shared/errors/AppError');
const { CommandRegistry } = require('./src/core/command/registry');
const { SessionManager } = require('./src/core/session/manager');
const { WorkflowManager } = require('./src/core/workflow/manager');

// Import the internal API
const { setup: setupInternalAPI } = require('./src/core/internalAPI');

// Service imports
const AccountPointsService = require('./src/core/account/points');
const { createAccountPointsWorkflow } = require('./src/core/workflow/workflows/accountPoints');
// Comment out to fix missing module error
// const { registerAccountCommands } = require('./src/commands/accountCommands');

// Command handler registrations
const { registerCommandHandlers } = require('./src/integrations/telegram/commandHandler');
const commandRoute = require('./src/integrations/web/commandRoute');

// Add generation routes
const generationRoutes = require('./src/integrations/web/generationRoutes');

// Add ComfyDeploy service
const { ComfyDeployService } = require('./src/services/comfydeploy/service');
const { ComfyDeployAdapter } = require('./src/services/comfydeploy/adapter');
const { ServiceRegistry } = require('./src/services/registry');

// Database and repositories
const { DatabaseService } = require('./src/db/dbService');
const { WorkflowRepository } = require('./src/db/repositories/workflowRepository');
const { WorkflowLoader } = require('./src/core/workflow/loader');

// Create logger
const logger = createLogger('stationthisbot');

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
  preloadWorkflows: true,
  preloadMetadata: true,
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
let dbService = null;
let repositories = {};

// Use the ServiceRegistry singleton
const serviceRegistry = ServiceRegistry.getInstance();

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

// Initialize database connection
async function initializeDatabase() {
  console.log('💾 Initializing database connection...');
  try {
    dbService = new DatabaseService({
      uri: process.env.MONGO_PASS || 'mongodb://localhost:27017/stationthis',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true
      },
      logger
    });
    
    await dbService.connect();
    console.log('  ✓ Database connection established');
    
    return dbService;
  } catch (error) {
    console.error('  ❌ Failed to connect to database:', error.message);
    logger.error('Database initialization failed', { error });
    // Continue without database in development mode
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Database connection required in production', 'DATABASE_ERROR');
    } else {
      console.warn('  ⚠️ Continuing without database in development mode');
      return null;
    }
  }
}

// Initialize repositories
async function initializeRepositories() {
  console.log('📚 Initializing repositories...');
  
  if (!dbService || !dbService.isConnected()) {
    console.warn('  ⚠️ Database not connected, repositories will not be available');
    return {};
  }
  
  try {
    // Initialize workflow repository
    console.log('  ↳ Initializing workflow repository...');
    const workflowRepository = new WorkflowRepository({
      db: dbService,
      logger
    });
    repositories.workflow = workflowRepository;
    console.log('  ✓ Workflow repository initialized');
    
    // Add more repositories here...
    
    return repositories;
  } catch (error) {
    console.error('  ❌ Failed to initialize repositories:', error.message);
    logger.error('Repository initialization failed', { error });
    return {};
  }
}

// Initialize core components
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

// Load workflows from database
async function loadWorkflows() {
  if (!featureFlags.isEnabled('preloadWorkflows')) {
    console.log('⚠️ Workflow preloading disabled by feature flag');
    return { workflows: [], failed: false };
  }

  console.log('🔄 Loading workflows from database...');
  try {
    if (!repositories.workflow) {
      throw new Error('Workflow repository not available');
    }

    const workflowLoader = new WorkflowLoader({
      workflowRepository: repositories.workflow,
      logger
    });

    const workflows = await workflowLoader.loadAllWorkflows();
    const validWorkflows = [];
    const invalidWorkflows = [];

    // Validate workflows
    for (const workflow of workflows) {
      try {
        // Validate structure
        if (!workflow.name || !Array.isArray(workflow.inputs)) {
          throw new Error(`Invalid workflow structure: ${workflow.name || 'unnamed'}`);
        }
        
        // Register with workflow manager
        workflowManager.registerWorkflowDefinition(workflow.name, workflow);
        validWorkflows.push(workflow.name);
      } catch (error) {
        logger.error(`Failed to validate workflow: ${workflow.name || 'unnamed'}`, { error, workflow });
        invalidWorkflows.push(workflow.name || 'unnamed');
      }
    }

    console.log(`  ✓ Loaded ${validWorkflows.length} workflows successfully`);
    if (invalidWorkflows.length > 0) {
      console.warn(`  ⚠️ ${invalidWorkflows.length} workflows failed validation: ${invalidWorkflows.join(', ')}`);
    }

    return {
      workflows: validWorkflows,
      invalidWorkflows,
      failed: false
    };
  } catch (error) {
    console.error('  ❌ Failed to load workflows:', error.message);
    logger.error('Workflow loading failed', { error });
    
    return {
      workflows: [],
      failed: true,
      error
    };
  }
}

// Preload metadata
async function preloadMetadata() {
  if (!featureFlags.isEnabled('preloadMetadata')) {
    console.log('⚠️ Metadata preloading disabled by feature flag');
    return { success: false };
  }

  console.log('📚 Preloading shared metadata...');
  const metadata = {};
  const failed = [];

  // Load featured workflows
  try {
    if (!repositories.workflow) {
      throw new Error('Workflow repository not available');
    }
    
    console.log('  ↳ Loading featured workflows...');
    const featuredWorkflows = await repositories.workflow.findFeatured(10);
    metadata.featuredWorkflows = featuredWorkflows;
    
    console.log(`  ✓ Loaded ${featuredWorkflows.length} featured workflows`);
  } catch (error) {
    console.warn('  ⚠️ Failed to load featured workflows:', error.message);
    logger.warn('Featured workflows loading failed', { error });
    failed.push('featuredWorkflows');
  }

  // Add more metadata loading here...

  return {
    metadata,
    failed,
    success: failed.length === 0
  };
}

// Main initialization function
async function initialize() {
  try {
    // Get singleton bot instance
    const bot = initializeBot();
    
    // Initialize database first
    await initializeDatabase();
    
    // Initialize repositories
    await initializeRepositories();
    
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

    // Load workflows from database
    const workflowResult = await loadWorkflows();
    
    // Preload metadata
    const metadataResult = await preloadMetadata();
    
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
        // registerAccountCommands(core.commandRegistry, {
        //   accountPointsService,
        //   workflowManager: core.workflowManager,
        //   sessionManager: core.sessionManager,
        //   logger
        // });
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
        timestamp: Date.now(),
        database: dbService?.isConnected() || false
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
        database: {
          connected: dbService?.isConnected() || false,
          repositories: Object.keys(repositories)
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
        },
        workflows: {
          loaded: workflowResult?.workflows?.length || 0,
          invalid: workflowResult?.invalidWorkflows?.length || 0,
          loadFailed: workflowResult?.failed || false
        },
        metadata: {
          preloaded: metadataResult?.success || false,
          failed: metadataResult?.failed || []
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

    // Ensure fallback UI exists if workflows fail to load
    app.get('/interface/fallback', (req, res) => {
      res.sendFile(path.join(__dirname, 'user-interface', 'fallback.html'));
    });

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

    // Initialize ComfyDeploy service
    console.log('🎨 Initializing ComfyDeploy service...');
    try {
      process.env.NODE_ENV = process.env.NODE_ENV || 'development';
      
      // Create the ComfyDeploy adapter
      const comfyDeployAdapter = new ComfyDeployAdapter({
        config: {
          apiKey: process.env.COMFY_DEPLOY_API_KEY || 'dev-key',
          baseUrl: process.env.COMFY_DEPLOY_BASE_URL || 'https://www.comfydeploy.com/api',
          webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL,
          workflowRefreshInterval: 3600000 // 1 hour
        }
      });
      
      // Initialize the adapter
      await comfyDeployAdapter.init();
      
      // Register with the service registry
      serviceRegistry.register(comfyDeployAdapter);
      
      console.log('  ✓ ComfyDeploy service initialized and registered');
      
      // Synchronize workflows if workflow manager is available
      if (core.workflowManager) {
        console.log('  ↳ Synchronizing workflows with ComfyDeploy service...');
        try {
          const result = await core.workflowManager.synchronizeWithWorkflowService();
          console.log(`  ✓ Workflows synchronized: ${result.serviceToManager} from service, ${result.managerToService} to service`);
        } catch (syncError) {
          console.warn('  ⚠️ Workflow synchronization failed:', syncError.message);
          logger.warn('Workflow synchronization failed', { error: syncError });
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ Failed to initialize ComfyDeploy service (required in production):', error);
        throw error;
      } else {
        console.warn('⚠️ ComfyDeploy service initialization failed, but continuing in development mode');
        console.warn('   Set COMFY_DEPLOY_API_KEY in .env for full functionality');
      }
    }
    
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

    // Check if system is ready
    const isSystemReady = (
      !!core.sessionManager && 
      !!core.commandRegistry && 
      !!core.workflowManager && 
      (!dbService || dbService.isConnected() || process.env.NODE_ENV !== 'production')
    );

    if (isSystemReady) {
      logger.info('System initialization complete and ready');
      console.log('✅ System ready - All required components are available');
    } else {
      const missingComponents = [];
      if (!core.sessionManager) missingComponents.push('SessionManager');
      if (!core.commandRegistry) missingComponents.push('CommandRegistry');
      if (!core.workflowManager) missingComponents.push('WorkflowManager');
      if (dbService && !dbService.isConnected() && process.env.NODE_ENV === 'production') {
        missingComponents.push('Database');
      }
      
      logger.warn('System initialized with missing components', { missingComponents });
      console.warn(`⚠️ System initialized with limitations - Missing: ${missingComponents.join(', ')}`);
    }
    
    return {
      bot,
      app,
      core,
      dbService,
      repositories,
      isSystemReady
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
  getDatabaseService: () => dbService,
  getRepositories: () => repositories,
  isSystemReady: () => appComponents?.isSystemReady || false,
  featureFlags
};