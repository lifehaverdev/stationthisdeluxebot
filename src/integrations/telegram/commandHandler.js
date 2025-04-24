/**
 * Telegram Command Handler
 * 
 * Handles Telegram commands by routing them through the internal API.
 */

const { runCommand } = require('../../core/internalAPI');
const { createLogger } = require('../../utils/logger');
const TelegramSessionAdapter = require('./adapters/sessionAdapter');
const { CommandRegistry } = require('../../core/command/registry');
const { WorkflowManager } = require('../../core/workflow/manager');

// Initialize logger
const logger = createLogger('telegram-command');

// Get singleton instances of required components
const commandRegistry = CommandRegistry.getInstance();
const workflowManager = global.workflowManager;

/**
 * Create a session context object from a Telegram message
 * @param {Object} msg - Telegram message object
 * @returns {Object} - Session context
 */
function createSessionContext(msg) {
  return {
    userId: msg.from.id.toString(),
    userInfo: {
      username: msg.from.username,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name,
      languageCode: msg.from.language_code
    },
    platform: {
      type: 'telegram',
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      messageId: msg.message_id
    }
  };
}

/**
 * Parse command arguments from message text
 * @param {string} text - Message text
 * @param {string} command - Command name to parse
 * @returns {Object} - Parsed arguments
 */
function parseArgs(text, command) {
  // Skip the command itself and parse the rest as args
  const parts = text.split(/\s+/);
  const commandPart = parts[0].substring(1).split('@')[0]; // Remove leading / and any trailing @botname
  
  if (commandPart !== command) {
    return {};
  }
  
  // Extract args based on space-separated values
  const args = {};
  
  // Extract named arguments in form --name=value or --flag
  const namedArgsRegex = /--([a-zA-Z0-9_]+)(?:=([^\s]+))?/g;
  let match;
  
  while ((match = namedArgsRegex.exec(text)) !== null) {
    const key = match[1];
    const value = match[2] === undefined ? true : match[2];
    args[key] = value;
  }
  
  // Return args
  return args;
}

/**
 * Handle a command from a Telegram message
 * @param {Object} bot - Telegram bot instance
 * @param {Object} msg - Telegram message
 * @param {string} command - Command name
 * @returns {Promise<void>}
 */
async function handleCommand(bot, msg, command) {
  try {
    logger.info('Handling Telegram command', { 
      command, 
      userId: msg.from.id,
      chatId: msg.chat.id
    });
    
    // Create session adapter if not already created
    const sessionAdapter = new TelegramSessionAdapter({
      bot,
      commandRegistry,
      workflowManager,
      logger
    });
    
    // Initialize session first
    await sessionAdapter.handleMessage(msg);
    
    // Create session context
    const sessionContext = createSessionContext(msg);
    
    // Parse arguments
    const args = parseArgs(msg.text, command);
    
    // Execute command through internal API
    const result = await runCommand(command, args, sessionContext);
    
    // Handle result
    if (result.status === 'ok') {
      // Check if the result includes a specific response
      if (result.result && result.result.telegram) {
        // Use telegram-specific response if available
        const telegramResponse = result.result.telegram;
        
        if (telegramResponse.type === 'text') {
          await bot.sendMessage(msg.chat.id, telegramResponse.text, telegramResponse.options);
        } else if (telegramResponse.type === 'photo') {
          await bot.sendPhoto(msg.chat.id, telegramResponse.photo, telegramResponse.options);
        } else if (telegramResponse.type === 'document') {
          await bot.sendDocument(msg.chat.id, telegramResponse.document, telegramResponse.options);
        } else {
          // Default to sending as text
          await bot.sendMessage(msg.chat.id, 'Command executed successfully', { 
            reply_to_message_id: msg.message_id 
          });
        }
      } else if (result.result && typeof result.result === 'string') {
        // Send plain text response
        await bot.sendMessage(msg.chat.id, result.result, { 
          parse_mode: 'Markdown',
          reply_to_message_id: msg.message_id 
        });
      } else {
        // Send default success message
        await bot.sendMessage(msg.chat.id, 'Command executed successfully', { 
          reply_to_message_id: msg.message_id 
        });
      }
    } else {
      // Send error message
      await bot.sendMessage(msg.chat.id, `❌ Error: ${result.error}`, { 
        reply_to_message_id: msg.message_id 
      });
    }
  } catch (error) {
    logger.error('Error handling command', { command, error });
    
    // Send error message
    await bot.sendMessage(msg.chat.id, '❌ An error occurred while processing your command', { 
      reply_to_message_id: msg.message_id 
    });
  }
}

/**
 * Register command handlers with the Telegram bot
 * @param {Object} bot - Telegram bot instance
 * @param {Array} commands - Array of commands to register
 */
function registerCommandHandlers(bot, commands) {
  if (!Array.isArray(commands)) {
    throw new Error('Commands must be an array');
  }
  
  // Create a single session adapter instance to reuse
  const sessionAdapter = new TelegramSessionAdapter({
    bot,
    commandRegistry,
    workflowManager,
    logger
  });
  
  // Register command handlers
  commands.forEach(command => {
    const commandPattern = new RegExp(`^/${command.name}(?:@\\w+)?(?:\\s+(.*))?$`);
    
    bot.onText(commandPattern, async (msg) => {
      try {
        // Initialize session first
        await sessionAdapter.handleMessage(msg);
        
        // Handle the command
        await handleCommand(bot, msg, command.name);
      } catch (error) {
        logger.error('Error in command handler', { command: command.name, error });
      }
    });
    
    logger.info(`Registered handler for /${command.name}`);
  });
  
  // Handle all non-command messages for workflow interactions
  bot.on('message', async (msg) => {
    // Skip command messages, they're handled by the command handlers
    if (msg.text && msg.text.startsWith('/')) {
      return;
    }
    
    try {
      // Route message through session adapter
      const result = await sessionAdapter.routeMessage(msg);
      
      // Handle different routing outcomes
      if (result.type === 'workflow') {
        // Continue workflow with this input
        await workflowManager.continueWorkflow(
          result.workflowId,
          result.sessionInfo.userId,
          result.input
        );
      } else if (result.type === 'default') {
        // Send help message
        await sessionAdapter.sendHelpMessage(msg);
      }
    } catch (error) {
      logger.error('Error handling message', { error });
    }
  });
  
  logger.info('Registered handler for non-command messages');
}

module.exports = {
  handleCommand,
  registerCommandHandlers,
  createSessionContext,
  parseArgs
}; 