/**
 * Discord Platform Adapter
 * 
 * Main entry point for the Discord bot implementation.
 * This file sets up the bot, initializes the dispatchers, and registers all feature handlers.
 *
 * Canonical Dependency Injection Pattern:
 * - All handlers and managers receive the full `dependencies` object.
 * - All internal API calls must use `dependencies.services.internal.client`.
 * - There should be no top-level `internalApiClient` in dependencies.
 */

const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { settings } = require('../../workflows');

// --- Dispatcher Imports ---
const { ButtonInteractionDispatcher, SelectMenuInteractionDispatcher, CommandDispatcher, DynamicCommandDispatcher, MessageReplyDispatcher } = require('./dispatcher');
const replyContextManager = require('./utils/replyContextManager.js');

// --- Legacy Command Handlers (will be migrated to dispatchers) ---
const createUpscaleCommandHandler = require('./commands/upscaleCommand');
const createSettingsCommandHandler = require('./commands/settingsCommand');
const createCollectionsCommandHandler = require('./commands/collectionsCommand');
const createTrainModelCommandHandler = require('./commands/trainModelCommand');
const createStatusCommandHandler = require('./commands/statusCommand');

// --- Component Managers ---
const settingsMenuManager = require('./components/settingsMenuManager');
// const modsMenuManager = require('./components/modsMenuManager');
// const walletManager = require('./components/walletManager');
// ... etc

