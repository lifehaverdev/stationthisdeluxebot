/**
 * Account Commands
 * 
 * This module contains commands for managing user accounts, including:
 * - Points balance and history
 * - Account settings and preferences
 * - Profile management
 * - API key management
 */

const { CommandBuilder } = require('../utils/commandBuilder');
const { createMenu, createConfirmationMenu } = require('../utils/menuBuilder');
const { PointsService } = require('../services/pointsService');
const { UserService } = require('../services/userService');
const { ApiKeyService } = require('../services/apiKeyService');
const logger = require('../utils/logger');
const { handleError } = require('../utils/errorHandler');

// Initialize services
const pointsService = new PointsService();
const userService = new UserService();
const apiKeyService = new ApiKeyService();

/**
 * Points Command
 * Shows user's points balance and transaction history
 */
const pointsCommand = new CommandBuilder()
  .setName('points')
  .setDescription('View your points balance and transaction history')
  .setExecute(async (ctx) => {
    try {
      const userId = ctx.user.id;
      logger.info(`User ${userId} requested points balance`);

      const points = await pointsService.getUserPoints(userId);
      
      // Create a menu for points actions
      const menu = createMenu({
        title: `Points Balance`,
        message: `You currently have ${points} points.`,
        options: [
          { id: 'points:history', text: 'View History' },
          { id: 'points:refresh', text: 'Refresh' }
        ]
      });
      
      return ctx.reply(menu);
    } catch (error) {
      return handleError(ctx, 'Error retrieving points', error);
    }
  })
  .addSubcommand(
    new CommandBuilder()
      .setName('history')
      .setDescription('View your points transaction history')
      .setExecute(async (ctx) => {
        try {
          const userId = ctx.user.id;
          logger.info(`User ${userId} requested points history`);
          
          const transactions = await pointsService.getUserTransactions(userId);
          
          let message = 'Transaction History\n\n';
          
          if (transactions.length === 0) {
            message += 'No transactions found.';
          } else {
            transactions.forEach(tx => {
              const date = new Date(tx.timestamp).toLocaleDateString();
              const amount = tx.amount > 0 ? `+${tx.amount}` : tx.amount;
              message += `${date}: ${amount} points - ${tx.reason}\n`;
            });
          }
          
          const menu = createMenu({
            message,
            options: [
              { id: 'points:back', text: 'Back to Points' }
            ]
          });
          
          return ctx.reply(menu);
        } catch (error) {
          return handleError(ctx, 'Error retrieving transaction history', error);
        }
      })
  )
  .addSubcommand(
    new CommandBuilder()
      .setName('refresh')
      .setDescription('Refresh your points balance')
      .setExecute(async (ctx) => {
        try {
          const userId = ctx.user.id;
          logger.info(`User ${userId} refreshed points balance`);
          
          // Force refresh from the database
          const points = await pointsService.refreshUserPoints(userId);
          
          const menu = createMenu({
            title: 'Points Balance Updated',
            message: `You currently have ${points} points.`,
            options: [
              { id: 'points:history', text: 'View History' },
              { id: 'points:refresh', text: 'Refresh' }
            ]
          });
          
          return ctx.reply(menu);
        } catch (error) {
          return handleError(ctx, 'Error refreshing points', error);
        }
      })
  )
  .build();

/**
 * Account Command
 * Provides access to account settings and management
 */
