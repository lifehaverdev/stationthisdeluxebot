/**
 * Settings Command Handler for Telegram
 * 
 * Handles the /settings command which allows users to view and modify their generation settings.
 */

const { getAllSettings, updateSetting, resetSettings, setSize } = require('../../../workflows/settings');

/**
 * Create settings command handler for Telegram
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} - Command handler function
 */
function createSettingsCommandHandler(dependencies) {
  const { 
    sessionService,
    pointsService,
    bot,
    logger = console
  } = dependencies;
  
  /**
   * Display settings menu with current values
   * @param {Object} message - Telegram message
   * @param {Object} settings - User settings
   * @param {Object} limits - User limits
   * @returns {Promise<void>}
   */
  const displaySettingsMenu = async (message, settings, limits) => {
    const settingsText = `
📊 Your Generation Settings:

📏 Size: ${settings.input_width}x${settings.input_height} (max: ${limits.maxSize}x${limits.maxSize})
🔢 Batch size: ${settings.batch_size} (max: ${limits.maxBatch})
🔄 Steps: ${settings.steps} (max: ${limits.maxSteps})
⚖️ CFG Scale: ${settings.cfg_scale}
💪 Strength: ${settings.strength}
🎲 Seed: ${settings.seed}
🖼️ Checkpoint: ${settings.checkpoint || "default"}

To change a setting, use:
/settings [setting] [value]

Examples:
/settings size 1024 768
/settings steps 30
/settings batch 2
/settings cfg 7
/settings strength 0.8
/settings seed 12345
/settings reset
`;

    await bot.sendMessage(
      message.chat.id,
      settingsText,
      {
        reply_to_message_id: message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📏 Change Size', callback_data: 'settings:size' },
              { text: '🔄 Change Steps', callback_data: 'settings:steps' }
            ],
            [
              { text: '🔢 Change Batch', callback_data: 'settings:batch' },
              { text: '⚖️ Change CFG', callback_data: 'settings:cfg' }
            ],
            [
              { text: '💪 Change Strength', callback_data: 'settings:strength' },
              { text: '🎲 Change Seed', callback_data: 'settings:seed' }
            ],
            [
              { text: '🔄 Reset All Settings', callback_data: 'settings:reset' }
            ]
          ]
        }
      }
    );
  };

  /**
   * Handle the settings command
   * @param {Object} message - Telegram message
   * @param {string} args - Command arguments
   * @returns {Promise<void>}
   */
  return async function handleSettingsCommand(message, args) {
    const userId = message.from.id;
    
    try {
      // Split args into setting and value
      const [setting, ...valueArray] = args.trim().split(/\s+/);
      const value = valueArray.join(' ');
      
      // Get current settings
      const settingsResult = getAllSettings(
        { 
          session: sessionService,
          points: pointsService,
          logger 
        },
        userId
      );
      
      if (!settingsResult.success) {
        await bot.sendMessage(
          message.chat.id,
          `Error retrieving settings: ${settingsResult.error}`,
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // If no setting specified, just display the menu
      if (!setting || setting.trim() === '') {
        await displaySettingsMenu(message, settingsResult.settings, settingsResult.limits);
        return;
      }
      
      // Handle specific setting updates
      let result;
      
      switch (setting.toLowerCase()) {
        case 'size':
          // Handle size which requires two values: width and height
          const [width, height] = valueArray;
          result = setSize(
            { 
              session: sessionService,
              points: pointsService,
              logger 
            },
            userId,
            parseInt(width, 10),
            parseInt(height, 10) || parseInt(width, 10) // If height not provided, make it square
          );
          break;
          
        case 'reset':
          // Reset all settings
          result = resetSettings(
            { 
              session: sessionService,
              points: pointsService,
              logger 
            },
            userId
          );
          break;
          
        case 'steps':
        case 'batch':
        case 'batch_size':
        case 'cfg':
        case 'cfg_scale':
        case 'strength':
        case 'seed':
        case 'checkpoint':
          // Map friendly names to actual setting names
          const settingMap = {
            'batch': 'batch_size',
            'cfg': 'cfg_scale'
          };
          
          const actualSetting = settingMap[setting.toLowerCase()] || setting.toLowerCase();
          
          result = updateSetting(
            { 
              session: sessionService,
              points: pointsService,
              logger 
            },
            userId,
            actualSetting,
            value
          );
          break;
          
        default:
          await bot.sendMessage(
            message.chat.id,
            `Unknown setting: ${setting}. Available settings: size, steps, batch, cfg, strength, seed, checkpoint, reset`,
            { reply_to_message_id: message.message_id }
          );
          return;
      }
      
      if (!result.success) {
        await bot.sendMessage(
          message.chat.id,
          `Error updating settings: ${result.error}`,
          { reply_to_message_id: message.message_id }
        );
        return;
      }
      
      // Get updated settings after change
      const updatedSettings = getAllSettings(
        { 
          session: sessionService,
          points: pointsService,
          logger 
        },
        userId
      );
      
      // Display updated settings
      await displaySettingsMenu(message, updatedSettings.settings, updatedSettings.limits);
      
    } catch (error) {
      logger.error('Error in settings command:', error);
      await bot.sendMessage(
        message.chat.id,
        'Sorry, an error occurred while processing your settings.',
        { reply_to_message_id: message.message_id }
      );
    }
  };
}

module.exports = createSettingsCommandHandler; 