/**
 * Account Telegram Adapter
 * 
 * Provides Telegram-specific adapters for account-related workflows
 * including points display and management.
 */

const { PointsBarComponent, TextComponent, ButtonComponent } = require('../../../core/ui/components');
const { TelegramRenderer } = require('../renderers/telegramRenderer');
const { formatTimestamp } = require('../../../utils/formatters');

/**
 * AccountTelegramAdapter
 * Handles telegram-specific rendering and interactions for account features
 */
class AccountTelegramAdapter {
  /**
   * Create a new AccountTelegramAdapter
   * @param {Object} deps - Dependencies
   * @param {Object} deps.bot - Telegram bot instance
   * @param {Object} deps.accountPointsService - Account points service
   * @param {Object} deps.sessionManager - Session manager for user data
   * @param {Object} deps.workflowManager - Workflow manager for handling workflows
   * @param {Object} deps.logger - Logger instance
   */
  constructor({ bot, accountPointsService, sessionManager, workflowManager, logger }) {
    this.bot = bot;
    this.accountPointsService = accountPointsService;
    this.sessionManager = sessionManager;
    this.workflowManager = workflowManager;
    this.logger = logger;
    this.renderer = new TelegramRenderer({ bot });
  }

  /**
   * Start the points workflow for a user
   * @param {Object} message - Telegram message object
   */
  async handlePointsCommand(message) {
    try {
      const userId = message.from.id.toString();
      const chatId = message.chat.id;
      
      // Get user data
      const userData = await this.sessionManager.getUserData(userId);
      if (!userData) {
        this.logger.warn('User data not found for points command', { userId });
        await this.bot.sendMessage(chatId, 'Unable to retrieve your account data. Please try again later.');
        return;
      }
      
      // Start a new account points workflow instance
      const workflow = await this.workflowManager.startWorkflow(
        userId,
        'account-points',
        { userId }
      );
      
      if (!workflow) {
        this.logger.error('Failed to start account points workflow', { userId });
        await this.bot.sendMessage(chatId, 'Unable to load your points at this time. Please try again later.');
        return;
      }
      
      // Render the current workflow step
      await this.renderWorkflowStep(chatId, workflow);
    } catch (error) {
      this.logger.error('Error handling points command', { error });
      await this.bot.sendMessage(
        message.chat.id, 
        'An error occurred while processing your request. Please try again later.'
      );
    }
  }
  
  /**
   * Handle callback query for points workflow
   * @param {Object} callbackQuery - Telegram callback query
   */
  async handlePointsCallback(callbackQuery) {
    try {
      const data = callbackQuery.data;
      const userId = callbackQuery.from.id.toString();
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      
      // Check if this is a workflow action
      if (!data.startsWith('wf_points:')) {
        return false; // Not handled by this adapter
      }
      
      // Acknowledge callback query
      await this.bot.answerCallbackQuery(callbackQuery.id);
      
      // Parse the action
      const [_, action] = data.split(':');
      
      // Get the current workflow
      const workflow = await this.workflowManager.getWorkflow(userId, 'account-points');
      
      if (!workflow) {
        this.logger.warn('Workflow not found for callback', { userId, action });
        await this.bot.sendMessage(chatId, 'Your session has expired. Please start again with /points');
        return true;
      }
      
      // Process the action
      if (action === 'refresh') {
        try {
          // Proceed to refresh step
          const updatedWorkflow = await this.workflowManager.processWorkflowStep(
            userId, 
            'account-points',
            'refresh'
          );
          
          if (updatedWorkflow) {
            // Update the message with new workflow state
            await this.renderWorkflowStep(chatId, updatedWorkflow, messageId);
          }
        } catch (error) {
          if (error.code === 'REFRESH_RATE_LIMITED') {
            // Show rate limit message
            await this.bot.sendMessage(chatId, error.message);
          } else {
            throw error;
          }
        }
      } else if (action === 'back') {
        // End workflow and go back to account menu
        await this.workflowManager.endWorkflow(userId, 'account-points');
        
        // Send back to account menu (this would be handled by the account adapter)
        await this.bot.editMessageText(
          'Returning to account menu...',
          {
            chat_id: chatId,
            message_id: messageId
          }
        );
        
        // Call the account menu display function - would need to be injected
        if (this.displayAccountMenu) {
          await this.displayAccountMenu(callbackQuery.message, userId);
        }
      }
      
      return true; // Handled by this adapter
    } catch (error) {
      this.logger.error('Error handling points callback', { error });
      await this.bot.sendMessage(
        callbackQuery.message.chat.id,
        'An error occurred while processing your request. Please try again later.'
      );
      return true;
    }
  }
  
