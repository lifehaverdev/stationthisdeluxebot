/**
 * Telegram Integration for Account Commands
 * 
 * This module integrates the platform-agnostic account commands with the Telegram platform.
 * It uses adapters to convert platform-agnostic commands to Telegram-specific implementations.
 */

const { 
  createAccountCommand,
  createPointsCommand,
  createApiKeysCommand,
  createProfileCommand,
  createPreferencesCommand,
  createDeleteAccountCommand,
  registerAccountCommands
} = require('../../../core/account/commands');

const { createTelegramAdapter } = require('../adapters/commandAdapter');
const { createTelegramUIRenderer } = require('../renderers/uiRenderer');

/**
 * Register account commands with the Telegram bot
 * 
 * @param {Object} bot - Telegram bot instance
 * @param {Object} dependencies - Injectable dependencies
 * @param {Object} dependencies.sessionManager - Session manager
 * @param {Object} dependencies.accountService - Account service
 * @param {Object} dependencies.pointsService - Points service
 * @param {Object} dependencies.analyticsService - Analytics service
 * @param {Object} dependencies.workflowEngine - Workflow engine
 * @param {Object} dependencies.uiManager - UI manager
 */
function registerTelegramAccountCommands(bot, dependencies) {
  if (!bot) {
    throw new Error('Telegram bot is required');
  }
  
  // Create the command adapter
  const adapter = createTelegramAdapter(bot);
  
  // Create the UI renderer
  const uiRenderer = createTelegramUIRenderer(bot);
  
  // Create core commands
  const accountCommand = createAccountCommand(dependencies);
  const pointsCommand = createPointsCommand(dependencies);
  const apiKeysCommand = createApiKeysCommand(dependencies);
  const profileCommand = createProfileCommand(dependencies);
  const preferencesCommand = createPreferencesCommand(dependencies);
  const deleteAccountCommand = createDeleteAccountCommand(dependencies);
  
  // Adapt commands for Telegram
  const telegramAccountCommand = adapter.adaptCommand(accountCommand);
  const telegramPointsCommand = adapter.adaptCommand(pointsCommand);
  
  // Register commands with the bot
  bot.command('account', telegramAccountCommand.execute);
  bot.command('points', telegramPointsCommand.execute);
  
  // Register callback handlers for subcommands
  bot.action(/^account:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
      const result = await accountCommand.handleInput(action, {
        userId: ctx.from.id,
        platform: 'telegram',
        workflowId: ctx.session?.workflowId,
        sessionManager: dependencies.sessionManager
      });
      
      if (result.success) {
        if (result.uiRendered) {
          // UI was already rendered by the workflow
          return;
        }
        
        // Update the menu if needed
        return uiRenderer.updateMenu({
          chatId: ctx.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
          text: result.message,
          buttons: result.buttons || []
        });
      } else {
        // Handle error
        return ctx.reply(result.message || 'Error processing command');
      }
    } catch (error) {
      console.error('Error handling account callback:', error);
      return ctx.reply('An error occurred while processing your request');
    }
  });
  
  bot.action(/^points:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
      const result = await pointsCommand.handleInput(action, {
        userId: ctx.from.id,
        platform: 'telegram',
        workflowId: ctx.session?.workflowId,
        sessionManager: dependencies.sessionManager
      });
      
      if (result.success) {
        if (result.uiRendered) {
          // UI was already rendered by the workflow
          return;
        }
        
        // Update the menu if needed
        return uiRenderer.updateMenu({
          chatId: ctx.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
          text: result.message,
          buttons: result.buttons || []
        });
      } else {
        // Handle error
        return ctx.reply(result.message || 'Error processing command');
      }
    } catch (error) {
      console.error('Error handling points callback:', error);
      return ctx.reply('An error occurred while processing your request');
    }
  });
  
  // Register callback handler for API keys
  bot.action(/^apikeys:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
      const result = await apiKeysCommand.handleInput(action, {
        userId: ctx.from.id,
        platform: 'telegram',
        workflowId: ctx.session?.workflowId,
        sessionManager: dependencies.sessionManager
      });
      
      if (result.success) {
        if (result.uiRendered) {
          // UI was already rendered by the workflow
          return;
        }
        
        // Update the menu if needed
        return uiRenderer.updateMenu({
          chatId: ctx.chat.id,
          messageId: ctx.callbackQuery.message.message_id,
          text: result.message,
          buttons: result.buttons || []
        });
      } else {
        // Handle error
        return ctx.reply(result.message || 'Error processing command');
      }
    } catch (error) {
      console.error('Error handling API keys callback:', error);
      return ctx.reply('An error occurred while processing your request');
    }
  });
  
  // Handle text input for conversations (like name change)
  bot.on('text', async (ctx, next) => {
    // Check if we're in a workflow
    if (ctx.session?.workflowId && ctx.session?.workflowType === 'account') {
      try {
        const result = await accountCommand.handleInput(ctx.message.text, {
          userId: ctx.from.id,
          platform: 'telegram',
          workflowId: ctx.session.workflowId,
          sessionManager: dependencies.sessionManager,
          messageContext: {
            chatId: ctx.chat.id,
            messageId: ctx.message.message_id,
            username: ctx.from.username
          }
        });
        
        if (result.success) {
          // Clear the workflow if completed
          if (result.completed) {
            delete ctx.session.workflowId;
            delete ctx.session.workflowType;
          }
          
          if (!result.uiRendered) {
            // Render a response if not already rendered
            return ctx.reply(result.message || 'Input processed');
          }
        } else {
          // Handle error
          return ctx.reply(result.message || 'Error processing your input');
        }
      } catch (error) {
        console.error('Error handling account text input:', error);
        return ctx.reply('An error occurred while processing your input');
      }
      
      // Stop further processing
      return;
    }
    
    // Continue to next middleware if not handled
    return next();
  });
  
  return {
    telegramAccountCommand,
    telegramPointsCommand
  };
}

module.exports = {
  registerTelegramAccountCommands
}; 