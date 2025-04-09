/**
 * TelegramRenderer
 * 
 * Renders UI components on the Telegram platform.
 * Transforms abstract UI components into Telegram-specific message formats.
 */

const { UIRenderer } = require('../../../core/ui/interfaces');

/**
 * @class TelegramRenderer
 * @extends UIRenderer
 * @description Renders UI components for Telegram
 */
class TelegramRenderer extends UIRenderer {
  /**
   * Creates a new Telegram renderer
   * @param {Object} options - Renderer options
   * @param {Object} options.bot - Telegram bot instance
   */
  constructor(options = {}) {
    super(options);
    this.platform = 'telegram';
    this.bot = options.bot;
    
    if (!this.bot) {
      throw new Error('Telegram bot instance is required');
    }
    
    // Component type to render function mapping
    this.renderMethods = {
      'text': this.renderText.bind(this),
      'button': this.renderButton.bind(this),
      'input': this.renderInput.bind(this)
    };
  }

  /**
   * Check if this renderer supports the given component type
   * @param {string} componentType - Component type to check
   * @returns {boolean} True if supported
   */
  supportsComponentType(componentType) {
    return Object.keys(this.renderMethods).includes(componentType);
  }

  /**
   * Render a UI component
   * @param {UIComponent} component - Component to render
   * @param {Object} context - Rendering context
   * @param {number} context.chatId - Telegram chat ID
   * @returns {Promise<Object>} Rendering result with message reference
   */
  async render(component, context) {
    if (!context.chatId) {
      throw new Error('chatId is required in context for Telegram rendering');
    }
    
    const renderMethod = this.renderMethods[component.type];
    
    if (!renderMethod) {
      throw new Error(`Unsupported component type: ${component.type}`);
    }
    
    return renderMethod(component, context);
  }

  /**
   * Update a previously rendered component
   * @param {UIComponent} component - Updated component
   * @param {Object} renderReference - Reference to the original rendered component
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Update result
   */
  async update(component, renderReference, context) {
    if (!renderReference || !renderReference.messageId) {
      throw new Error('Valid message reference is required for update');
    }
    
    const chatId = context.chatId || renderReference.chatId;
    if (!chatId) {
      throw new Error('Chat ID is required for update');
    }
    
    // Different update logic based on component type
    switch (component.type) {
      case 'text':
        return this.updateText(component, renderReference, chatId);
      case 'button':
        return this.updateButton(component, renderReference, chatId);
      case 'input':
        // Inputs typically can't be updated directly in Telegram
        // We'll send a new message instead
        return this.renderInput(component, context);
      default:
        throw new Error(`Unsupported component type for update: ${component.type}`);
    }
  }

  /**
   * Process user input for a component
   * @param {Object} input - Telegram update object
   * @param {UIComponent} component - Component that should receive input
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   */
  async processInput(input, component, context) {
    // Process based on input and component type
    if (input.callback_query && component.type === 'button') {
      return this.processButtonClick(input.callback_query, component, context);
    } else if (input.message && input.message.text && component.type === 'input') {
      return this.processTextInput(input.message, component, context);
    }
    
    return { handled: false };
  }

  /**
   * Remove/hide a rendered component
   * @param {Object} renderReference - Reference to the rendered component
   * @param {Object} context - Additional context
   * @returns {Promise<boolean>} Success indicator
   */
  async remove(renderReference, context) {
    if (!renderReference || !renderReference.messageId) {
      throw new Error('Valid message reference is required for removal');
    }
    
    const chatId = context.chatId || renderReference.chatId;
    if (!chatId) {
      throw new Error('Chat ID is required for removal');
    }
    
    try {
      await this.bot.deleteMessage(chatId, renderReference.messageId);
      return true;
    } catch (error) {
      console.error('Error removing Telegram message:', error);
      return false;
    }
  }

  /**
   * Render a text component
   * @param {TextComponent} component - Text component to render
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   * @private
   */
  async renderText(component, context) {
    const { chatId } = context;
    const { text, format } = component.props;
    
    // Set parse mode based on format
    const options = {};
    if (format === 'markdown') {
      options.parse_mode = 'MarkdownV2';
    } else if (format === 'html') {
      options.parse_mode = 'HTML';
    }
    
    try {
      const message = await this.bot.sendMessage(chatId, text, options);
      
      return {
        messageId: message.message_id,
        chatId: message.chat.id,
        date: message.date
      };
    } catch (error) {
      console.error('Error rendering text component:', error);
      throw error;
    }
  }

