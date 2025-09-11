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

  // Admin check helper function
  async function isAdmin(userId, internalApiClient) {
    try {
      // Find or get master account
      const userResponse = await internalApiClient.post('/internal/v1/data/users/find-or-create', {
        platform: 'telegram',
        platformId: userId.toString(),
      });
      const masterAccountId = userResponse.data.masterAccountId;

      // Check admin flag in userCore
      const userCoreResponse = await internalApiClient.get(`/internal/v1/data/users/core/${masterAccountId}`);
      return userCoreResponse.data?.isAdmin === true;
    } catch (err) {
      return false;
    }
  }

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

        // Get user's last generation
        const lastGenResponse = await internalApiClient.get(`/internal/v1/data/generations/last/${masterAccountId}?platform=telegram`);
        const lastGen = lastGenResponse.data;

        if (!lastGen) {
          await bot.sendMessage(chatId, "You haven't made any requests yet!", { reply_to_message_id: msg.message_id });
          await setReaction(bot, chatId, msg.message_id, '😅');
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
  // Register user-facing commands in menu
  const commands = [
    {
      command: 'account',
      description: 'View your account information'
    },
    {
      command: 'buypoints',
      description: 'Purchase points'
    },
    {
      command: 'status',
      description: 'View your status'
    },
    {
      command: 'settings',
      description: 'View your settings'
    },
    {
      command: 'tools',
      description: 'View your tools'
    },
    {
      command: 'again',
      description: 'Repeat your last request'
    },
    {
      command: 'feedback',
      description: 'Send feedback about the bot'
    }
  ];
  bot.setMyCommands(commands);

  // Admin command: chatInfo
  bot.onText(/^\/chatInfo(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const { logger, internalApiClient } = dependencies;

    try {
      await setReaction(bot, chatId, msg.message_id, '🔍');

      if (!await isAdmin(msg.from.id, internalApiClient)) {
        await bot.sendMessage(chatId, 'This command is only available to admins.', { reply_to_message_id: msg.message_id });
        await setReaction(bot, chatId, msg.message_id, '🚫');
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
        await setReaction(bot, chatId, msg.message_id, '🚫');
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