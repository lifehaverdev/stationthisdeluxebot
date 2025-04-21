/**
 * Telegram Session Adapter
 * 
 * Handles Telegram-specific session initialization and management.
 */

const { SessionAgent } = require('../../../core/session/sessionAgent');
const { SessionService } = require('../../../core/session/service');
const { Logger } = require('../../../utils/logger');
const { AppError } = require('../../../core/shared/errors/AppError');

/**
 * Telegram Session Adapter
 * Manages session initialization for Telegram messages
 */
class TelegramSessionAdapter {
  /**
   * Create a new Telegram session adapter
   * @param {Object} options - Adapter options
   * @param {Object} options.bot - Telegram bot instance
   * @param {Object} options.commandRegistry - Command registry
   * @param {Object} options.workflowManager - Workflow manager
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    this.bot = options.bot;
    this.commandRegistry = options.commandRegistry;
    this.workflowManager = options.workflowManager;
    
    this.logger = options.logger || new Logger({
      level: process.env.LOG_LEVEL || 'info',
      name: 'telegram-session'
    });
    
    this.sessionService = new SessionService();
    this.sessionAgent = new SessionAgent({
      sessionService: this.sessionService,
      logger: this.logger
    });
  }

  /**
   * Handle a new message and initialize session
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} - Session info
   */
  async handleMessage(message) {
    try {
      if (!message || !message.from) {
        throw new AppError('Invalid message format', {
          code: 'INVALID_MESSAGE',
          userFacing: false
        });
      }
      
      // Initialize or get session
      const result = await this.sessionAgent.initializeTelegramSession(message);
      
      if (!result.success) {
        throw new AppError(result.error, {
          code: result.code,
          userFacing: false
        });
      }
      
      return result.session;
    } catch (error) {
      this.logger.error('Error handling Telegram message', { error });
      
      return {
        error: error.message || 'Session initialization failed',
        code: error.code || 'SESSION_ERROR'
      };
    }
  }

  /**
   * Route a message to appropriate handler
   * @param {Object} message - Telegram message
   * @returns {Promise<Object>} - Routing result
   */
  async routeMessage(message) {
    try {
      // Route through session agent
      const result = await this.sessionAgent.routeTelegramInput(message, {
        commandRegistry: this.commandRegistry,
        workflowManager: this.workflowManager
      });
      
      if (result.type === 'error') {
        throw new AppError(result.error, {
          code: result.code,
          userFacing: false
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error('Error routing Telegram message', { error });
      
      // Send error message to user
      const chatId = message.chat.id;
      this.bot.sendMessage(chatId, 'Sorry, I encountered an error processing your request.');
      
      return {
        type: 'error',
        error: error.message,
        code: error.code || 'ROUTING_ERROR'
      };
    }
  }

  /**
   * Send a help message when no command matches
   * @param {Object} message - Telegram message
   */
  async sendHelpMessage(message) {
    try {
      const chatId = message.chat.id;
      const commands = this.commandRegistry.getAll().map(c => `/${c.name} - ${c.description}`).join('\n');
      
      const helpText = `
Hello! I'm StationThis Bot. Here are the commands I understand:

${commands}

Send any command to get started!
`;
      
      await this.bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error('Error sending help message', { error });
    }
  }
}

module.exports = TelegramSessionAdapter; 