const accountCommand = new CommandBuilder()
  .setName('account')
  .setDescription('Access your account settings')
  .setExecute(async (ctx) => {
    try {
      const userId = ctx.user.id;
      logger.info(`User ${userId} accessed account settings`);
      
      const menu = createMenu({
        title: 'Account Settings',
        message: 'Select an option to manage your account:',
        options: [
          { id: 'account:profile', text: 'Profile' },
          { id: 'account:preferences', text: 'Preferences' },
          { id: 'account:apikeys', text: 'API Keys' },
          { id: 'account:delete', text: 'Delete Account' }
        ]
      });
      
      return ctx.reply(menu);
    } catch (error) {
      return handleError(ctx, 'Error accessing account settings', error);
    }
  })
  
  // Profile Management Subcommand
  .addSubcommand(
    new CommandBuilder()
      .setName('profile')
      .setDescription('Manage your profile information')
      .setExecute(async (ctx) => {
        try {
          const userId = ctx.user.id;
          logger.info(`User ${userId} accessed profile settings`);
          
          const profile = await userService.getUserProfile(userId);
          
          let message = 'Profile Information\n\n';
          message += `Name: ${profile.name || 'Not set'}\n`;
          message += `Username: ${profile.username || 'Not set'}\n`;
          message += `Member since: ${new Date(profile.createdAt).toLocaleDateString()}\n`;
          
          const menu = createMenu({
            message,
            options: [
              { id: 'account:profile:name', text: 'Change Name' },
              { id: 'account:profile:back', text: 'Back to Account' }
            ]
          });
          
          return ctx.reply(menu);
        } catch (error) {
          return handleError(ctx, 'Error retrieving profile', error);
        }
      })
      
      // Name Change Action
      .addSubcommand(
        new CommandBuilder()
          .setName('name')
          .setDescription('Change your display name')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              logger.info(`User ${userId} initiated name change`);
              
              // Ask for new name
              await ctx.conversation.start('nameChange');
              return ctx.reply('Enter your new name:');
            } catch (error) {
              return handleError(ctx, 'Error changing name', error);
            }
          })
          // Handle the conversation for name change
          .setConversation('nameChange', async (ctx) => {
            try {
              const userId = ctx.user.id;
              const newName = ctx.message.text;
              
              if (!newName || newName.trim().length < 2) {
                return ctx.reply('Name must be at least 2 characters. Please try again:');
              }
              
              await userService.updateUserProfile(userId, { name: newName });
              logger.info(`User ${userId} changed name to ${newName}`);
              
              // End the conversation
              await ctx.conversation.end();
              
              // Send confirmation
              await ctx.reply('Your name has been updated successfully!');
              
              // Return to profile view
              const profile = await userService.getUserProfile(userId);
              
              let message = 'Profile Information\n\n';
              message += `Name: ${profile.name || 'Not set'}\n`;
              message += `Username: ${profile.username || 'Not set'}\n`;
              message += `Member since: ${new Date(profile.createdAt).toLocaleDateString()}\n`;
              
              const menu = createMenu({
                message,
                options: [
                  { id: 'account:profile:name', text: 'Change Name' },
                  { id: 'account:profile:back', text: 'Back to Account' }
                ]
              });
              
              return ctx.reply(menu);
            } catch (error) {
              return handleError(ctx, 'Error updating name', error);
            }
          })
      )
  )
  
  // Preferences Management Subcommand
  .addSubcommand(
    new CommandBuilder()
      .setName('preferences')
      .setDescription('Manage your preferences')
      .setExecute(async (ctx) => {
        try {
          const userId = ctx.user.id;
          logger.info(`User ${userId} accessed preferences settings`);
          
          const preferences = await userService.getUserPreferences(userId);
          
          let message = 'Preferences\n\n';
          message += `Language: ${preferences.language === 'en' ? 'English' : 'Spanish'}\n`;
          message += `Notifications: ${preferences.notifications ? 'Enabled' : 'Disabled'}\n`;
          
          const menu = createMenu({
            message,
            options: [
              { id: 'account:preferences:language', text: 'Language' },
              { id: 'account:preferences:notifications', text: 'Toggle Notifications' },
              { id: 'account:preferences:back', text: 'Back to Account' }
            ]
          });
          
          return ctx.reply(menu);
        } catch (error) {
          return handleError(ctx, 'Error retrieving preferences', error);
        }
      })
      
      // Language Settings Subcommand
      .addSubcommand(
        new CommandBuilder()
          .setName('language')
          .setDescription('Change your language preference')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              logger.info(`User ${userId} accessed language settings`);
              
              const menu = createMenu({
                title: 'Select Language',
                options: [
                  { id: 'account:preferences:language:en', text: 'English' },
                  { id: 'account:preferences:language:es', text: 'Spanish' }
                ]
              });
              
              return ctx.reply(menu);
            } catch (error) {
              return handleError(ctx, 'Error accessing language settings', error);
            }
          })
          
          // English Language Option
          .addSubcommand(
            new CommandBuilder()
              .setName('en')
              .setExecute(async (ctx) => {
                try {
                  const userId = ctx.user.id;
                  await userService.updateUserPreferences(userId, { language: 'en' });
                  logger.info(`User ${userId} set language to English`);
                  
                  await ctx.reply('Language preference updated successfully to English');
                  
                  // Return to preferences menu
                  return ctx.executeCommand('account preferences');
                } catch (error) {
                  return handleError(ctx, 'Error updating language', error);
                }
              })
          )
          
          // Spanish Language Option
          .addSubcommand(
            new CommandBuilder()
              .setName('es')
              .setExecute(async (ctx) => {
                try {
                  const userId = ctx.user.id;
                  await userService.updateUserPreferences(userId, { language: 'es' });
                  logger.info(`User ${userId} set language to Spanish`);
                  
                  await ctx.reply('Language preference updated successfully to Spanish');
                  
                  // Return to preferences menu
                  return ctx.executeCommand('account preferences');
                } catch (error) {
                  return handleError(ctx, 'Error updating language', error);
                }
              })
          )
      )
      
      // Notifications Toggle Subcommand
      .addSubcommand(
        new CommandBuilder()
          .setName('notifications')
          .setDescription('Toggle notification settings')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              const preferences = await userService.getUserPreferences(userId);
              
              // Toggle current setting
              const newSetting = !preferences.notifications;
              await userService.updateUserPreferences(userId, { notifications: newSetting });
              
              logger.info(`User ${userId} ${newSetting ? 'enabled' : 'disabled'} notifications`);
              
              await ctx.reply(`Notifications have been ${newSetting ? 'enabled' : 'disabled'}`);
              
              // Return to preferences menu
              return ctx.executeCommand('account preferences');
            } catch (error) {
              return handleError(ctx, 'Error updating notification settings', error);
            }
          })
      )
  )
  
  // API Keys Management Subcommand
  .addSubcommand(
    new CommandBuilder()
      .setName('apikeys')
      .setDescription('Manage your API keys')
      .setExecute(async (ctx) => {
        try {
          const userId = ctx.user.id;
          logger.info(`User ${userId} accessed API keys`);
          
          const apiKeys = await apiKeyService.getUserApiKeys(userId);
          
          let message = 'API Keys\n\n';
          
          if (apiKeys.length === 0) {
            message += 'You have no API keys.\n';
          } else {
            apiKeys.forEach(key => {
              const createdDate = new Date(key.createdAt).toLocaleDateString();
              message += `• ${key.name} (Created: ${createdDate})\n`;
            });
          }
          
          const options = [
            { id: 'account:apikeys:create', text: 'Create New Key' }
          ];
          
          if (apiKeys.length > 0) {
            options.push({ id: 'account:apikeys:revoke', text: 'Revoke Keys' });
          }
          
          options.push({ id: 'account:apikeys:back', text: 'Back to Account' });
          
          const menu = createMenu({
            message,
            options
          });
          
          return ctx.reply(menu);
        } catch (error) {
          return handleError(ctx, 'Error retrieving API keys', error);
        }
      })
      
      // Create API Key Subcommand
      .addSubcommand(
        new CommandBuilder()
          .setName('create')
          .setDescription('Create a new API key')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              logger.info(`User ${userId} initiated API key creation`);
              
              // Start conversation to get key name
              await ctx.conversation.start('apiKeyCreate');
              return ctx.reply('Enter a name for your new API key:');
            } catch (error) {
              return handleError(ctx, 'Error creating API key', error);
            }
          })
          // Handle the conversation for API key creation
          .setConversation('apiKeyCreate', async (ctx) => {
            try {
              const userId = ctx.user.id;
              const keyName = ctx.message.text;
              
              if (!keyName || keyName.trim().length < 2) {
                return ctx.reply('Key name must be at least 2 characters. Please try again:');
              }
              
              // Create the API key
              const newKey = await apiKeyService.createApiKey(userId, keyName);
              logger.info(`User ${userId} created API key: ${keyName}`);
              
              // End the conversation
              await ctx.conversation.end();
              
              // Send the API key to the user
              await ctx.reply(`Your new API key has been created:\n\n${newKey.token}\n\nImportant: This is the only time you'll see this key. Please save it somewhere safe.`);
              
              // Return to API keys list
              return ctx.executeCommand('account apikeys');
            } catch (error) {
              return handleError(ctx, 'Error creating API key', error);
            }
          })
      )
      
      // Revoke API Key Subcommand
      .addSubcommand(
        new CommandBuilder()
          .setName('revoke')
          .setDescription('Revoke an existing API key')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              logger.info(`User ${userId} initiated API key revocation`);
              
              const apiKeys = await apiKeyService.getUserApiKeys(userId);
              
              if (apiKeys.length === 0) {
                await ctx.reply('You have no API keys to revoke.');
                return ctx.executeCommand('account apikeys');
              }
              
              // Create a menu with all keys as options
              const options = apiKeys.map(key => ({
                id: `account:apikeys:revoke:${key.id}`,
                text: key.name
              }));
              
              // Add back option
              options.push({ id: 'account:apikeys:back', text: 'Cancel' });
              
              const menu = createMenu({
                title: 'Revoke API Key',
                message: 'Select the API key you want to revoke:',
                options
              });
              
              return ctx.reply(menu);
            } catch (error) {
              return handleError(ctx, 'Error revoking API key', error);
            }
          })
          // Dynamic handler for specific key revocation
          .setDynamicHandler(/^revoke:(.+)$/, async (ctx, keyId) => {
            try {
              const userId = ctx.user.id;
              
              // Confirm key belongs to user and revoke it
              await apiKeyService.revokeApiKey(userId, keyId);
              logger.info(`User ${userId} revoked API key: ${keyId}`);
              
              await ctx.reply('API key has been revoked successfully');
              
              // Return to API keys list
              return ctx.executeCommand('account apikeys');
            } catch (error) {
              return handleError(ctx, 'Error revoking API key', error);
            }
          })
      )
  )
  
  // Account Deletion Subcommand
  .addSubcommand(
    new CommandBuilder()
      .setName('delete')
      .setDescription('Delete your account')
      .setExecute(async (ctx) => {
        try {
          const userId = ctx.user.id;
          logger.info(`User ${userId} initiated account deletion`);
          
          const menu = createConfirmationMenu({
            title: 'Delete Account',
            message: 'Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently lost.',
            confirmId: 'account:delete:confirm',
            confirmText: 'Yes, Delete My Account',
            cancelId: 'account:delete:cancel',
            cancelText: 'Cancel'
          });
          
          return ctx.reply(menu);
        } catch (error) {
          return handleError(ctx, 'Error processing account deletion', error);
        }
      })
      
      // Confirm Account Deletion
      .addSubcommand(
        new CommandBuilder()
          .setName('confirm')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              logger.warn(`User ${userId} confirmed account deletion`);
              
              // Delete the account
              await userService.deleteUserAccount(userId);
              
              return ctx.reply('Your account has been deleted. We\'re sorry to see you go!');
            } catch (error) {
              return handleError(ctx, 'Error deleting account', error);
            }
          })
      )
      
      // Cancel Account Deletion
      .addSubcommand(
        new CommandBuilder()
          .setName('cancel')
          .setExecute(async (ctx) => {
            try {
              const userId = ctx.user.id;
              logger.info(`User ${userId} canceled account deletion`);
              
              await ctx.reply('Account deletion canceled.');
              
              // Return to account settings
              return ctx.executeCommand('account');
            } catch (error) {
              return handleError(ctx, 'Error canceling account deletion', error);
            }
          })
      )
  )
  .build();

module.exports = {
  pointsCommand,
  accountCommand
}; 