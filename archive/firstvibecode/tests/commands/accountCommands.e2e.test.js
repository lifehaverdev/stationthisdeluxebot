/**
 * E2E Test Suite for Account Commands
 * 
 * Tests the full lifecycle of account-related commands including
 * points balance, transaction history, and account settings.
 */

const {
  createPointsCommand,
  createAccountCommand
} = require('../../src/commands/accountCommands');

const { createAccountPointsWorkflow, createAccountSettingsWorkflow } = require('../../src/core/workflow/workflows/AccountWorkflow');
const { AppError, ERROR_SEVERITY } = require('../../src/core/shared/errors');

// Mock dependencies
jest.mock('../../src/core/workflow/workflows/AccountWorkflow', () => {
  const actualModule = jest.requireActual('../../src/core/workflow/workflows/AccountWorkflow');
  
  return {
    ...actualModule,
    createAccountPointsWorkflow: jest.fn(options => {
      // Create a mock workflow instance with the core functionality
      return {
        createWorkflow: jest.fn(context => {
          return {
            id: 'workflow-123',
            context: {
              ...context.context,
              _services: options
            },
            getCurrentStep: jest.fn(() => ({
              id: 'view_points',
              name: 'View Points',
              ui: {
                type: 'loading',
                message: 'Fetching your points balance...'
              }
            })),
            processInput: jest.fn(input => {
              // Simple state machine simulation
              const stateMap = {
                'view_points': { nextStep: 'points_options' },
                'points_options': { 
                  nextStep: input === 'history' ? 'points_history' : 
                             input === 'refresh' ? 'view_points' : null,
                  completed: input === 'back'
                },
                'points_history': { nextStep: 'history_options' },
                'history_options': { nextStep: 'points_options' }
              };
              
              const currentStep = context.context.currentStep || 'view_points';
              return stateMap[currentStep] || { error: 'Invalid state transition' };
            }),
            getCurrentStepId: jest.fn(() => context.context.currentStep || 'view_points'),
            serialize: jest.fn(() => ({
              id: 'workflow-123',
              context: {
                ...context.context,
                currentStep: context.context.currentStep || 'view_points'
              }
            })),
            deserialize: jest.fn(serialized => ({
              id: serialized.id,
              context: serialized.context,
              getCurrentStep: jest.fn(() => ({
                id: serialized.context.currentStep
              })),
              getCurrentStepId: jest.fn(() => serialized.context.currentStep),
              processInput: jest.fn(input => {
                // Simulate state transitions based on input
                const stateMap = {
                  'view_points': { nextStep: 'points_options' },
                  'points_options': { 
                    nextStep: input === 'history' ? 'points_history' : 
                               input === 'refresh' ? 'view_points' : null,
                    completed: input === 'back'
                  },
                  'points_history': { nextStep: 'history_options' },
                  'history_options': { nextStep: 'points_options' }
                };
                
                return stateMap[serialized.context.currentStep] || { error: 'Invalid state transition' };
              }),
              serialize: jest.fn(() => serialized)
            }))
          };
        }),
        name: 'AccountPointsWorkflow'
      };
    }),
    createAccountSettingsWorkflow: jest.fn(options => {
      // Create a mock workflow instance with the core functionality
      return {
        createWorkflow: jest.fn(context => {
          return {
            id: 'workflow-123',
            context: {
              ...context.context,
              _services: options
            },
            getCurrentStep: jest.fn(() => ({
              id: 'settings_menu',
              name: 'Account Settings',
              ui: {
                type: 'options',
                message: 'Account Settings'
              }
            })),
            processInput: jest.fn(input => {
              // Simple state machine simulation
              const stateMap = {
                'settings_menu': { 
                  nextStep: input === 'profile' ? 'edit_profile' : 
                             input === 'preferences' ? 'edit_preferences' :
                             input === 'api' ? 'api_keys' :
                             input === 'delete' ? 'delete_confirmation' : null,
                  completed: input === 'back'
                },
                'edit_profile': { nextStep: 'profile_options' },
                'profile_options': { 
                  nextStep: input === 'name' ? 'edit_name' :
                             input === 'email' ? 'edit_email' : 'settings_menu'
                },
                'edit_name': { nextStep: 'profile_options' },
                'edit_email': { nextStep: 'profile_options' },
                'edit_preferences': { 
                  nextStep: input === 'language' ? 'edit_language' :
                             input === 'notifications' ? 'edit_notifications' : 'settings_menu'
                },
                'api_keys': { nextStep: 'api_options' },
                'api_options': { 
                  nextStep: input === 'create' ? 'create_api_key' :
                             input === 'revoke' ? 'revoke_api_key' : 'settings_menu'
                },
                'create_api_key': { nextStep: 'show_new_key' },
                'show_new_key': { nextStep: 'api_options' },
                'delete_confirmation': { 
                  nextStep: input === 'confirm' ? 'deletion_success' : 'settings_menu'
                },
                'deletion_success': { nextStep: null, completed: true }
              };
              
              const currentStep = context.context.currentStep || 'settings_menu';
              return stateMap[currentStep] || { error: 'Invalid state transition' };
            }),
            getCurrentStepId: jest.fn(() => context.context.currentStep || 'settings_menu'),
            serialize: jest.fn(() => ({
              id: 'workflow-123',
              context: {
                ...context.context,
                currentStep: context.context.currentStep || 'settings_menu'
              }
            })),
            deserialize: jest.fn(serialized => ({
              id: serialized.id,
              context: serialized.context,
              getCurrentStep: jest.fn(() => ({
                id: serialized.context.currentStep
              })),
              getCurrentStepId: jest.fn(() => serialized.context.currentStep),
              processInput: jest.fn(input => {
                // Simulate state transitions based on input
                const stateMap = {
                  'settings_menu': { 
                    nextStep: input === 'profile' ? 'edit_profile' : 
                               input === 'preferences' ? 'edit_preferences' :
                               input === 'api' ? 'api_keys' :
                               input === 'delete' ? 'delete_confirmation' : null,
                    completed: input === 'back'
                  },
                  'edit_profile': { nextStep: 'profile_options' },
                  'profile_options': { 
                    nextStep: input === 'name' ? 'edit_name' :
                               input === 'email' ? 'edit_email' : 'settings_menu'
                  },
                  'edit_name': { nextStep: 'profile_options' },
                  'edit_email': { nextStep: 'profile_options' },
                  'edit_preferences': { 
                    nextStep: input === 'language' ? 'edit_language' :
                               input === 'notifications' ? 'edit_notifications' : 'settings_menu'
                  },
                  'api_keys': { nextStep: 'api_options' },
                  'api_options': { 
                    nextStep: input === 'create' ? 'create_api_key' :
                               input === 'revoke' ? 'revoke_api_key' : 'settings_menu'
                  },
                  'create_api_key': { nextStep: 'show_new_key' },
                  'show_new_key': { nextStep: 'api_options' },
                  'delete_confirmation': { 
                    nextStep: input === 'confirm' ? 'deletion_success' : 'settings_menu'
                  },
                  'deletion_success': { nextStep: null, completed: true }
                };
                
                return stateMap[serialized.context.currentStep] || { error: 'Invalid state transition' };
              }),
              serialize: jest.fn(() => serialized)
            }))
          };
        }),
        name: 'AccountSettingsWorkflow'
      };
    })
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('Account Commands E2E Tests', () => {
  // Setup mocks and test fixtures
  let pointsService;
  let userService;
  let sessionManager;
  let uiManager;
  let analyticsService;
  let pointsCommand;
  let accountCommand;
  
  const mockUser = {
    id: 'user-123',
    username: 'testuser',
    points: 1000
  };
  
  const mockContext = {
    userId: mockUser.id,
    platform: 'telegram',
    messageContext: {
      chatId: 'chat-123',
      threadId: 'thread-123',
      username: mockUser.username
    }
  };
  
  // Setup mock services before tests
  beforeEach(() => {
    // Create mock points service
    pointsService = {
      getPointsBalance: jest.fn().mockImplementation(async (userId) => {
        return {
          total: 100,
          breakdown: {
            points: 50,
            qoints: 50
          },
          refreshRate: '10 per hour',
          nextRefresh: Date.now() + 3600000
        };
      }),
      getRecentTransactions: jest.fn().mockImplementation(async (userId, limit) => {
        return [
          { id: 'txn-1', amount: 10, type: 'debit', reason: 'generation', timestamp: Date.now() - 86400000 },
          { id: 'txn-2', amount: 5, type: 'credit', reason: 'refund', timestamp: Date.now() - 43200000 }
        ].slice(0, limit);
      })
    };
    
    // Create mock user service
    userService = {
      getUserProfile: jest.fn().mockImplementation(async (userId) => {
        return {
          id: userId,
          name: 'Test User',
          email: 'test@example.com',
          settings: {
            language: 'en',
            notifications: true
          },
          joinDate: Date.now() - 2592000000,
          lastActive: Date.now() - 86400000
        };
      }),
      updateUserProfile: jest.fn().mockImplementation(async (userId, data) => {
        return {
          success: true,
          id: userId,
          ...data
        };
      }),
      getUserApiKeys: jest.fn().mockImplementation(async (userId) => {
        return [
          { id: 'key-1', name: 'Test Key', created: Date.now() - 2592000000 }
        ];
      }),
      createApiKey: jest.fn().mockImplementation(async (userId, name) => {
        return {
          id: 'key-' + Math.random().toString(36).substring(7),
          name,
          key: 'ak_' + Math.random().toString(36).substring(7),
          created: Date.now()
        };
      }),
      deleteUserAccount: jest.fn().mockImplementation(async (userId) => {
        return { success: true };
      })
    };
    
    // Create mock session and session manager
    const mockSession = {
      get: jest.fn().mockImplementation((key) => {
        if (key === 'points.balance') return 100;
        if (key === 'username') return mockUser.username;
        if (key === 'locale') return 'en';
        if (key === 'workflows.workflow-123') {
          return {
            id: 'workflow-123',
            context: {
              userId: mockUser.id,
              currentStep: key.includes('points') ? 'view_points' : 'settings_menu'
            }
          };
        }
        return null;
      }),
      set: jest.fn()
    };
    
    sessionManager = {
      getSession: jest.fn().mockResolvedValue(mockSession),
      createSession: jest.fn().mockResolvedValue(mockSession),
      updateSession: jest.fn().mockResolvedValue(true)
    };
    
    // Create mock UI manager
    uiManager = {
      createComponent: jest.fn().mockImplementation((type, props) => {
        return { type, props };
      }),
      render: jest.fn().mockImplementation(async (component, options, platform, context) => {
        return {
          messageId: 'msg-' + Math.random().toString(36).substring(7),
          platform
        };
      })
    };
    
    // Create mock analytics service
    analyticsService = {
      trackEvent: jest.fn()
    };
    
    // Create command instances
    const dependencies = {
      pointsService,
      userService,
      sessionManager,
      uiManager,
      analyticsService
    };
    
    pointsCommand = createPointsCommand(dependencies);
    accountCommand = createAccountCommand(dependencies);
  });
  
  describe('Points Command Workflow', () => {
    test('Full points command workflow lifecycle', async () => {
      // 1. Start the command workflow
      const startResult = await pointsCommand.execute(mockContext);
      
      // Verify workflow started
      expect(startResult.success).toBe(true);
      expect(startResult.workflowId).toBeDefined();
      
      // Verify points fetched
      expect(pointsService.getPointsBalance).toHaveBeenCalledWith(mockUser.id);
      
      // Verify session was updated with workflow
      expect(sessionManager.updateSession).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          workflows: expect.any(Object)
        })
      );
      
      // Verify analytics were tracked
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(
        'command:account:initiated',
        expect.objectContaining({
          userId: mockUser.id,
          commandType: 'points'
        })
      );
      
      // 2. Process workflow input - navigate to history
      let inputResult = await pointsCommand.handleInput('history', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify successful navigation
      expect(inputResult.success).toBe(true);
      expect(inputResult.stepId).toBeDefined();
      
      // Verify session was updated
      expect(sessionManager.updateSession).toHaveBeenCalled();
      
      // 3. Process more workflow input - back to main menu
      inputResult = await pointsCommand.handleInput('back', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify successful navigation
      expect(inputResult.success).toBe(true);
      
      // 4. Complete workflow
      inputResult = await pointsCommand.handleInput('back', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify workflow completion
      expect(inputResult.success).toBe(true);
      expect(inputResult.completed).toBe(true);
    });
    
    test('Handle points service errors', async () => {
      // Setup error from points service
      pointsService.getPointsBalance.mockRejectedValueOnce(
        new AppError('Database error', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'DATABASE_ERROR',
          userFacing: true
        })
      );
      
      // Start the command workflow - should fail
      await expect(pointsCommand.execute(mockContext)).rejects.toThrow();
      
      // Verify error was tracked
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(
        'command:account:error',
        expect.objectContaining({
          userId: mockUser.id,
          commandType: 'points',
          error: expect.any(String)
        })
      );
    });
  });
  
  describe('Account Settings Workflow', () => {
    test('Full account settings workflow lifecycle', async () => {
      // 1. Start the command workflow
      const startResult = await accountCommand.execute(mockContext);
      
      // Verify workflow started
      expect(startResult.success).toBe(true);
      expect(startResult.workflowId).toBeDefined();
      
      // Verify user profile fetched
      expect(userService.getUserProfile).toHaveBeenCalledWith(mockUser.id);
      
      // Verify session was updated with workflow
      expect(sessionManager.updateSession).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          workflows: expect.any(Object)
        })
      );
      
      // 2. Navigate to profile section
      let inputResult = await accountCommand.handleInput('profile', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify successful navigation
      expect(inputResult.success).toBe(true);
      expect(inputResult.stepId).toBeDefined();
      
      // 3. Navigate to name edit
      inputResult = await accountCommand.handleInput('name', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify successful navigation
      expect(inputResult.success).toBe(true);
      
      // 4. Submit new name
      inputResult = await accountCommand.handleInput('New User Name', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify successful update
      expect(inputResult.success).toBe(true);
      
      // 5. Navigate back and complete workflow
      inputResult = await accountCommand.handleInput('back', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Navigate to settings menu
      expect(inputResult.success).toBe(true);
      
      // Exit workflow
      inputResult = await accountCommand.handleInput('back', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify workflow completion
      expect(inputResult.success).toBe(true);
      expect(inputResult.completed).toBe(true);
    });
    
    test('Account deletion confirmation flow', async () => {
      // 1. Start the command workflow
      await accountCommand.execute(mockContext);
      
      // 2. Navigate to delete confirmation
      await accountCommand.handleInput('delete', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify navigation to delete confirmation
      expect(sessionManager.updateSession).toHaveBeenCalled();
      
      // 3. Confirm deletion
      const deleteResult = await accountCommand.handleInput('confirm', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify successful deletion flow
      expect(deleteResult.success).toBe(true);
      
      // Verify deleteUserAccount was called
      expect(userService.deleteUserAccount).toHaveBeenCalledWith(mockUser.id);
    });
    
    test('Handle missing session in workflow', async () => {
      // Setup session not found
      sessionManager.getSession.mockResolvedValueOnce(null);
      
      // Try to process input without a valid session
      const result = await accountCommand.handleInput('profile', {
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify error response
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('SESSION_NOT_FOUND');
    });
  });
}); 