/**
 * Create and configure the Discord bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Discord bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createDiscordBot(dependencies, token, options = {}) {
  const { logger = console, commandRegistry } = dependencies;
  
  // Store app start time for the status command
  const appStartTime = new Date();
  
  // Create Discord client with necessary intents
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ]
  });
  
  // Create a collection to store commands (legacy, will be migrated to dispatchers)
  client.commands = new Collection();
  
  // Track bot startup time to filter old messages
  const botStartupTime = Date.now();
  const MESSAGE_AGE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

  // --- Initialize Dispatchers ---
  const buttonInteractionDispatcher = new ButtonInteractionDispatcher(logger);
  const selectMenuInteractionDispatcher = new SelectMenuInteractionDispatcher(logger);
  const commandDispatcher = new CommandDispatcher(logger);
  const dynamicCommandDispatcher = new DynamicCommandDispatcher(commandRegistry, logger);
  const messageReplyDispatcher = new MessageReplyDispatcher(logger);
  
  // --- Register All Handlers ---
  function registerAllHandlers() {
    const dispatcherInstances = { 
      buttonInteractionDispatcher, 
      selectMenuInteractionDispatcher, 
      commandDispatcher, 
      dynamicCommandDispatcher,
      messageReplyDispatcher
    };
    const allDependencies = { ...dependencies, client, replyContextManager };

    const { disabledFeatures = {} } = dependencies;

    // Register component managers
    settingsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    // modsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    // walletManager.registerHandlers(dispatcherInstances, allDependencies);
    // ... etc

    // Register legacy command handlers with dispatcher for now
    // These will be migrated to component managers later
    const handleStatusCommand = createStatusCommandHandler({
      client,
      services: {
        internal: dependencies.internal
      },
      logger
    });
    commandDispatcher.register('status', handleStatusCommand);

    logger.info('[Discord Bot] All feature handlers registered with dispatchers.');
  }

  registerAllHandlers();

  // --- Legacy Command Handlers (temporary, for backward compatibility) ---
  // These will be migrated to use dispatchers or component managers
  const handleUpscaleCommand = createUpscaleCommandHandler({
    mediaService: dependencies.mediaService,
    client,
    logger
  });
  
  const handleSettingsCommand = createSettingsCommandHandler({
    sessionService: dependencies.sessionService,
    pointsService: dependencies.pointsService,
    client,
    logger
  });
  
  const handleTrainModelCommand = createTrainModelCommandHandler({
    sessionService: dependencies.sessionService,
    workflowsService: dependencies.workflowsService,
    client,
    logger
  });
  
  // Register legacy commands with client.commands collection
  // Note: Status is handled by dispatcher, so we don't register it here to avoid conflicts
  // client.commands.set('make', handleMakeImageCommand); // TODO: Find/create this handler
  client.commands.set('upscale', handleUpscaleCommand);
  client.commands.set('settings', handleSettingsCommand);
  client.commands.set('train', handleTrainModelCommand);
  // Status is registered with dispatcher above, don't duplicate
  
  // Command data for Discord API
  // This defines the slash commands and their options
  const commands = [
    {
      name: 'make',
      description: 'Generate an image with AI',
      options: [
        {
          name: 'prompt',
          description: 'Text prompt describing the image you want to generate',
          type: 3, // STRING type
          required: true
        }
      ]
    },
    {
      name: 'upscale',
      description: 'Enhance the resolution of an image',
      options: [
        {
          name: 'scale',
          description: 'Upscale factor',
          type: 4, // INTEGER type
          required: false,
          choices: [
            {
              name: '2x',
              value: 2
            },
            {
              name: '4x',
              value: 4
            }
          ]
        }
      ]
    },
    {
      name: 'settings',
      description: 'View or modify your image generation settings',
      options: [
        {
          name: 'setting',
          description: 'The setting to change',
          type: 3, // STRING type
          required: false,
          choices: [
            {
              name: 'Size',
              value: 'size'
            },
            {
              name: 'Steps',
              value: 'steps'
            },
            {
              name: 'Batch Size',
              value: 'batch_size'
            },
            {
              name: 'CFG Scale',
              value: 'cfg_scale'
            },
            {
              name: 'Strength',
              value: 'strength'
            },
            {
              name: 'Seed',
              value: 'seed'
            },
            {
              name: 'Checkpoint',
              value: 'checkpoint'
            }
          ]
        },
        {
          name: 'value',
          description: 'The new value for the setting',
          type: 3, // STRING type
          required: false
        }
      ]
    },
    // Collections command
    // createCollectionsCommandHandler.commandData.toJSON(),
    {
      name: 'train',
      description: 'Manage AI model training',
      options: [
        {
          name: 'action',
          description: 'Training action to perform',
          type: 3, // STRING type
          required: true,
          choices: [
            {
              name: 'List',
              value: 'list'
            },
            {
              name: 'Create',
              value: 'create'
            },
            {
              name: 'View',
              value: 'view'
            },
            {
              name: 'Submit',
              value: 'submit'
            }
          ]
        },
        {
          name: 'name',
          description: 'Dataset name or ID',
          type: 3, // STRING type
          required: false
        }
      ]
    },
    {
      name: 'status',
      description: 'Display bot status and runtime information'
    }
  ];
  
  // Register event handlers
  client.on('ready', async () => {
    logger.info(`Discord bot logged in as ${client.user.tag}`);
    
    // Log registered commands for debugging
    logger.info(`Registering ${commands.length} slash commands with Discord API`);
    logger.info(`Command names: ${commands.map(cmd => cmd.name).join(', ')}`);
    logger.info(`Internal handlers: ${Array.from(client.commands.keys()).join(', ')}`);
    
    // Register slash commands
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      
      logger.info('Started refreshing application (/) commands');
      
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      
      logger.info('Successfully registered application commands');
      
      // Force sync client.commands with registered commands
      // This ensures our internal collection matches what we registered
      commands.forEach(cmd => {
        if (!client.commands.has(cmd.name)) {
          logger.warn(`Command ${cmd.name} is registered with Discord but missing a handler!`);
        }
      });
      
    } catch (error) {
      logger.error('Error registering slash commands:', error);
    }
  });
  
  // --- Interaction Event Handlers ---

  // Handle slash commands
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;
      
      const { commandName } = interaction;
      logger.info(`[Discord Bot] Received command: ${commandName}`);
      
      // Try dispatcher first
      const handled = await commandDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      
      if (handled) {
        logger.info(`[Discord Bot] Command ${commandName} handled by dispatcher`);
        return;
      }
      
      // Fallback to legacy command handlers
      const command = client.commands.get(commandName);
      
      if (!command) {
        logger.warn(`[Discord Bot] No handler found for command: ${commandName}`);
        // Try dynamic command dispatcher
        const dynamicHandled = await dynamicCommandDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
        if (dynamicHandled) return;
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Command not found.', flags: 64 }); // Ephemeral flag
        }
        return;
      }
      
      try {
        await command(interaction);
        logger.info(`[Discord Bot] Command ${commandName} executed successfully`);
      } catch (error) {
        logger.error(`[Discord Bot] Error executing command ${commandName}:`, error);
        
        const errorMessage = 'An error occurred while executing this command.';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: 64 }); // Ephemeral flag
        } else {
          await interaction.reply({ content: errorMessage, flags: 64 }); // Ephemeral flag
        }
      }
    } catch (error) {
      logger.error(`[Discord Bot] Unhandled error in command handler: ${error.stack}`);
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Sorry, a critical error occurred.', flags: 64 }); // Ephemeral flag
        } catch (e) {
          logger.error('[Discord Bot] Critical: Failed to reply in error path:', e.stack);
        }
      }
    }
  });
  
  // Handle button interactions
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton()) return;
      
      logger.info(`[Discord Bot] Received button interaction: ${interaction.customId}`);
      
      // Defer update immediately (Discord requires response within 3 seconds)
      await interaction.deferUpdate();
      
      // Try dispatcher
      const handled = await buttonInteractionDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      
      if (handled) {
        logger.info(`[Discord Bot] Button interaction ${interaction.customId} handled by dispatcher`);
        return;
      }
      
      // Legacy button handling (temporary, for backward compatibility)
      const customId = interaction.customId;
      if (customId.startsWith('settings:')) {
        const parts = customId.split(':');
        const settingType = parts[1];
        const settingValue = parts[2];
        
        // Create settings workflow instance
        const settingsWorkflow = settings({ 
          session: dependencies.sessionService, 
          points: dependencies.pointsService, 
          logger 
        });
        
        if (settingType === 'reset') {
          const resetResult = settingsWorkflow.resetSettings(interaction.user.id);
          
          if (resetResult.success) {
            await handleSettingsCommand(interaction);
          } else {
            await interaction.editReply({
              content: `Error resetting settings: ${resetResult.error}`,
              components: []
            });
          }
        } else {
          const updateResult = settingsWorkflow.updateSetting(
            interaction.user.id,
            settingType,
            settingValue
          );
          
          if (updateResult.success) {
            await handleSettingsCommand(interaction);
          } else {
            await interaction.editReply({
              content: `Error updating ${settingType}: ${updateResult.error}`,
              components: []
            });
          }
        }
      }
    } catch (error) {
      logger.error(`[Discord Bot] Unhandled error in button handler: ${error.stack}`);
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Sorry, a critical error occurred.', flags: 64 }); // Ephemeral flag
        } catch (e) {
          logger.error('[Discord Bot] Critical: Failed to reply in error path:', e.stack);
        }
      }
    }
  });
  
  // Handle select menu interactions
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isStringSelectMenu()) return;
      
      logger.info(`[Discord Bot] Received select menu interaction: ${interaction.customId}`);
      
      // Defer update immediately (Discord requires response within 3 seconds)
      await interaction.deferUpdate();
      
      // Try dispatcher
      const handled = await selectMenuInteractionDispatcher.handle(client, interaction, { ...dependencies, replyContextManager });
      
      if (handled) {
        logger.info(`[Discord Bot] Select menu interaction ${interaction.customId} handled by dispatcher`);
        return;
      }
      
      // Legacy select menu handling (temporary, for backward compatibility)
      const customId = interaction.customId;
      if (customId.startsWith('settings:')) {
        const parts = customId.split(':');
        const settingType = parts[1];
        const settingValue = interaction.values[0];
        
          // Create settings workflow instance
          const settingsWorkflow = settings({ 
            session: dependencies.sessionService, 
            points: dependencies.pointsService, 
            logger 
          });
          
          const updateResult = settingsWorkflow.updateSetting(
            interaction.user.id,
            settingType,
            settingValue
          );
        
        if (updateResult.success) {
          await handleSettingsCommand(interaction);
        } else {
          await interaction.editReply({
            content: `Error updating ${settingType}: ${updateResult.error}`,
            components: []
          });
        }
      }
    } catch (error) {
      logger.error(`[Discord Bot] Unhandled error in select menu handler: ${error.stack}`);
      if (interaction && !interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Sorry, a critical error occurred.', flags: 64 }); // Ephemeral flag
        } catch (e) {
          logger.error('[Discord Bot] Critical: Failed to reply in error path:', e.stack);
        }
      }
    }
  });
  
  // Handle message events (for reply context, dynamic commands, etc.)
  client.on('messageCreate', async (message) => {
    try {
      // Ignore bot messages
      if (message.author.bot) return;
      
      // Filter out old messages
      const messageTime = message.createdTimestamp;
      const messageAge = Date.now() - messageTime;
      
      if (messageAge > MESSAGE_AGE_LIMIT_MS) {
        logger.debug(`[Discord Bot] Ignoring old message (age: ${Math.round(messageAge / 1000)}s, limit: ${MESSAGE_AGE_LIMIT_MS / 1000}s)`);
        return;
      }
      
      const fullDependencies = { ...dependencies, replyContextManager };
      
      // Check for replies with a specific context
      if (message.reference && message.reference.messageId) {
        const context = replyContextManager.getContextById(message.channel.id, message.reference.messageId);
        if (context) {
          const handled = await messageReplyDispatcher.handle(client, message, context, fullDependencies);
          if (handled) {
            replyContextManager.removeContextById(message.channel.id, message.reference.messageId);
            return;
          }
        }
      }
      
      // Check for dynamic commands (if message starts with command-like text)
      // Note: Discord primarily uses slash commands, but we can support text commands too
      if (message.content && message.content.startsWith('/')) {
        // Try dynamic command dispatcher
        // Note: This would need to be adapted for Discord's message format
        // const dynamicHandled = await dynamicCommandDispatcher.handle(client, message, fullDependencies);
        // if (dynamicHandled) return;
      }
      
    } catch (error) {
      logger.error(`[Discord Bot] Error processing message: ${error.stack}`);
      try {
        await message.reply('Sorry, an unexpected error occurred.');
      } catch (e) {
        logger.error('[Discord Bot] Failed to send error message:', e);
      }
    }
  });

  // Log errors
  client.on('error', (error) => {
    logger.error('[Discord Bot] Client error:', error);
  });
  
  // Log warnings
  client.on('warn', (warning) => {
    logger.warn('[Discord Bot] Client warning:', warning);
  });
  
  // Login to Discord
  client.login(token);
  
  logger.info('[Discord Bot] Discord bot configured and ready with dispatcher architecture.');
  
  return client;
}

module.exports = createDiscordBot; 