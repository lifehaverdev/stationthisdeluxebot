/**
 * Telegram Platform
 * 
 * Entry point for initializing the Telegram platform adapter.
 * Connects the bot to core services and starts the bot.
 */

const createTelegramBot = require('./bot');
const { setupDynamicCommands } = require('./dynamicCommands');
const WorkflowCacheManager = require('../../core/services/comfydeploy/workflowCacheManager');

// Feature toggles for Telegram commands/menus. Toggle to true to disable a feature.
const DISABLED_FEATURES = {
  train: true,   // Disables the /train command & training menu
  cook: true,    // Disables the /cook dynamic command
  spells: true,  // Disables the /spells menu
  again: false   // Controls the /again command
};

/**
 * Initialize the Telegram platform
 * @param {Object} dependencies - The canonical dependencies object.
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized bot instance and command setup utility.
 */
function initializeTelegramPlatform(dependencies, options = {}) {
  const { logger = console } = dependencies;

  const token = process.env.TELEGRAM_TOKEN || options.token;
  
  if (!token) {
    logger.error('Telegram bot token is required. Set TELEGRAM_TOKEN environment variable.');
    throw new Error('Telegram bot token is required. Set TELEGRAM_TOKEN environment variable.');
  }
  
  // Initialize the bot with the canonical dependencies object
  const bot = createTelegramBot({ ...dependencies, disabledFeatures: DISABLED_FEATURES }, token, { polling: true, ...options });
  
  // Register feedback command
  const { setReaction } = require('./utils/telegramUtils');
  const executionClient = require('../../utils/serverExecutionClient');

  const { isAdmin, removeKeyboard, updateBotCommands, resetChatState, getChatDetails, deleteAllScopedCommands } = require('./utils/adminUtils');

  bot.onText(/^\/feedback(?:@\w+)?\s+(.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const feedbackText = match[1];
    const feedbackChatId = process.env.TELEGRAM_FEEDBACK_CHAT_ID;

    try {
      await setReaction(bot, chatId, msg.message_id, '📝');

      if (!feedbackChatId) {
        logger.error('TELEGRAM_FEEDBACK_CHAT_ID not set');
        await bot.sendMessage(chatId, 'Sorry, feedback system is not properly configured.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '😨');
        return;
      }

      const feedbackMessage = `Feedback from ${msg.from.first_name} (@${msg.from.username || 'no_username'}):\n\n${feedbackText}`;
      await bot.sendMessage(feedbackChatId, feedbackMessage);
      await bot.sendMessage(chatId, 'Thank you for your feedback!', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /feedback] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Sorry, something went wrong while sending your feedback.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Register /again command if not disabled
  if (!DISABLED_FEATURES.again) {
    bot.onText(/^\/again(?:@\w+)?$/, async (msg) => {
      const chatId = msg.chat.id;
      const { logger, internalApiClient } = dependencies;

      try {
        await setReaction(bot, chatId, msg.message_id, '🤔');

        // Find or create user to get masterAccountId
        const userResponse = await internalApiClient.post('/internal/v1/data/users/find-or-create', {
          platform: 'telegram',
          platformId: msg.from.id.toString(),
          platformContext: {
            firstName: msg.from.first_name,
            username: msg.from.username,
          },
        });
        const masterAccountId = userResponse.data.masterAccountId;

        // Get user's last generation (may not exist yet)
        let lastGen = null;
        try {
          // 1st attempt: filter by platform
        const lastGenResponse = await internalApiClient.get(`/internal/v1/data/generations/last/${masterAccountId}?platform=telegram`);
          lastGen = lastGenResponse.data;
        } catch (fetchErr) {
          if (fetchErr?.response?.status === 404) {
            // Fallback: retry without platform filter (older records)
            try {
              const fallbackRes = await internalApiClient.get(`/internal/v1/data/generations/last/${masterAccountId}`);
              lastGen = fallbackRes.data;
            } catch (fallbackErr) {
              if (fallbackErr?.response?.status !== 404) {
                throw fallbackErr;
              }
            }
          } else {
            throw fetchErr; // Other error types propagate
          }
        }

        if (!lastGen) {
          await bot.sendMessage(chatId, "You haven't made any requests yet!", { reply_to_message_id: msg.message_id });
          await setReaction(bot, chatId, msg.message_id, '😨');
          return;
        }

        // Create new event for tracking
        const eventResponse = await internalApiClient.post('/internal/v1/data/events', {
          masterAccountId,
          eventType: 'command_used',
          sourcePlatform: 'telegram',
          eventData: {
            command: 'again',
            toolId: lastGen.toolId
          }
        });

        // Prepare execution payload with shuffled seed
        const inputs = { ...lastGen.requestPayload };
        if (inputs.input_seed !== undefined) {
          inputs.input_seed = Math.floor(Math.random() * 1000000000);
        }

        const executionPayload = {
          toolId: lastGen.toolId,
          inputs,
          user: {
            masterAccountId,
            platform: 'telegram',
            platformId: msg.from.id.toString(),
            platformContext: {
              firstName: msg.from.first_name,
              username: msg.from.username,
              chatId: msg.chat.id,
              messageId: msg.message_id,
            },
          },
          eventId: eventResponse.data._id,
          metadata: {
            platform: 'telegram',
            notificationContext: {
              chatId: msg.chat.id,
              messageId: msg.message_id,
              replyToMessageId: msg.message_id,
              userId: msg.from.id,
            }
          }
        };

        // Execute via central ExecutionClient
        const execResult = await executionClient.execute(executionPayload);

        if (execResult.final && execResult.outputs && execResult.outputs.response) {
          await bot.sendMessage(chatId, execResult.outputs.response, { reply_to_message_id: msg.message_id });
          await setReaction(bot, chatId, msg.message_id, '👌');
          return;
        }

        logger.info(`[Telegram /again] Job submitted via execution service. Gen ID: ${execResult.generationId}`);
        await setReaction(bot, chatId, msg.message_id, '👌');

      } catch (err) {
        let userMessage = 'Sorry, something went wrong while repeating your last request.';
        
        if (err.response?.data?.error?.code === 'INSUFFICIENT_FUNDS') {
          userMessage = 'You do not have enough points to run this. Purchase more with /buypoints or view your balance with /account.';
        } else if (err.response?.data?.error?.code === 'WALLET_NOT_FOUND') {
          userMessage = 'You need to connect a wallet before running this. Link your wallet using /account, then purchase points with /buypoints.';
        }

        logger.error(`[Telegram /again] Error: ${err.message}`, { stack: err.stack });
        await bot.sendMessage(chatId, userMessage, { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '😨');
      }
    });
  }
  
  logger.info('Telegram platform initialized');
  
  // Return an object with the bot and a setup function for dynamic commands
  // Note: We no longer set commands at startup - use /updateCommands instead

  // Admin command: resetKeyboard - Removes stuck keyboard
  bot.onText(/^\/resetKeyboard(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🤔');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      await removeKeyboard(bot, chatId);
      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /resetKeyboard] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error removing keyboard.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Admin command: resetChat - Full chat state reset
  bot.onText(/^\/resetChat(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🤔');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      await resetChatState(bot, chatId);
      await bot.sendMessage(chatId, 'Chat state has been reset.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /resetChat] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error resetting chat state.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Admin command: deleteCommands - Delete all bot commands
  bot.onText(/^\/deleteCommands(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🤔');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      await deleteAllScopedCommands(bot);
      await bot.sendMessage(chatId, 'All bot commands have been deleted.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /deleteCommands] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error deleting bot commands.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Admin command: updateCommands - Force update bot commands
  bot.onText(/^\/updateCommands(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🤔');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      // Re-register all commands
  const commands = [
        { command: 'account', description: 'View your account information' },
        { command: 'buypoints', description: 'Purchase points' },
        { command: 'status', description: 'View your status' },
        { command: 'settings', description: 'View your settings' },
        { command: 'tools', description: 'View your tools' },
        { command: 'again', description: 'Repeat your last request' },
        { command: 'feedback', description: 'Send feedback about the bot' }
      ];

      // First delete all commands from all scopes
      const scopes = [
        { type: 'default' },
        { type: 'all_private_chats' },
        { type: 'all_group_chats' },
        { type: 'all_chat_administrators' }
      ];

      // Delete from all scopes
      for (const scope of scopes) {
        await bot.deleteMyCommands({ scope });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between deletions
      }

      // Wait a bit longer for cache invalidation
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Set commands only for private chats since that's where we're testing
      await updateBotCommands(bot, commands, { type: 'all_private_chats' });
      await bot.sendMessage(chatId, 'Bot commands have been updated.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /updateCommands] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error updating bot commands.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Admin command: inspectCommands - Get detailed command info
  bot.onText(/^\/inspectCommands(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🤔');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      const scopes = [
        { type: 'default' },
        { type: 'all_private_chats' },
        { type: 'all_group_chats' },
        { type: 'all_chat_administrators' }
      ];

      const languages = ['', 'en'];
      const results = {};

      // Check each scope and language combination
      for (const scope of scopes) {
        results[scope.type] = {};
        // Try with no language code
        try {
          results[scope.type]['no_lang'] = await bot.getMyCommands({ scope });
        } catch (err) {
          results[scope.type]['no_lang'] = `Error: ${err.message}`;
        }
        
        // Try with specific languages
        for (const lang of languages) {
          try {
            results[scope.type][lang || 'empty'] = await bot.getMyCommands({ scope, language_code: lang });
          } catch (err) {
            results[scope.type][lang || 'empty'] = `Error: ${err.message}`;
          }
        }
      }

      // Try without any scope
      try {
        results['no_scope'] = await bot.getMyCommands();
      } catch (err) {
        results['no_scope'] = `Error: ${err.message}`;
      }

      // Format a summary message
      let summary = 'Command Configuration Summary:\n\n';
      
      for (const [scopeName, scopeData] of Object.entries(results)) {
        summary += `Scope: ${scopeName}\n`;
        if (typeof scopeData === 'object') {
          for (const [langName, commands] of Object.entries(scopeData)) {
            if (Array.isArray(commands) && commands.length > 0) {
              summary += `  ${langName}:\n    ${commands.map(c => c.command).join(', ')}\n`;
            } else if (Array.isArray(commands) && commands.length === 0) {
              summary += `  ${langName}: No commands\n`;
            } else {
              summary += `  ${langName}: ${commands}\n`;
            }
          }
        } else if (Array.isArray(scopeData)) {
          summary += `  Commands: ${scopeData.map(c => c.command).join(', ')}\n`;
        } else {
          summary += `  ${scopeData}\n`;
        }
        summary += '\n';
      }

      // Send as a single formatted message
      await bot.sendMessage(chatId, `\`\`\`\n${summary}\`\`\``, {
        parse_mode: 'Markdown',
        reply_to_message_id: msg.message_id
      });

      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /inspectCommands] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error inspecting commands.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Admin command: chatInfo
  bot.onText(/^\/chatInfo(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🔍');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      const chatInfo = JSON.stringify(msg, null, 2);
      await bot.sendMessage(chatId, `Chat Info:\n\`\`\`json\n${chatInfo}\n\`\`\``, {
        reply_to_message_id: msg.message_id,
        parse_mode: 'Markdown'
      });
      await setReaction(bot, chatId, msg.message_id, '👌');

    } catch (err) {
      logger.error(`[Telegram /chatInfo] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error retrieving chat info.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // Admin command: gift points
  bot.onText(/^\/gift(?:@\w+)?\s+(\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;
    const points = parseInt(match[1], 10);

    try {
      await setReaction(bot, chatId, msg.message_id, '🎁');

      if (!msg.reply_to_message) {
        await bot.sendMessage(chatId, 'Please reply to a message from the user you want to gift points to.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '❌');
        return;
      }

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '👎');
        return;
      }

      const targetUserId = msg.reply_to_message.from.id;
      
      // Get target user's master account
      const userResponse = await internalApiClient.post('/internal/v1/data/users/find-or-create', {
        platform: 'telegram',
        platformId: targetUserId.toString(),
        platformContext: {
          firstName: msg.reply_to_message.from.first_name,
          username: msg.reply_to_message.from.username,
        },
      });
      const masterAccountId = userResponse.data.masterAccountId;

      // Create ledger entry
      await internalApiClient.post('/internal/v1/data/credit/ledger', {
        master_account_id: masterAccountId,
        status: 'CONFIRMED',
        type: 'ADMIN_GIFT',
        description: `Admin gift from ${msg.from.first_name}`,
        points_credited: points,
        points_remaining: points,
        source: 'admin_gift',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await bot.sendMessage(chatId, `Successfully gifted ${points} points to user.`, { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '✅');

    } catch (err) {
      logger.error(`[Telegram /gift] Error: ${err.message}`, { stack: err.stack });
      await bot.sendMessage(chatId, 'Error processing gift command.', { reply_to_message_id: msg.message_id });
      await setReaction(bot, chatId, msg.message_id, '😨');
    }
  });

  // /groupsettings command
  bot.onText(/^\/groupsettings(?:@\w+)?$/, async (msg) => {
    if (msg.chat.type === 'private') return; // only for groups
    const { showGroupSettingsMenu } = require('./components/groupMenuManager');
    await showGroupSettingsMenu(bot, msg, dependencies);
  });

  // Callback query handler – delegate to group menu
  bot.on('callback_query', async (query) => {
    const { handleCallbackQuery } = require('./components/groupMenuManager');
    const handled = await handleCallbackQuery(bot, query, dependencies);
    if (!handled) return; // let others handle
  });

  return {
    bot,
    async setupCommands() {
      try {
        // Ensure WorkflowCacheManager has fully initialized (populating ToolRegistry) before registering commands.
        const cacheManager = WorkflowCacheManager.getInstance();
        const timeoutMs = 30000; // 30-second safety cap

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`WorkflowCacheManager initialization timed out after ${timeoutMs}ms`)), timeoutMs)
        );

        let initialized = false;
        try {
          await Promise.race([cacheManager.initialize(), timeoutPromise]);
          initialized = true;
        } catch (initErr) {
          logger.warn(`[Telegram] WorkflowCacheManager did not fully initialize: ${initErr.message}`);
        }

        // Poll ToolRegistry for readiness (non-zero tools) up to same timeout
        const start = Date.now();
        const registry = dependencies.toolRegistry;
        while ((registry?.getAllTools()?.length || 0) === 0 && Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, 200));
        }

        logger.info(`[Telegram] ToolRegistry ready? ${initialized}. Tools count: ${registry?.getAllTools()?.length || 0}.`);

        // Pass the commandRegistry instance from dependencies to the setup function.
        // It will return a list of commands to be registered with the Telegram API.
        const commandsToRegister = await setupDynamicCommands(dependencies.commandRegistry, { ...dependencies, disabledFeatures: DISABLED_FEATURES });
        
        if (commandsToRegister && commandsToRegister.length > 0) {
            await bot.setMyCommands(commandsToRegister);
            logger.info(`Telegram bot dynamic commands configured: ${commandsToRegister.length} commands registered.`);
        } else {
            logger.info('No dynamic commands were registered.');
        }

      } catch (error) {
        logger.error('Failed to setup dynamic commands (via setupCommands method):', error);
      }
    }
  };
}

module.exports = {
  initializeTelegramPlatform
}; 