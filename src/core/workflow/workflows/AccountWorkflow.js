/**
 * Account Workflow
 * 
 * This workflow handles account-related multi-step interactions including:
 * - Account settings management
 * - Profile management
 * - Preferences management
 * - API key management
 * - Account deletion confirmation
 */

const { createWorkflow, WorkflowStep } = require('../../workflow/workflowEngine');
const { AppError, ERROR_SEVERITY } = require('../../shared/errors');

/**
 * Create the account workflow with appropriate steps and transitions
 * 
 * @param {Object} options - Workflow options
 * @param {Object} options.accountService - Account service
 * @param {Object} options.pointsService - Points service
 * @param {Object} options.analyticsService - Analytics service (optional)
 * @param {Object} options.deliveryAdapter - Platform-specific delivery adapter
 * @returns {Object} The configured workflow
 */
function createAccountWorkflow(options = {}) {
  const { accountService, pointsService, analyticsService, deliveryAdapter } = options;
  
  if (!accountService) {
    throw new AppError('Account service is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_ACCOUNT_SERVICE'
    });
  }
  
  // Return an object with a createWorkflow method
  return {
    /**
     * Create a new workflow instance
     * 
     * @param {Object} instanceOptions - Workflow instance options
     * @param {Object} instanceOptions.context - Initial workflow context
     * @returns {Object} The workflow instance
     */
    createWorkflow: async (instanceOptions = {}) => {
      const workflow = createWorkflow({
        id: 'AccountWorkflow',
        initialStep: 'main',
        context: instanceOptions.context || {},
        steps: {
          // Main account settings menu
          main: new WorkflowStep({
            id: 'main',
            async process(state) {
              // Track step view
              analyticsService?.trackEvent('workflow:account:main', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render main account menu UI
              return {
                ...state,
                ui: {
                  type: 'menu',
                  title: 'Account Settings',
                  text: 'Select an option to manage your account:',
                  buttons: [
                    { id: 'profile', text: 'Profile' },
                    { id: 'preferences', text: 'Preferences' },
                    { id: 'apikeys', text: 'API Keys' },
                    { id: 'points', text: 'Points Balance' },
                    { id: 'delete', text: 'Delete Account' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              // Navigate based on user selection
              switch (input) {
                case 'profile':
                  return { nextStep: 'profile' };
                case 'preferences':
                  return { nextStep: 'preferences' };
                case 'apikeys':
                  return { nextStep: 'apikeys' };
                case 'points':
                  return { nextStep: 'points' };
                case 'delete':
                  return { nextStep: 'deleteConfirm' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Profile view and management
          profile: new WorkflowStep({
            id: 'profile',
            async process(state) {
              // Get user profile data
              const profile = await accountService.getUserProfile(state.userId);
              
              // Track step view
              analyticsService?.trackEvent('workflow:account:profile', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render profile UI
              return {
                ...state,
                profile,
                ui: {
                  type: 'menu',
                  title: 'Profile Information',
                  text: `Name: ${profile.name || 'Not set'}\nUsername: ${profile.username || 'Not set'}\nMember since: ${new Date(profile.createdAt).toLocaleDateString()}`,
                  buttons: [
                    { id: 'changeName', text: 'Change Name' },
                    { id: 'back', text: 'Back to Account' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'changeName':
                  return { nextStep: 'nameChangePrompt' };
                case 'back':
                  return { nextStep: 'main' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Name change prompt
          nameChangePrompt: new WorkflowStep({
            id: 'nameChangePrompt',
            async process(state) {
              // Send a message prompting for new name
              await deliveryAdapter.deliverMessage({
                userId: state.userId,
                message: 'Please enter your new name:',
                context: {
                  chatId: state.chatId,
                  threadId: state.threadId
                }
              });
              
              return {
                ...state,
                awaitingInput: true,
                ui: null // No UI component for this step
              };
            },
            async handleInput(input, state) {
              // Validate name
              if (!input || input.trim().length < 2) {
                await deliveryAdapter.deliverMessage({
                  userId: state.userId,
                  message: 'Name must be at least 2 characters. Please try again:',
                  context: {
                    chatId: state.chatId,
                    threadId: state.threadId
                  }
                });
                
                return { nextStep: 'nameChangePrompt' };
              }
              
              // Update the name
              await accountService.updateUserProfile(state.userId, { name: input.trim() });
              
              // Track event
              analyticsService?.trackEvent('workflow:account:nameChanged', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              return { 
                nextStep: 'profile',
                state: {
                  ...state,
                  nameChanged: true,
                  nameChangeMessage: 'Your name has been updated successfully!'
                }
              };
            }
          }),
          
          // Preferences view and management
          preferences: new WorkflowStep({
            id: 'preferences',
            async process(state) {
              // Get user preferences
              const preferences = await accountService.getUserPreferences(state.userId);
              
              // Track step view
              analyticsService?.trackEvent('workflow:account:preferences', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render preferences UI
              return {
                ...state,
                preferences,
                ui: {
                  type: 'menu',
                  title: 'Preferences',
                  text: `Notifications: ${preferences.notifications ? 'Enabled' : 'Disabled'}\nLanguage: ${preferences.language || 'English'}\nTheme: ${preferences.theme || 'Default'}`,
                  buttons: [
                    { id: 'toggleNotifications', text: `${preferences.notifications ? 'Disable' : 'Enable'} Notifications` },
                    { id: 'changeLanguage', text: 'Change Language' },
                    { id: 'changeTheme', text: 'Change Theme' },
                    { id: 'back', text: 'Back to Account' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'toggleNotifications': {
                  // Toggle notification setting
                  const preferences = state.preferences || await accountService.getUserPreferences(state.userId);
                  await accountService.updateUserPreferences(state.userId, {
                    notifications: !preferences.notifications
                  });
                  
                  // Track event
                  analyticsService?.trackEvent('workflow:account:preferencesUpdated', {
                    userId: state.userId,
                    platform: state.platform,
                    setting: 'notifications',
                    value: !preferences.notifications,
                    timestamp: Date.now()
                  });
                  
                  return { nextStep: 'preferences' };
                }
                case 'changeLanguage':
                case 'language':
                  return { nextStep: 'languageSelection' };
                case 'changeTheme':
                  return { nextStep: 'themeSelection' };
                case 'back':
                  return { nextStep: 'main' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Language selection
          languageSelection: new WorkflowStep({
            id: 'languageSelection',
            async process(state) {
              // Track step view
              analyticsService?.trackEvent('workflow:account:languageSelection', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render language selection UI
              return {
                ...state,
                ui: {
                  type: 'menu',
                  title: 'Language Selection',
                  text: 'Select your preferred language:',
                  buttons: [
                    { id: 'en', text: 'English' },
                    { id: 'es', text: 'Spanish' },
                    { id: 'fr', text: 'French' },
                    { id: 'de', text: 'German' },
                    { id: 'back', text: 'Back to Preferences' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              if (input === 'back') {
                return { nextStep: 'preferences' };
              }
              
              // Update language preference
              if (['en', 'es', 'fr', 'de'].includes(input)) {
                await accountService.updateUserPreferences(state.userId, { language: input });
                
                // Track event
                analyticsService?.trackEvent('workflow:account:preferences:language', {
                  userId: state.userId,
                  language: input,
                  platform: state.platform,
                  timestamp: Date.now()
                });
                
                return { nextStep: 'preferences' };
              }
              
              throw new AppError('Invalid language selection', {
                severity: ERROR_SEVERITY.WARNING,
                code: 'INVALID_LANGUAGE',
                userFacing: true
              });
            }
          }),
          
          // Theme selection
          themeSelection: new WorkflowStep({
            id: 'themeSelection',
            async process(state) {
              // Track step view
              analyticsService?.trackEvent('workflow:account:themeSelection', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render theme selection UI
              return {
                ...state,
                ui: {
                  type: 'menu',
                  title: 'Theme Selection',
                  text: 'Select your preferred theme:',
                  buttons: [
                    { id: 'default', text: 'Default' },
                    { id: 'dark', text: 'Dark' },
                    { id: 'light', text: 'Light' },
                    { id: 'back', text: 'Back to Preferences' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              if (input === 'back') {
                return { nextStep: 'preferences' };
              }
              
              // Update theme preference
              if (['default', 'dark', 'light'].includes(input)) {
                await accountService.updateUserPreferences(state.userId, { theme: input });
                
                // Track event
                analyticsService?.trackEvent('workflow:account:preferencesUpdated', {
                  userId: state.userId,
                  platform: state.platform,
                  setting: 'theme',
                  value: input,
                  timestamp: Date.now()
                });
                
                return { nextStep: 'preferences' };
              }
              
              throw new AppError('Invalid theme selection', {
                severity: ERROR_SEVERITY.WARNING,
                code: 'INVALID_THEME',
                userFacing: true
              });
            }
          }),
          
          // API keys management
          apikeys: new WorkflowStep({
            id: 'apikeys',
            async process(state) {
              // Get user's API keys
              const apiKeys = await accountService.getUserApiKeys(state.userId);
              
              // Track step view
              analyticsService?.trackEvent('workflow:account:apikeys', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Build text with API keys list
              let text = 'API Keys:\n\n';
              
              if (apiKeys.length === 0) {
                text += 'You don\'t have any API keys yet.';
              } else {
                apiKeys.forEach(key => {
                  text += `• ${key.name}: ${key.truncatedKey}\n  Created: ${new Date(key.createdAt).toLocaleDateString()}\n\n`;
                });
              }
              
              // Render API keys UI
              return {
                ...state,
                apiKeys,
                ui: {
                  type: 'menu',
                  title: 'API Key Management',
                  text,
                  buttons: [
                    { id: 'generate', text: 'Generate New Key' },
                    ...(apiKeys.length > 0 ? [{ id: 'delete', text: 'Delete Key' }] : []),
                    { id: 'back', text: 'Back to Account' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'generate':
                  return { nextStep: 'keyNamePrompt' };
                case 'delete':
                  return { nextStep: 'keyDeleteConfirm' };
                case 'back':
                  return { nextStep: 'main' };
                default:
                  // Check if the input is a delete command for a specific key
                  if (input.startsWith('delete-')) {
                    // Extract the key ID from the input
                    const keyId = input.substring('delete-'.length);
                    return { 
                      nextStep: 'keyDeleteConfirm',
                      state: { ...state, keyToDelete: keyId }
                    };
                  }
                  
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // API key generation prompt
          keyNamePrompt: new WorkflowStep({
            id: 'keyNamePrompt',
            async process(state) {
              // Prompt for key name
              await deliveryAdapter.deliverMessage({
                userId: state.userId,
                message: 'Enter a name for your new API key:',
                context: {
                  chatId: state.chatId,
                  threadId: state.threadId
                }
              });
              
              return {
                ...state,
                awaitingInput: true,
                ui: null // No UI component for this step
              };
            },
            async handleInput(input, state) {
              // Validate key name
              if (!input || input.trim().length < 3) {
                await deliveryAdapter.deliverMessage({
                  userId: state.userId,
                  message: 'Key name must be at least 3 characters. Please try again:',
                  context: {
                    chatId: state.chatId,
                    threadId: state.threadId
                  }
                });
                
                return { nextStep: 'keyNamePrompt' };
              }
              
              // Generate the key
              const apiKey = await accountService.generateApiKey(state.userId, input.trim());
              
              // Track event
              analyticsService?.trackEvent('workflow:account:apikey:generated', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Move to key display step
              return { 
                nextStep: 'keyDisplay',
                state: { ...state, apiKey }
              };
            }
          }),
          
          // API key display
          keyDisplay: new WorkflowStep({
            id: 'keyDisplay',
            async process(state) {
              // Track step view
              analyticsService?.trackEvent('workflow:account:keyDisplay', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render key display UI
              return {
                ...state,
                ui: {
                  type: 'message',
                  title: 'Your New API Key',
                  text: `Your new API key has been generated:\n\nName: ${state.apiKey.name}\nKey: ${state.apiKey.key}\n\nPlease save this key now. For security reasons, we won't show the full key again.`,
                  buttons: [
                    { id: 'done', text: 'Done' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              if (input === 'done') {
                return { nextStep: 'apikeys' };
              }
              
              throw new AppError('Invalid selection', {
                severity: ERROR_SEVERITY.WARNING,
                code: 'INVALID_SELECTION',
                userFacing: true
              });
            }
          }),
          
          // API key deletion confirmation
          keyDeleteConfirm: new WorkflowStep({
            id: 'keyDeleteConfirm',
            async process(state) {
              // Track step view
              analyticsService?.trackEvent('workflow:account:keyDeleteConfirm', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render confirmation UI
              return {
                ...state,
                ui: {
                  type: 'menu',
                  title: 'Confirm API Key Deletion',
                  text: 'Are you sure you want to delete this API key? This action cannot be undone. The key will be permanently deleted.',
                  buttons: [
                    { id: 'confirm', text: 'Yes, Delete This Key' },
                    { id: 'cancel', text: 'Cancel' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'confirm':
                  // Delete the key
                  await accountService.deleteApiKey(state.userId, state.keyToDelete);
                  
                  // Track event
                  analyticsService?.trackEvent('workflow:account:apikey:deleted', {
                    userId: state.userId,
                    keyId: state.keyToDelete,
                    platform: state.platform,
                    timestamp: Date.now()
                  });
                  
                  // Return to API keys list
                  return { nextStep: 'apikeys' };
                case 'cancel':
                  // Track event
                  analyticsService?.trackEvent('workflow:account:keyDeleteCanceled', {
                    userId: state.userId,
                    platform: state.platform,
                    timestamp: Date.now()
                  });
                  
                  return { nextStep: 'apikeys' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Points balance
          points: new WorkflowStep({
            id: 'points',
            async process(state) {
              // Get user's points
              const points = await pointsService.getUserPoints(state.userId);
              
              // Get transaction history
              const transactions = await pointsService.getUserTransactions(state.userId);
              
              // Track step view
              analyticsService?.trackEvent('workflow:account:points', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render points UI
              return {
                ...state,
                points,
                transactions,
                ui: {
                  type: 'menu',
                  title: 'Points Balance',
                  text: `You have ${points} points.\n\nRecent transactions:\n${transactions.slice(0, 3).map(tx => 
                    `${new Date(tx.timestamp).toLocaleDateString()}: ${tx.amount > 0 ? '+' : ''}${tx.amount} - ${tx.reason}`
                  ).join('\n')}`,
                  buttons: [
                    { id: 'refresh', text: 'Refresh Balance' },
                    { id: 'history', text: 'View Full History' },
                    { id: 'back', text: 'Back to Account' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'refresh':
                  // Refresh points balance
                  const refreshedPoints = await pointsService.refreshUserPoints(state.userId);
                  
                  // Track event
                  analyticsService?.trackEvent('workflow:account:points:refreshed', {
                    userId: state.userId,
                    platform: state.platform,
                    timestamp: Date.now()
                  });
                  
                  return { 
                    nextStep: 'points',
                    state: {
                      ...state,
                      points: refreshedPoints,
                      refreshed: true
                    }
                  };
                case 'history':
                  return { nextStep: 'pointsHistory' };
                case 'back':
                  return { nextStep: 'main' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Points transaction history
          pointsHistory: new WorkflowStep({
            id: 'pointsHistory',
            async process(state) {
              // Get user's points transactions
              const transactions = await pointsService.getUserTransactions(state.userId);
              
              // Track step view
              analyticsService?.trackEvent('workflow:account:pointsHistory', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Build text with transaction history
              let text = 'Transaction History:\n\n';
              
              if (transactions.length === 0) {
                text += 'No transactions found.';
              } else {
                transactions.forEach(tx => {
                  const date = new Date(tx.timestamp).toLocaleDateString();
                  const amount = tx.amount > 0 ? `+${tx.amount}` : tx.amount;
                  text += `${date}: ${amount} points - ${tx.reason}\n`;
                });
              }
              
              // Render history UI
              return {
                ...state,
                transactions,
                ui: {
                  type: 'menu',
                  title: 'Points Transaction History',
                  text,
                  buttons: [
                    { id: 'refresh', text: 'Refresh History' },
                    { id: 'back', text: 'Back to Points' },
                    { id: 'main', text: 'Main Menu' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'refresh':
                  return { nextStep: 'pointsHistory' };
                case 'back':
                  return { nextStep: 'points' };
                case 'main':
                  return { nextStep: 'main' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Account deletion confirmation
          deleteConfirm: new WorkflowStep({
            id: 'deleteConfirm',
            async process(state) {
              // Track step view
              analyticsService?.trackEvent('workflow:account:deleteConfirm', {
                userId: state.userId,
                platform: state.platform,
                timestamp: Date.now()
              });
              
              // Render confirmation UI
              return {
                ...state,
                ui: {
                  type: 'menu',
                  title: 'Confirm Account Deletion',
                  text: 'Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently deleted.',
                  buttons: [
                    { id: 'confirm', text: 'Yes, Delete My Account' },
                    { id: 'cancel', text: 'Cancel' }
                  ]
                }
              };
            },
            async handleInput(input, state) {
              switch (input) {
                case 'confirm':
                  return { nextStep: 'deleteVerify' };
                case 'cancel':
                  // Track abort event
                  analyticsService?.trackEvent('workflow:account:deleteAborted', {
                    userId: state.userId,
                    platform: state.platform,
                    timestamp: Date.now()
                  });
                  
                  return { nextStep: 'main' };
                default:
                  throw new AppError('Invalid selection', {
                    severity: ERROR_SEVERITY.WARNING,
                    code: 'INVALID_SELECTION',
                    userFacing: true
                  });
              }
            }
          }),
          
          // Account deletion final verification
          deleteVerify: new WorkflowStep({
            id: 'deleteVerify',
            async process(state) {
              // Send a message requiring DELETE to be typed
              await deliveryAdapter.deliverMessage({
                userId: state.userId,
                message: 'To confirm account deletion, please type DELETE in all capital letters:',
                context: {
                  chatId: state.chatId,
                  threadId: state.threadId
                }
              });
              
              return {
                ...state,
                awaitingInput: true,
                ui: {
                  type: 'prompt',
                  title: 'Final Verification',
                  text: 'Type DELETE to permanently delete your account.'
                }
              };
            },
            async handleInput(input, state) {
              if (input === 'DELETE') {
                // Delete the account
                await accountService.deleteUserAccount(state.userId);
                
                // Track event
                analyticsService?.trackEvent('workflow:account:deleted', {
                  userId: state.userId,
                  platform: state.platform,
                  timestamp: Date.now()
                });
                
                // Complete the workflow
                return {
                  complete: true,
                  result: { deleted: true }
                };
              } else {
                // Send error message
                await deliveryAdapter.deliverMessage({
                  userId: state.userId,
                  message: 'Account deletion canceled. You did not type DELETE correctly.',
                  context: {
                    chatId: state.chatId,
                    threadId: state.threadId
                  }
                });
                
                // Track abort event
                analyticsService?.trackEvent('workflow:account:deleteAborted', {
                  userId: state.userId,
                  platform: state.platform,
                  timestamp: Date.now()
                });
                
                // Return to main menu
                return { nextStep: 'main' };
              }
            }
          })
        }
      });
      
      // Process the initial step after creating the workflow instance
      await workflow.processStep();
      
      return workflow;
    }
  };
}

module.exports = {
  createAccountWorkflow
}; 