/**
 * Discord Platform Adapter
 * 
 * Main entry point for the Discord bot implementation.
 * Registers command handlers and provides the bot interface.
 */

const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { settings } = require('../../workflows');
const createMakeImageCommandHandler = require('./commands/makeImageCommand');
const createUpscaleCommandHandler = require('./commands/upscaleCommand');
const createSettingsCommandHandler = require('./commands/settingsCommand');
const createCollectionsCommandHandler = require('./commands/collectionsCommand');
const createTrainModelCommandHandler = require('./commands/trainModelCommand');

/**
 * Create and configure the Discord bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Discord bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createDiscordBot(dependencies, token, options = {}) {
  const {
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    db,
    logger = console
  } = dependencies;
  
  // Create Discord client with necessary intents
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ]
  });
  
  // Create a collection to store commands
  client.commands = new Collection();
  
  // Initialize command handlers
  const handleMakeImageCommand = createMakeImageCommandHandler({
    comfyuiService,
    pointsService,
    sessionService,
    workflowsService,
    mediaService,
    client,
    logger
  });
  
  const handleUpscaleCommand = createUpscaleCommandHandler({
    mediaService,
    client,
    logger
  });
  
  const handleSettingsCommand = createSettingsCommandHandler({
    sessionService,
    pointsService,
    client,
    logger
  });
  
  // Temporarily disable collections command due to missing dependencies
  // const handleCollectionsCommand = createCollectionsCommandHandler({
  //   sessionService,
  //   mediaService,
  //   db,
  //   client,
  //   logger
  // });
  
  const handleTrainModelCommand = createTrainModelCommandHandler({
    sessionService,
    workflowsService,
    client,
    logger
  });
  
  // Register commands with the client
  client.commands.set('make', handleMakeImageCommand);
  client.commands.set('upscale', handleUpscaleCommand);
  client.commands.set('settings', handleSettingsCommand);
  // client.commands.set('collections', handleCollectionsCommand);
  client.commands.set('train', handleTrainModelCommand);
  
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
    }
  ];
  
  // Register event handlers
  client.on('ready', async () => {
    logger.info(`Discord bot logged in as ${client.user.tag}`);
    
    // Register slash commands
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      
      logger.info('Started refreshing application (/) commands');
      
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      
      logger.info('Successfully registered application commands');
    } catch (error) {
      logger.error('Error registering slash commands:', error);
    }
  });
  
  // Handle slash commands
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    
    const { commandName } = interaction;
    
    // Get the command handler
    const command = client.commands.get(commandName);
    
    if (!command) return;
    
    try {
      // Execute the command
      await command(interaction);
    } catch (error) {
      logger.error(`Error executing command ${commandName}:`, error);
      
      // Reply with error message
      const errorMessage = 'An error occurred while executing this command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  });
  
  // Handle button interactions
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const customId = interaction.customId;
    
    try {
      // Handle different button types based on customId prefix
      if (customId.startsWith('settings:')) {
        // Settings button press
        // Acknowledge the interaction first
        await interaction.deferUpdate();
        
        const parts = customId.split(':');
        const settingType = parts[1];
        const settingValue = parts[2];
        
        if (settingType === 'reset') {
          // Handle reset all settings
          const resetResult = await settings.resetSettings(
            { session: sessionService, points: pointsService, logger },
            interaction.user.id
          );
          
          if (resetResult.success) {
            // Refresh the settings view
            await handleSettingsCommand(interaction);
          } else {
            await interaction.editReply({
              content: `Error resetting settings: ${resetResult.error}`,
              components: []
            });
          }
        } else {
          // Handle other settings updates
          const updateResult = await settings.updateSetting(
            { session: sessionService, points: pointsService, logger },
            interaction.user.id,
            settingType,
            settingValue
          );
          
          if (updateResult.success) {
            // Refresh the settings view
            await handleSettingsCommand(interaction);
          } else {
            await interaction.editReply({
              content: `Error updating ${settingType}: ${updateResult.error}`,
              components: []
            });
          }
        }
      }
      // Don't handle collection buttons here, they're handled by the registerCollectionInteractions function
    } catch (error) {
      logger.error('Error handling button interaction:', error);
    }
  });
  
  // Handle select menu interactions
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    
    const customId = interaction.customId;
    
    try {
      // Acknowledge the interaction first
      await interaction.deferUpdate();
      
      if (customId.startsWith('settings:')) {
        // Handle settings select menu
        const parts = customId.split(':');
        const settingType = parts[1];
        const settingValue = interaction.values[0];
        
        const updateResult = await settings.updateSetting(
          { session: sessionService, points: pointsService, logger },
          interaction.user.id,
          settingType,
          settingValue
        );
        
        if (updateResult.success) {
          // Refresh the settings view
          await handleSettingsCommand(interaction);
        } else {
          await interaction.editReply({
            content: `Error updating ${settingType}: ${updateResult.error}`,
            components: []
          });
        }
      }
    } catch (error) {
      logger.error('Error handling select menu interaction:', error);
    }
  });

  // Register collection interactions handler
  const { registerInteractions } = require('./commands/collectionsCommand');
  // registerInteractions(client, handleCollectionsCommand);
  
  // Log errors
  client.on('error', (error) => {
    logger.error('Discord client error:', error);
  });
  
  // Login to Discord
  client.login(token);
  
  logger.info('Discord bot configured and ready');
  
  return client;
}

module.exports = createDiscordBot; 