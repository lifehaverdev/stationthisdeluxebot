/**
 * Info Manager - Handles basic informational commands like /start and /help
 */

async function handleStartCommand(bot, message, dependencies) {
  const welcomeMessage = `
Welcome to StationThis Deluxe Bot! 🎨

This bot helps you create amazing AI-generated art and manage your creative workflows. Here's how to get started:

1. Connect your wallet using /wallet or /account
2. Buy points using /buypoints to start creating
3. Access available tools with /tools

Once you're set up, you can start creating and exploring all our features!

Type /help to see a full list of available commands.
`;

  await bot.sendMessage(message.chat.id, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_to_message_id: message.message_id
  });
}

async function handleHelpCommand(bot, message, dependencies) {
  const helpMessage = `
*Available Commands:*

Basic Commands:
• /start - Show welcome message and getting started guide
• /help - Display this help message
• /status - Check bot and service status

Account & Points:
• /wallet - Connect or manage your wallet
• /account - View your account details
• /buypoints - Purchase points for generations

Creation Tools:
• /tools - Access available creation tools and workflows
• /collections - Manage your image collections
• /settings - Configure your preferences

Generation Commands:
• /rate - Rate generated images
• /rerun - Regenerate a previous creation
• /tweak - Modify parameters of a previous generation

Need more help? Feel free to check our documentation or join our community!
`;

  await bot.sendMessage(message.chat.id, helpMessage, {
    parse_mode: 'Markdown',
    reply_to_message_id: message.message_id
  });
}

function registerHandlers(dispatcherInstances, dependencies) {
  const { commandDispatcher } = dispatcherInstances;

  // Register /start command
  commandDispatcher.register(/^\/start(?:@\w+)?$/i, (bot, message, deps) => 
    handleStartCommand(bot, message, deps)
  );

  // Register /help command
  commandDispatcher.register(/^\/help(?:@\w+)?$/i, (bot, message, deps) => 
    handleHelpCommand(bot, message, deps)
  );
}

module.exports = {
  registerHandlers
};