  /**
   * Render the current workflow step
   * @param {number} chatId - Chat ID
   * @param {Object} workflow - Current workflow state
   * @param {number} [messageId] - Message ID for editing (optional)
   */
  async renderWorkflowStep(chatId, workflow, messageId = null) {
    const step = workflow.getCurrentStep();
    const context = workflow.context;
    
    if (!step || !step.ui) {
      this.logger.warn('Invalid workflow step for rendering', { chatId, workflowId: workflow.id });
      return;
    }
    
    // Create the text components
    const components = [];
    
    // Add title
    if (step.ui.title) {
      components.push(new TextComponent({
        text: `*${step.ui.title}*`,
        format: 'markdown'
      }));
    }
    
    // Add message
    if (step.ui.message) {
      components.push(new TextComponent({
        text: step.ui.message,
        format: 'plain'
      }));
    }
    
    // Add points bar if available
    if (context.pointsBar) {
      const pointsBar = new PointsBarComponent({
        totalPoints: context.balance.maxPoints,
        spentPoints: context.balance.points + context.balance.doints,
        qoints: context.balance.qoints,
        format: 'emoji',
        showValues: true
      });
      
      components.push(new TextComponent({
        text: pointsBar.getTextRepresentation(),
        format: 'plain'
      }));
    }
    
    // Add additional components from UI config
    if (step.ui.components) {
      for (const componentConfig of step.ui.components) {
        if (componentConfig.type === 'text') {
          // Process template with context data
          let text = componentConfig.template;
          
          // Simple template replacement
          Object.entries(context).forEach(([key, value]) => {
            if (typeof value === 'object') {
              Object.entries(value).forEach(([subKey, subValue]) => {
                text = text.replace(new RegExp(`{{${key}.${subKey}}}`, 'g'), subValue);
              });
            } else {
              text = text.replace(new RegExp(`{{${key}}}`, 'g'), value);
            }
          });
          
          // Handle time formatting
          if (text.includes('| timeAgo')) {
            text = text.replace(
              /{{(\w+)\s*\|\s*timeAgo}}/g,
              (match, key) => formatTimestamp(context[key])
            );
          }
          
          // Check condition if present
          if (componentConfig.condition && !context[componentConfig.condition]) {
            continue;
          }
          
          components.push(new TextComponent({
            text,
            format: componentConfig.format || 'plain'
          }));
        }
      }
    }
    
    // Add success message for refresh
    if (context.refreshed && step.id === 'refresh') {
      components.push(new TextComponent({
        text: '✅ Points refreshed successfully!',
        format: 'plain'
      }));
    }
    
    // Add action buttons
    const buttons = [];
    
    if (step.ui.actions) {
      for (const action of step.ui.actions) {
        buttons.push(new ButtonComponent({
          text: action.label,
          callback_data: `wf_points:${action.id}`,
          style: action.primary ? 'primary' : 'secondary'
        }));
      }
    }
    
    // Render the message
    const messageOptions = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [buttons.map(button => this.renderer.renderComponent(button))]
      }
    };
    
    const messageText = components
      .map(component => this.renderer.renderComponent(component))
      .join('\n\n');
    
    if (messageId) {
      // Edit existing message
      await this.bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: messageId,
        ...messageOptions
      });
    } else {
      // Send new message
      await this.bot.sendMessage(chatId, messageText, messageOptions);
    }
  }
  
  /**
   * Set the account menu display function
   * @param {Function} displayFn - Function to display account menu
   */
  setAccountMenuDisplay(displayFn) {
    this.displayAccountMenu = displayFn;
  }
}

module.exports = AccountTelegramAdapter; 