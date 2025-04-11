/**
 * Telegram Command Handler
 * 
 * Handles Telegram commands by routing them through the internal API.
 */

const { runCommand } = require('../../core/internalAPI');
const { Logger } = require('../../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'telegram-command'
});

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
 * Parse command arguments from a Telegram message
 * @param {string} text - Message text
 * @param {string} command - Command name
 * @returns {Object} - Parsed arguments
 */
function parseArgs(text, command) {
  // Remove the command from the text
  const argsText = text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`), '').trim();
  
  // If there are no arguments, return an empty object
  if (!argsText) {
    return {};
  }
  
  // Try to parse as JSON if it starts with { or [
  if (argsText.startsWith('{') || argsText.startsWith('[')) {
    try {
      return JSON.parse(argsText);
    } catch (error) {
      // If it's not valid JSON, continue with simple parsing
    }
  }
  
  // Simple parsing: split by spaces and create key-value pairs
  // Format: key1=value1 key2="value with spaces"
  const args = {};
  const regex = /([^\s=]+)=(?:"([^"]+)"|([^\s]+))/g;
  let match;
  
  while ((match = regex.exec(argsText)) !== null) {
    const key = match[1];
    const value = match[2] || match[3]; // Either quoted or non-quoted value
    args[key] = value;
  }
  
  // If no key-value pairs were found, use the text as a 'text' argument
  if (Object.keys(args).length === 0) {
    args.text = argsText;
  }
  
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
      } else {
        // Default success message with result data
        let responseText = 'Command executed successfully';
        
        if (result.result) {
          try {
            // Try to include the result as JSON
            const resultStr = JSON.stringify(result.result, null, 2);
            if (resultStr.length < 800) { // Prevent massive messages
              responseText += `\n\nResult:\n${resultStr}`;
            }
          } catch (error) {
            // If JSON stringify fails, just use the success message
          }
        }
        
        await bot.sendMessage(msg.chat.id, responseText, { 
          reply_to_message_id: msg.message_id 
        });
      }
    } else {
      // Handle error
      await bot.sendMessage(msg.chat.id, `Error: ${result.error}`, { 
        reply_to_message_id: msg.message_id 
      });
    }
  } catch (error) {
    logger.error('Error handling Telegram command', { 
      command, 
      userId: msg.from.id,
      error 
    });
    
    // Send error message
    await bot.sendMessage(msg.chat.id, 'An error occurred while processing your command', { 
      reply_to_message_id: msg.message_id 
    });
  }
}

/**
 * Register command handlers with a Telegram bot
 * @param {Object} bot - Telegram bot instance
 * @param {Object[]} commands - Array of command definitions
 */
function registerCommandHandlers(bot, commands) {
  commands.forEach(command => {
    // Create regex pattern for the command
    const pattern = new RegExp(`^/${command.name}(@\\w+)?\\s*`);
    
    // Register handler
    bot.onText(pattern, (msg) => {
      handleCommand(bot, msg, command.name);
    });
    
    logger.info(`Registered Telegram handler for /${command.name}`);
  });
}

module.exports = {
  handleCommand,
  registerCommandHandlers,
  createSessionContext,
  parseArgs
}; 