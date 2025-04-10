/**
 * Account Points Workflow
 * 
 * Defines a workflow for retrieving and displaying user account points.
 * This is a simple workflow with just a view and refresh action.
 */

const { createWorkflow } = require('../index');
const { AppError } = require('../../../utils/errors');

/**
 * Create the account points workflow definition
 * @param {Object} deps - Dependencies
 * @param {Object} deps.accountPointsService - Account points service
 * @param {Object} deps.sessionManager - Session manager for user data
 * @returns {Object} Workflow sequence
 */
function createAccountPointsWorkflow({ accountPointsService, sessionManager }) {
  return createWorkflow({
    id: 'account-points',
    name: 'Account Points',
    description: 'View and refresh your account points',
    
    steps: {
      'view': {
        id: 'view',
        name: 'View Points',
        description: 'View your current points balance',
        
        // No validation needed for view step
        validate: () => true,
        
        // Process the view step to load current points data
        process: async (input, state) => {
          const userId = state.context.userId;
          
          try {
            // Get user data from session
            const userData = await sessionManager.getUserData(userId);
            if (!userData) {
              throw new AppError('User data not found', 'USER_NOT_FOUND');
            }
            
            // Get user balance from service
            const balance = await accountPointsService.getUserBalance(userId);
            
            // Store balance in workflow context
            return {
              ...state,
              context: {
                ...state.context,
                balance,
                pointsBar: accountPointsService.createBalancedBar(
                  balance.maxPoints,
                  balance.points + balance.doints,
                  balance.qoints
                ),
                lastRefreshed: Date.now()
              }
            };
          } catch (error) {
            throw new AppError(
              'Failed to load points data',
              'POINTS_LOAD_FAILED',
              { cause: error }
            );
          }
        },
        
        // UI representation of view step
        ui: {
          type: 'display',
          title: 'Your Points Balance',
          message: 'Here is your current points balance:',
          components: [
            {
              type: 'pointsBar',
              dataKey: 'pointsBar'
            },
            {
              type: 'text',
              template: 'Available: {{balance.maxPoints - (balance.points + balance.doints)}} points',
              format: 'markdown'
            },
            {
              type: 'text',
              template: 'Qoints: {{balance.qoints}}',
              format: 'markdown'
            },
            {
              type: 'text',
              template: 'Last refreshed: {{lastRefreshed | timeAgo}}',
              format: 'plain'
            }
          ],
          actions: [
            {
              id: 'refresh',
              label: 'Refresh Points',
              nextStep: 'refresh',
              primary: true
            },
            {
              id: 'back',
              label: 'Back to Account',
              nextStep: 'exit',
              action: 'exit'
            }
          ]
        },
        
        // Next step should be a simple string
        nextStep: 'refresh'
      },
      
      'refresh': {
        id: 'refresh',
        name: 'Refresh Points',
        description: 'Refresh your points balance',
        
        // Rate-limiting validation for refresh
        validate: (input, state) => {
          const lastRefresh = state.context.lastRefreshed || 0;
          const now = Date.now();
          
          // Only allow refresh every 60 seconds
          if (now - lastRefresh < 60000) {
            const remainingSeconds = Math.ceil((60000 - (now - lastRefresh)) / 1000);
            throw new AppError(
              `Please wait ${remainingSeconds} seconds before refreshing again.`,
              'REFRESH_RATE_LIMITED'
            );
          }
          
          return true;
        },
        
        // Process the refresh step
        process: async (input, state) => {
          const userId = state.context.userId;
          
          try {
            // Get user data from session
            const userData = await sessionManager.getUserData(userId);
            if (!userData) {
              throw new AppError('User data not found', 'USER_NOT_FOUND');
            }
            
            // Refresh user points
            const updatedBalance = await accountPointsService.refreshPoints(userId, userData);
            
            // Update session with new data
            userData.qoints = updatedBalance.qoints;
            userData.points = updatedBalance.points;
            userData.doints = updatedBalance.doints;
            userData.balance = updatedBalance.balance;
            userData.pendingQoints = updatedBalance.pendingQoints;
            
            await sessionManager.updateUserData(userId, userData);
            
            // Store updated balance in workflow context
            return {
              ...state,
              context: {
                ...state.context,
                balance: updatedBalance,
                pointsBar: accountPointsService.createBalancedBar(
                  updatedBalance.maxPoints,
                  updatedBalance.points + updatedBalance.doints,
                  updatedBalance.qoints
                ),
                lastRefreshed: Date.now(),
                refreshed: true
              }
            };
          } catch (error) {
            throw new AppError(
              'Failed to refresh points',
              'POINTS_REFRESH_FAILED',
              { cause: error }
            );
          }
        },
        
        // UI representation of refresh step
        ui: {
          type: 'display',
          title: 'Points Refreshed',
          message: 'Your points have been refreshed:',
          components: [
            {
              type: 'pointsBar',
              dataKey: 'pointsBar'
            },
            {
              type: 'text',
              template: 'Available: {{balance.maxPoints - (balance.points + balance.doints)}} points',
              format: 'markdown'
            },
            {
              type: 'text',
              template: 'Qoints: {{balance.qoints}}',
              format: 'markdown'
            },
            {
              type: 'text',
              condition: 'refreshed',
              template: '✅ Points refreshed successfully!',
              format: 'plain'
            }
          ],
          actions: [
            {
              id: 'refresh',
              label: 'Refresh Again',
              nextStep: 'refresh',
              primary: true
            },
            {
              id: 'back',
              label: 'Back to Account',
              nextStep: 'exit',
              action: 'exit'
            }
          ]
        },
        
        // Go back to view step after refresh
        nextStep: 'view'
      }
    },
    
    // Start with view step
    initialStep: 'view'
  });
}

module.exports = { createAccountPointsWorkflow }; 