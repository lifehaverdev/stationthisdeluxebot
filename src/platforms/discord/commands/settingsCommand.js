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
   * @param {Object} interaction - Discord interaction (or client, interaction, dependencies from dispatcher)
   * @param {string|Object} [settingOrClient] - Optional setting name OR client (if called from dispatcher)
   * @param {string|Object} [valueOrInteraction] - Optional value OR interaction (if called from dispatcher)
   * @param {Object} [dependencies] - Optional dependencies (if called from dispatcher)
   * @returns {Promise<void>}
   */
  return async function handleSettingsCommand(...args) {
    // Handle both signatures:
    // 1. From dispatcher: (client, interaction, dependencies)
    // 2. From legacy: (interaction)
    // 3. From button handlers: (interaction)
    
    let actualInteraction;
    let setting = null;
    let value = null;
    
    // Determine which signature was used
    if (args.length >= 2 && args[1] && typeof args[1] === 'object' && 'user' in args[1] && 'deferReply' in args[1]) {
      // Called from dispatcher: (client, interaction, dependencies)
      actualInteraction = args[1];
    } else if (args[0] && typeof args[0] === 'object' && 'user' in args[0] && 'deferReply' in args[0]) {
      // Called directly: (interaction) or (interaction, setting, value)
      actualInteraction = args[0];
      setting = args[1];
      value = args[2];
    } else {
      logger.error('[Settings Command] Invalid arguments received:', args);
      throw new Error('Invalid arguments to settings command');
    }
    
    // Validate interaction
    if (!actualInteraction || typeof actualInteraction.deferReply !== 'function') {
      logger.error('[Settings Command] Invalid interaction object received');
      throw new Error('Invalid interaction object');
    }
    
    const userId = actualInteraction.user.id;
    
    // Extract setting/value from interaction options if it's a slash command
    if (actualInteraction.isChatInputCommand && actualInteraction.isChatInputCommand()) {
      setting = actualInteraction.options?.getString('setting') || setting;
      value = actualInteraction.options?.getString('value') || value;
    }
    
    try {
      // CRITICAL: Always defer reply IMMEDIATELY (within 3 seconds) for Discord
      // This is REQUIRED - failing to respond within 3 seconds can trigger Discord security measures
      if (!actualInteraction.deferred && !actualInteraction.replied) {
        await actualInteraction.deferReply();
        logger.info('[Settings Command] Interaction deferred immediately');
      }
      
      // Create workflow instance with services
      const settingsWorkflow = settings({ session: sessionService, points: pointsService, logger });
      
      // If both setting and value are provided, update that specific setting
      if (setting && value) {
        // Call the updateSetting workflow
        const result = await settingsWorkflow.updateSetting(
          userId,
          setting,
          value
        );
        
        if (!result.success) {
          await actualInteraction.editReply({
            content: `Error updating setting: ${result.error}`
          });
          return;
        }
        
        await actualInteraction.editReply({
          content: `Updated ${setting} to ${value}.`
        });
        return;
      }
      
      // If just the setting is provided but no value, show instructions
      if (setting && !value) {
        await actualInteraction.editReply({
          content: `Please provide a value for ${setting}. Example: /settings ${setting} <value>`
        });
        return;
      }
      
      // If no arguments, show current settings
      
      // Get all settings
      const settingsResult = settingsWorkflow.getAllSettings(userId);
      
      if (!settingsResult.success) {
        await actualInteraction.editReply({
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
      
      await actualInteraction.editReply({
        embeds: [embed],
        components: [sizeRow, stepsRow, optionsRow, checkpointRow]
      });
      
    } catch (error) {
      logger.error('[Settings Command] Error:', error);
      
      try {
        if (actualInteraction.deferred || actualInteraction.replied) {
          await actualInteraction.editReply({
            content: 'Sorry, an error occurred while managing your settings.',
            embeds: [],
            components: []
          });
        } else {
          // Use flags instead of deprecated ephemeral
          await actualInteraction.reply({
            content: 'Sorry, an error occurred while managing your settings.',
            flags: 64 // Ephemeral flag
          });
        }
      } catch (replyError) {
        logger.error('[Settings Command] Failed to send error response:', replyError);
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