  /**
   * Render a button component
   * @param {ButtonComponent} component - Button component to render
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   * @private
   */
  async renderButton(component, context) {
    const { chatId } = context;
    const { text, actionId, style, disabled, url } = component.props;
    
    // Create inline keyboard button
    const button = {};
    button.text = text;
    
    // URL button or callback button
    if (url) {
      button.url = url;
    } else {
      button.callback_data = `action:${actionId}`;
    }
    
    // Apply styling
    if (style === 'primary') {
      button.text = `✅ ${button.text}`;
    } else if (style === 'danger') {
      button.text = `❌ ${button.text}`;
    }
    
    // Create keyboard markup
    const replyMarkup = {
      inline_keyboard: [[button]]
    };
    
    // Send message with button
    try {
      const message = await this.bot.sendMessage(chatId, 
        context.text || 'Action required:', 
        { reply_markup: replyMarkup }
      );
      
      return {
        messageId: message.message_id,
        chatId: message.chat.id,
        date: message.date,
        button: button
      };
    } catch (error) {
      console.error('Error rendering button component:', error);
      throw error;
    }
  }

  /**
   * Render an input component
   * @param {InputComponent} component - Input component to render
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   * @private
   */
  async renderInput(component, context) {
    const { chatId } = context;
    const { label, placeholder, multiline, required } = component.props;
    
    // Create prompt text
    let promptText = '';
    if (label) {
      promptText += `${label}\n\n`;
    }
    
    if (placeholder) {
      promptText += `(${placeholder})\n`;
    }
    
    if (required) {
      promptText += '* Required';
    }
    
    if (!promptText) {
      promptText = 'Please enter your response:';
    }
    
    // Force reply to prompt user for input
    const options = {
      reply_markup: {
        force_reply: true,
        selective: true
      }
    };
    
    try {
      const message = await this.bot.sendMessage(chatId, promptText, options);
      
      return {
        messageId: message.message_id,
        chatId: message.chat.id,
        date: message.date,
        awaitingInput: true
      };
    } catch (error) {
      console.error('Error rendering input component:', error);
      throw error;
    }
  }

  /**
   * Update a text component
   * @param {TextComponent} component - Updated text component
   * @param {Object} renderReference - Reference to rendered component
   * @param {number} chatId - Chat ID
   * @returns {Promise<Object>} Update result
   * @private
   */
  async updateText(component, renderReference, chatId) {
    const { text, format } = component.props;
    
    // Set parse mode based on format
    const options = {};
    if (format === 'markdown') {
      options.parse_mode = 'MarkdownV2';
    } else if (format === 'html') {
      options.parse_mode = 'HTML';
    }
    
    try {
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: renderReference.messageId,
        ...options
      });
      
      return {
        ...renderReference,
        updated: true
      };
    } catch (error) {
      console.error('Error updating text component:', error);
      throw error;
    }
  }

  /**
   * Update a button component
   * @param {ButtonComponent} component - Updated button component
   * @param {Object} renderReference - Reference to rendered component
   * @param {number} chatId - Chat ID
   * @returns {Promise<Object>} Update result
   * @private
   */
  async updateButton(component, renderReference, chatId) {
    const { text, actionId, style, disabled, url } = component.props;
    
    // Create updated button
    const button = {};
    button.text = text;
    
    // URL button or callback button
    if (url) {
      button.url = url;
    } else {
      button.callback_data = `action:${actionId}`;
    }
    
    // Apply styling
    if (style === 'primary') {
      button.text = `✅ ${button.text}`;
    } else if (style === 'danger') {
      button.text = `❌ ${button.text}`;
    }
    
    // Create updated keyboard markup
    const replyMarkup = {
      inline_keyboard: [[button]]
    };
    
    try {
      await this.bot.editMessageReplyMarkup(replyMarkup, {
        chat_id: chatId,
        message_id: renderReference.messageId
      });
      
      return {
        ...renderReference,
        button: button,
        updated: true
      };
    } catch (error) {
      console.error('Error updating button component:', error);
      throw error;
    }
  }

  /**
   * Process a button click (callback query)
   * @param {Object} callbackQuery - Telegram callback query
   * @param {ButtonComponent} component - Button component
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   * @private
   */
  async processButtonClick(callbackQuery, component, context) {
    const data = callbackQuery.data;
    
    // Check if this is an action for our component
    if (!data.startsWith(`action:${component.props.actionId}`)) {
      return { handled: false };
    }
    
    // Acknowledge the callback query
    try {
      await this.bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error('Error acknowledging callback query:', error);
    }
    
    // Create action result
    return {
      handled: true,
      action: component.props.action,
      data: component.props.data,
      user: {
        id: callbackQuery.from.id,
        username: callbackQuery.from.username
      }
    };
  }

  /**
   * Process text input for an input component
   * @param {Object} message - Telegram message
   * @param {InputComponent} component - Input component
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   * @private
   */
  async processTextInput(message, component, context) {
    const text = message.text;
    
    // Set the value in the component
    component.setValue(text);
    
    // Validate the input
    const validationResult = component.validateValue();
    
    // Create input result
    return {
      handled: true,
      value: text,
      valid: validationResult.valid,
      error: validationResult.error,
      user: {
        id: message.from.id,
        username: message.from.username
      }
    };
  }
}

module.exports = TelegramRenderer; 