/**
 * Commands Index
 * 
 * Exports all bot commands and provides a registration function
 */

const { startCommand } = require('./startCommand');
const { helpCommand } = require('./helpCommand');
const { settingsCommand } = require('./settingsCommand');
const { imageCommand, audioCommand, videoCommand } = require('./mediaCommands');
// ... import other commands

/**
 * Register all commands with the bot
 * @param {Object} bot - Telegraf bot instance
 */
async function registerCommands(bot) {
  // Register commands
  bot.command('start', startCommand);
  bot.command('help', helpCommand);
  bot.command('settings', settingsCommand);
  
  // Media commands
  bot.command('images', imageCommand);
  bot.command('audios', audioCommand);
  bot.command('videos', videoCommand);
  
  // ... register other commands
  
  // Set command list in Telegram
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'help', description: 'Show help information' },
    { command: 'settings', description: 'Configure your settings' },
    { command: 'images', description: 'Manage your images' },
    { command: 'audios', description: 'Manage your audio files' },
    { command: 'videos', description: 'Manage your video files' },
    // ... other commands
  ]);
}

module.exports = {
  registerCommands,
  startCommand,
  helpCommand,
  settingsCommand,
  imageCommand,
  audioCommand,
  videoCommand,
  // ... export other commands
}; 