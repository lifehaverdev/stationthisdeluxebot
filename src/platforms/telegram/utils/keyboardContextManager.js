const cleanedUsers = new Set();

// Canonical main menu shown as a persistent reply keyboard
const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [
        { text: '/account' },
        { text: '/status' },
        { text: '/settings' },
        { text: '/tools' }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

const KEYBOARD_VERSION = 1;

/**
 * Ensure that a user in a private chat has the correct keyboard.
 * Performs a one-time cleanup by removing the existing keyboard and
 * immediately sending the canonical main menu keyboard.
 *
 * @param {TelegramBot} bot
 * @param {Telegram.Message} message
 */
async function ensureCleanKeyboard(bot, message, deps) {
  if (!message || message.chat.type !== 'private') return;

  const userId = message.from?.id;
  const masterAccountId = deps?.user?.masterAccountId;
  const prefsDb = deps?.db?.userPreferences;
  if (!userId || !masterAccountId || !prefsDb) return;

  const currentVersion = await prefsDb.getKeyboardVersion(masterAccountId);
  if (currentVersion >= KEYBOARD_VERSION) return;

  try {
    await bot.sendMessage(message.chat.id, '\u2060', { reply_markup: { remove_keyboard: true } });
    await bot.sendMessage(message.chat.id, 'Here\'s your updated menu \u2728', mainMenuKeyboard);
    await prefsDb.setKeyboardVersion(masterAccountId, KEYBOARD_VERSION);
  } catch (err) {
    console.error('[KeyboardContext] Failed cleaning keyboard:', err);
  }
}

module.exports = {
  ensureCleanKeyboard,
  mainMenuKeyboard
};
