/**
 * Admin Utilities for Telegram Bot Management
 * 
 * Collection of utility functions for admin operations like:
 * - Managing keyboards
 * - Updating commands
 * - Running maintenance tasks
 * - Fixing user states
 */

const { setReaction } = require('./telegramUtils');

/**
 * Checks if a user is an admin
 * @param {number} telegramId - Telegram user ID
 * @param {Object} internalApiClient - Internal API client
 * @returns {Promise<boolean>} - True if user is admin
 */
async function isAdmin(telegramId, internalApiClient) {
  try {
    // Find or get master account
    const userResponse = await internalApiClient.post('/internal/v1/data/users/find-or-create', {
      platform: 'telegram',
      platformId: telegramId.toString(),
    });
    const masterAccountId = userResponse.data.masterAccountId;

    // Check admin flag in userCore
    const userCoreResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}`);
    const isAdminUser = userCoreResponse.data?.isAdmin === true;
    return isAdminUser;
  } catch (err) {
    console.error(`[isAdmin] Error checking admin status:`, err);
    return false;
  }
}

/**
 * Removes any stuck keyboard for a specific chat
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID to remove keyboard from
 * @param {string} [text='Keyboard removed.'] - Optional message to send with removal
 */
async function removeKeyboard(bot, chatId, text = 'Keyboard removed.') {
  try {
    await bot.sendMessage(chatId, text, {
      reply_markup: {
        remove_keyboard: true
      }
    });
  } catch (err) {
    console.error('[adminUtils] Error removing keyboard:', err);
    throw err;
  }
}

/**
 * Updates bot commands globally or for specific scope
 * @param {Object} bot - Telegram bot instance
 * @param {Array} commands - Array of command objects { command: string, description: string }
 * @param {Object} [scope] - Optional scope object { type: 'default'|'all_private_chats'|'all_group_chats'|'all_chat_administrators' }
 */
/**
 * Delete commands for all possible scopes
 */
async function deleteAllScopedCommands(bot) {
  // First, clear the default scope which has all the workflow commands
  try {
    // Clear with no language code
    await bot.deleteMyCommands({ scope: { type: 'default' } });
    await bot.setMyCommands([], { scope: { type: 'default' } });
    
    // Clear with empty language code (this is where we see the commands)
    await bot.deleteMyCommands({ scope: { type: 'default' }, language_code: '' });
    await bot.setMyCommands([], { scope: { type: 'default' }, language_code: '' });
    
  } catch (err) {
    console.warn('[adminUtils] Error clearing default scope:', err.message);
  }

  // Clear no-scope commands which might be causing issues
  try {
    await bot.deleteMyCommands();
    await bot.setMyCommands([]);
  } catch (err) {
    console.warn('[adminUtils] Error clearing no-scope commands:', err.message);
  }

  // Now set our desired commands in private_chats scope
  const commands = [
    { command: 'account', description: 'View your account information' },
    { command: 'buypoints', description: 'Purchase points' },
    { command: 'status', description: 'View your status' },
    { command: 'settings', description: 'View your settings' },
    { command: 'tools', description: 'View your tools' },
    { command: 'again', description: 'Repeat your last request' },
    { command: 'feedback', description: 'Send feedback about the bot' }
  ];

  try {
    await bot.setMyCommands(commands, { 
      scope: { type: 'all_private_chats' },
      language_code: ''
    });
  } catch (err) {
    console.warn('[adminUtils] Error setting private chat commands:', err.message);
  }
}

/**
 * Get commands for all possible scopes
 */
async function getAllScopedCommands(bot) {
  const scopes = [
    { type: 'default' },
    { type: 'all_private_chats' },
    { type: 'all_group_chats' },
    { type: 'all_chat_administrators' }
  ];

  const results = {};
  for (const scope of scopes) {
    try {
      const commands = await bot.getMyCommands({ scope });
      results[scope.type] = commands;
    } catch (err) {
      console.warn(`[adminUtils] Error getting commands for scope ${scope.type}:`, err.message);
    }
  }
  return results;
}

async function updateBotCommands(bot, commands, scope = { type: 'default' }) {
  try {
    await getAllScopedCommands(bot);
    await deleteAllScopedCommands(bot);

    // Wait a moment for deletions to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Set new commands for specified scope
    if (scope.type === 'default') {
      await bot.setMyCommands(commands);
    } else {
      await bot.setMyCommands(commands, { scope });
    }

    const finalCommands = await getAllScopedCommands(bot);
    return finalCommands;
  } catch (err) {
    console.error('[adminUtils] Error updating bot commands:', err);
    throw err;
  }
}

/**
 * Resets chat to a clean state (removes keyboard, clears commands, etc)
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID to reset
 */
async function resetChatState(bot, chatId) {
  try {
    // Remove any existing keyboard
    await removeKeyboard(bot, chatId, 'Resetting chat state...');
    
    // Could add more reset operations here as needed
  } catch (err) {
    console.error('[adminUtils] Error resetting chat state:', err);
    throw err;
  }
}

/**
 * Gets detailed information about a chat
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID to get info for
 */
async function getChatDetails(bot, chatId) {
  try {
    const chat = await bot.getChat(chatId);
    const botMember = await bot.getChatMember(chatId, bot.botInfo.id);
    return {
      chat,
      botMember,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error('[adminUtils] Error getting chat details:', err);
    throw err;
  }
}

// Export all utility functions
module.exports = {
  isAdmin,
  removeKeyboard,
  updateBotCommands,
  resetChatState,
  getChatDetails,
  deleteAllScopedCommands
};
