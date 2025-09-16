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

async function handleContractAddressCommand(bot, message, dependencies) {
  const caMessage = "`0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820`\n";
  
  const keyboard = {
    inline_keyboard: [
      [
        { 
          text: 'Chart', 
          url: 'https://www.coingecko.com/en/coins/station-this'
        },
        {
          text: 'Buy',
          url: 'https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0x0000000000c5dc95539589fbd24be07c6c14eca4&outputCurrency=0x98ed411b8cf8536657c660db8aa55d9d4baaf820'
        }
      ],
      [
        {
          text: 'Bridge MS2',
          url: 'https://portalbridge.com/'
        }
      ],
      [
        {
          text: 'Site',
          url: 'https://miladystation2.net'
        },
        {
          text: 'Web Platform',
          url: 'https://noema.art'
        }
      ]
    ]
  };

  await bot.sendMessage(message.chat.id, caMessage, {
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard,
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
• /ca - View contract address and trading info

Account & Points:
• /wallet - Connect or manage your wallet
• /account - View your account details
• /buypoints - Purchase points for generations

Creation Tools:
• /tools - Access available creation tools and workflows
• /settings - Configure your preferences

Need more help? Feel free to check our documentation or join our community!
`;

  await bot.sendMessage(message.chat.id, helpMessage, {
    parse_mode: 'Markdown',
    reply_to_message_id: message.message_id
  });
}

function registerHandlers(dispatcherInstances, dependencies) {
  const { commandDispatcher, callbackQueryDispatcher } = dispatcherInstances;

  // Register /start command
  commandDispatcher.register(/^\/start(?:@\w+)?$/i, (bot, message, deps) => 
    handleStartCommand(bot, message, deps)
  );

  // Register /help command
  commandDispatcher.register(/^\/help(?:@\w+)?$/i, (bot, message, deps) => 
    handleHelpCommand(bot, message, deps)
  );

  // Register /ca command
  commandDispatcher.register(/^\/ca(?:@\w+)?$/i, (bot, message, deps) => 
    handleContractAddressCommand(bot, message, deps)
  );
}

module.exports = {
  registerHandlers
}; 