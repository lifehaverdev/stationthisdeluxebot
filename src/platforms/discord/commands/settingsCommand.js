/**
 * Settings Command Handler for Discord
 * 
 * Handles the /settings command which allows users to view and update their generation settings.
 */

const { settings } = require('../../../workflows');
const { 
  SlashCommandBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  EmbedBuilder 
} = require('discord.js');

/**
 * Create settings command handler for Discord
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createSettingsCommandHandler(dependencies) {
  const { 
    sessionService,
    pointsService,
    logger = console
  } = dependencies;
  
  /**
   * Handle the settings command
   * @param {Object} interaction - Discord interaction
   * @param {string} [setting] - Optional setting name to update
   * @param {string} [value] - Optional value to set
   * @returns {Promise<void>}
   */
  return async function handleSettingsCommand(interaction, setting, value) {
    const userId = interaction.user.id;
    
    try {
      // If both setting and value are provided, update that specific setting
      if (setting && value) {
        await interaction.deferReply();
        
        // Call the updateSetting workflow
        const result = await settings.updateSetting(
          { session: sessionService, points: pointsService, logger },
          userId,
          setting,
          value
        );
        
        if (!result.success) {
          await interaction.editReply({
            content: `Error updating setting: ${result.error}`
          });
          return;
        }
        
        await interaction.editReply({
          content: `Updated ${setting} to ${value}.`
        });
        return;
      }
      
      // If just the setting is provided but no value, show instructions
      if (setting && !value) {
        await interaction.reply({
          content: `Please provide a value for ${setting}. Example: /settings ${setting} <value>`,
          ephemeral: true
        });
        return;
      }
      
      // If no arguments, show current settings
      await interaction.deferReply();
      
      // Get all settings
      const settingsResult = await settings.getAllSettings(
        { session: sessionService, points: pointsService, logger },
        userId
      );
      
      if (!settingsResult.success) {
        await interaction.editReply({
          content: `Error retrieving settings: ${settingsResult.error}`
        });
        return;
      }
      
      const userSettings = settingsResult.settings;
      const limits = settingsResult.limits;
      
      // Create embed for cleaner display
      const embed = new EmbedBuilder()
        .setTitle('Your Image Generation Settings')
        .setColor(0x0099FF)
        .setDescription('Use the buttons below to modify your settings.')
        .addFields(
          { name: 'Size', value: `${userSettings.input_width}×${userSettings.input_height} (Max: ${limits.maxSize}×${limits.maxSize})`, inline: true },
          { name: 'Batch Size', value: `${userSettings.batch_size} (Max: ${limits.maxBatch})`, inline: true },
          { name: 'Steps', value: `${userSettings.steps} (Max: ${limits.maxSteps})`, inline: true },
          { name: 'CFG Scale', value: `${userSettings.cfg_scale}`, inline: true },
          { name: 'Strength', value: `${userSettings.strength}`, inline: true },
          { name: 'Seed', value: `${userSettings.seed === -1 ? 'Random' : userSettings.seed}`, inline: true },
          { name: 'Checkpoint', value: `${userSettings.checkpoint}`, inline: true }
        )
        .setFooter({ text: 'Some settings have limits based on your point balance.' });
      
      // Create action rows with buttons for common settings changes
      const sizeRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('settings:size:512x512')
            .setLabel('512×512')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:size:768x768')
            .setLabel('768×768')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:size:1024x1024')
            .setLabel('1024×1024')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:size:1280x720')
            .setLabel('1280×720')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:size:1920x1080')
            .setLabel('1920×1080')
            .setStyle(ButtonStyle.Secondary)
        );
      
      const stepsRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('settings:steps:20')
            .setLabel('20 Steps')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:steps:30')
            .setLabel('30 Steps')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:steps:40')
            .setLabel('40 Steps')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:batch:1')
            .setLabel('Batch: 1')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:batch:4')
            .setLabel('Batch: 4')
            .setStyle(ButtonStyle.Secondary)
        );
      
      const optionsRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('settings:cfg:7')
            .setLabel('CFG: 7')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:seed:-1')
            .setLabel('Random Seed')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('settings:reset')
            .setLabel('Reset All')
            .setStyle(ButtonStyle.Danger)
        );
      
      // Create model selection menu
      const checkpointRow = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('settings:checkpoint')
            .setPlaceholder('Select Checkpoint')
            .addOptions([
              { label: 'Default', value: 'default' },
              { label: 'Realistic', value: 'realistic' },
              { label: 'Anime', value: 'anime' },
              { label: 'Artistic', value: 'artistic' },
              { label: 'Photography', value: 'photography' }
            ])
        );
      
      await interaction.editReply({
        embeds: [embed],
        components: [sizeRow, stepsRow, optionsRow, checkpointRow]
      });
      
    } catch (error) {
      logger.error('Error in settings command:', error);
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: 'Sorry, an error occurred while managing your settings.'
        });
      } else {
        await interaction.reply({
          content: 'Sorry, an error occurred while managing your settings.',
          ephemeral: true
        });
      }
    }
  };
}

/**
 * Discord settings command data for registration
 */
const commandData = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('View or modify your image generation settings')
  .addStringOption(option => 
    option.setName('setting')
      .setDescription('The setting to change')
      .setRequired(false)
      .addChoices(
        { name: 'Size', value: 'size' },
        { name: 'Steps', value: 'steps' },
        { name: 'Batch Size', value: 'batch_size' },
        { name: 'CFG Scale', value: 'cfg_scale' },
        { name: 'Strength', value: 'strength' },
        { name: 'Seed', value: 'seed' },
        { name: 'Checkpoint', value: 'checkpoint' }
      )
  )
  .addStringOption(option => 
    option.setName('value')
      .setDescription('The new value for the setting')
      .setRequired(false)
  );

module.exports = createSettingsCommandHandler;
module.exports.commandData = commandData; 