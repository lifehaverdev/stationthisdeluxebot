/**
 * Telegram Generation Adapter
 * 
 * Adapts generation-related commands and workflows for Telegram integration
 */

const { AppError, ERROR_SEVERITY } = require('../../../core/shared/errors');
const { generateImage, processMakeWorkflow } = require('../../../commands/makeCommand');

/**
 * MakeTelegramAdapter
 * 
 * Adapts the make command for Telegram
 */
class MakeTelegramAdapter {
  /**
   * Create settings keyboard for Telegram
   * @param {Object} step - Workflow step with settings fields
   * @returns {Object} - Telegram inline keyboard markup
   */
  createSettingsKeyboard(step) {
    if (!step || !step.fields) {
      return {
        inline_keyboard: [
          [{ text: 'Continue with defaults', callback_data: 'settings_default' }],
          [{ text: 'Cancel', callback_data: 'cancel' }]
        ]
      };
    }
    
    // Create buttons for each setting
    const keyboard = [];
    
    // Width/height presets row
    keyboard.push([
      { text: '512×512', callback_data: 'preset_512_512' },
      { text: '768×768', callback_data: 'preset_768_768' },
      { text: '1024×1024', callback_data: 'preset_1024_1024' }
    ]);
    
    // Wider aspect ratios
    keyboard.push([
      { text: '704×512', callback_data: 'preset_704_512' },
      { text: '768×512', callback_data: 'preset_768_512' },
      { text: '1024×768', callback_data: 'preset_1024_768' }
    ]);
    
    // Seed controls
    keyboard.push([
      { text: 'Random Seed', callback_data: 'seed_random' },
      { text: 'Enter Seed', callback_data: 'seed_custom' }
    ]);
    
    // Continue/Cancel row
    keyboard.push([
      { text: 'Continue with defaults', callback_data: 'settings_default' },
      { text: 'Cancel', callback_data: 'cancel' }
    ]);
    
    return {
      inline_keyboard: keyboard
    };
  }
  
  /**
   * Extract user information from Telegram message
   * @param {Object} message - Telegram message
   * @returns {Object} - User information
   */
  extractUserInfo(message) {
    return {
      id: message.from.id.toString(),
      username: message.from.username || `user_${message.from.id}`,
      firstName: message.from.first_name || '',
      lastName: message.from.last_name || '',
      isBot: message.from.is_bot || false,
      languageCode: message.from.language_code || 'en'
    };
  }
  
  /**
   * Execute the make command for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command result
   */
  async executeMakeCommand(message, services, options = {}) {
    try {
      const {
        generationService,
        comfyDeployService,
        sessionManager,
        pointsService
      } = services;
      
      const userId = message.from.id.toString();
      const prompt = options.prompt;
      
      // Check for required services
      if (!generationService) {
        throw new AppError('Generation service is required', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'GENERATION_SERVICE_REQUIRED'
        });
      }
      
      // Generate image
      const result = await generateImage({
        generationService,
        comfyDeployService,
        sessionManager,
        pointsService,
        userId,
        prompt,
        options: {
          type: 'FLUX',
          settings: options.settings || {},
          metadata: {
            telegramChatId: message.chat.id,
            telegramMessageId: message.message_id,
            username: message.from.username,
            source: 'telegram'
          }
        }
      });
      
      return {
        success: true,
        taskId: result.taskId,
        message: `🖼 Generating image with prompt: "${prompt}"`
      };
    } catch (error) {
      console.error('Error executing make command for Telegram:', error);
      
      // Determine if this is a user-facing error
      const userMessage = error.userFacing 
        ? error.message 
        : '❌ An error occurred while processing your generation request';
      
      throw new AppError(userMessage, {
        severity: ERROR_SEVERITY.ERROR,
        code: error.code || 'MAKE_COMMAND_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Start or continue make workflow for Telegram
   * @param {Object} message - Telegram message
   * @param {Object} services - Service instances
   * @param {Object} options - Workflow options
   * @returns {Promise<Object>} - Workflow result
   */
  async processMakeWorkflow(message, services, options = {}) {
    try {
      const {
        workflowService,
        sessionManager
      } = services;
      
      const userId = message.from.id.toString();
      const workflowId = options.workflowId;
      
      // Process workflow
      const result = await processMakeWorkflow({
        workflowService,
        sessionManager,
        userId,
        workflowId,
        input: options.input
      });
      
      return result;
    } catch (error) {
      console.error('Error processing make workflow for Telegram:', error);
      
      throw new AppError('Failed to process make workflow', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_PROCESSING_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
  
  /**
   * Handle make command callback query
   * @param {Object} callbackQuery - Telegram callback query
   * @param {Object} services - Service instances
   * @returns {Promise<Object>} - Callback result
   */
  async handleMakeCallback(callbackQuery, services) {
    try {
      const data = callbackQuery.data;
      const message = callbackQuery.message;
      const userId = callbackQuery.from.id.toString();
      
      // Extract settings from callback data
      let settings = {};
      
      if (data.startsWith('preset_')) {
        // Handle dimension presets
        const [_, width, height] = data.split('_');
        settings = {
          width: parseInt(width, 10),
          height: parseInt(height, 10)
        };
      } else if (data === 'seed_random') {
        // Random seed
        settings = { seed: -1 };
      } else if (data === 'settings_default') {
        // Use default settings
        settings = {
          width: 1024,
          height: 1024,
          seed: -1
        };
      }
      
      // Get the session to retrieve the prompt
      const { sessionManager } = services;
      const session = await sessionManager.getSession(userId);
      
      if (!session) {
        throw new AppError('Session not found', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'SESSION_NOT_FOUND',
          userFacing: true
        });
      }
      
      // Get the workflow data
      const workflowId = session.get('currentWorkflow');
      
      if (!workflowId) {
        throw new AppError('No active workflow found', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'NO_ACTIVE_WORKFLOW',
          userFacing: true
        });
      }
      
      // Continue the workflow with settings
      const result = await this.processMakeWorkflow(message, services, {
        workflowId,
        input: settings
      });
      
      // Return workflow result
      return result;
    } catch (error) {
      console.error('Error handling make callback for Telegram:', error);
      
      throw new AppError('Failed to process settings', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'CALLBACK_PROCESSING_ERROR',
        userFacing: true,
        cause: error
      });
    }
  }
}

// Create singleton instance
const makeTelegramAdapter = new MakeTelegramAdapter();

module.exports = {
  makeTelegramAdapter
}; 