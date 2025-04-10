/**
 * Telegram Integration
 * 
 * Main entry point for Telegram-specific integration.
 * Connects the core application components to the Telegram bot API.
 */

const featureFlags = require('../../config/featureFlags');
const { TelegramCommandAdapter } = require('../../core/command');
const { CommandRouter } = require('../../core/command/router');
const AccountTelegramAdapter = require('./adapters/accountAdapter');
const { registerAccountCommands } = require('../../commands/accountCommands');
const { createAccountPointsWorkflow } = require('../../core/workflow/workflows/accountPoints');

/**
 * Initialize the Telegram integration
 * @param {Object} deps - Dependencies
 * @param {Object} deps.bot - Telegram bot instance
 * @param {Object} deps.commandRegistry - Command registry
 * @param {Object} deps.sessionManager - Session manager
 * @param {Object} deps.workflowManager - Workflow manager
 * @param {Object} deps.accountPointsService - Account points service
 * @param {Object} deps.userService - User service
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.featureOverrides - Feature flag overrides
 */
function initializeTelegramIntegration({
  bot,
  commandRegistry,
  sessionManager,
  workflowManager,
  accountPointsService,
  userService,
  logger,
  featureOverrides = {}
}) {
  // Apply any feature overrides
  const flags = {
    ...featureFlags.getAllFlags(),
    ...featureOverrides
  };

  // Register account points workflow
  if (flags.useNewAccountPoints && workflowManager && sessionManager && accountPointsService) {
    try {
      const accountPointsWorkflow = createAccountPointsWorkflow({
        accountPointsService,
        sessionManager
      });
      
      workflowManager.registerWorkflowDefinition('account-points', accountPointsWorkflow);
      
      logger.info('Registered account points workflow');
    } catch (error) {
      logger.error('Failed to register account points workflow', { error });
    }
  } else if (flags.useNewAccountPoints) {
    logger.warn('Account points workflow enabled but missing dependencies');
  }
  
  // Register account commands
  if (flags.useNewAccountCommands && commandRegistry) {
    try {
      registerAccountCommands(commandRegistry, {
        accountPointsService,
        workflowManager,
        sessionManager,
        userService,
        logger
      });
      
      logger.info('Registered account commands');
    } catch (error) {
      logger.error('Failed to register account commands', { error });
    }
  } else if (flags.useNewAccountCommands) {
    logger.warn('Account commands enabled but missing dependencies');
  }
  
  // Initialize command router if enabled
  if (flags.useNewCommandRouter && commandRegistry && bot) {
    try {
      const commandRouter = new CommandRouter({ registry: commandRegistry });
      const telegramAdapter = new TelegramCommandAdapter({ bot });
      
      // Connect router to adapter
      commandRouter.setAdapter(telegramAdapter);
      
      logger.info('Initialized command router with Telegram adapter');
    } catch (error) {
      logger.error('Failed to initialize command router', { error });
    }
  }
  
  // Initialize account adapter
  if (flags.useNewAccountPoints && bot && accountPointsService && 
      sessionManager && workflowManager) {
    try {
      const accountAdapter = new AccountTelegramAdapter({
        bot,
        accountPointsService,
        sessionManager,
        workflowManager,
        logger
      });
      
      // Register command handler
      bot.onText(/^\/points(?:@\w+)?$/, (message) => {
        accountAdapter.handlePointsCommand(message);
      });
      
      // Add callback query handler
      bot.on('callback_query', (callbackQuery) => {
        const data = callbackQuery.data;
        if (data && data.startsWith('wf_points:')) {
          accountAdapter.handlePointsCallback(callbackQuery);
        }
      });
      
      logger.info('Initialized account adapter with points command');
    } catch (error) {
      logger.error('Failed to initialize account adapter', { error });
    }
  } else if (flags.useNewAccountPoints) {
    logger.warn('Account adapter enabled but missing dependencies');
  }
  
  logger.info('Telegram integration initialized successfully');
}

module.exports = {
  initializeTelegramIntegration
}; 