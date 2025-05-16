/**
 * End-to-End tests for the Account Workflow
 * 
 * These tests verify the complete flow of account management functionality
 * including handling user input, state transitions, and service interactions.
 */

const { createAccountWorkflow } = require('../../../src/core/workflow/workflows/AccountWorkflow');

// Mock services and dependencies
const mockAccountService = {
  getUserProfile: jest.fn().mockResolvedValue({
    name: 'Test User',
    username: 'testuser',
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
    verified: false
  }),
  updateUserProfile: jest.fn().mockResolvedValue({
    name: 'Updated User',
    username: 'testuser'
  }),
  getUserPreferences: jest.fn().mockResolvedValue({
    notifications: true,
    language: 'en',
    theme: 'default'
  }),
  updateUserPreferences: jest.fn().mockResolvedValue({
    notifications: false,
    language: 'en',
    theme: 'default'
  }),
  getUserApiKeys: jest.fn().mockResolvedValue([
    {
      id: 'key-123',
      name: 'Test Key',
      truncatedKey: 'sk_1...abcd',
      createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000 // 7 days ago
    }
  ]),
  generateApiKey: jest.fn().mockResolvedValue({
    id: 'key-456',
    name: 'New Key',
    key: 'sk_test_12345abcdef',
    createdAt: Date.now()
  }),
  deleteApiKey: jest.fn().mockResolvedValue(true),
  deleteUserAccount: jest.fn().mockResolvedValue(true)
};

const mockPointsService = {
  getUserPoints: jest.fn().mockResolvedValue(1000),
  getUserTransactions: jest.fn().mockResolvedValue([
    { amount: 100, reason: 'Daily bonus', timestamp: Date.now() - 86400000 },
    { amount: -50, reason: 'Image generation', timestamp: Date.now() - 43200000 }
  ]),
  refreshUserPoints: jest.fn().mockResolvedValue(1050)
};

const mockAnalyticsService = {
  trackEvent: jest.fn()
};

const mockDeliveryAdapter = {
  deliverMessage: jest.fn().mockResolvedValue(true)
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('Account Workflow E2E Tests', () => {
  describe('Main Menu Flow', () => {
    test('should initialize and render the main menu', async () => {
      // Create the workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      // Start a new workflow instance
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Get the first step
      const initialStep = workflowInstance.getCurrentStep();
      
      // Verify the step is 'main' and has the correct UI
      expect(initialStep.id).toBe('main');
      expect(initialStep.ui).toMatchObject({
        type: 'menu',
        title: 'Account Settings',
        buttons: expect.arrayContaining([
          { id: 'profile', text: 'Profile' },
          { id: 'preferences', text: 'Preferences' },
          { id: 'apikeys', text: 'API Keys' },
          { id: 'points', text: 'Points Balance' },
          { id: 'delete', text: 'Delete Account' }
        ])
      });
      
      // Verify analytics event was tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:main',
        expect.objectContaining({
          userId: 'user-123',
          platform: 'telegram'
        })
      );
    });
    
    test('should navigate to profile view when selected', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Process input to navigate to profile
      await workflowInstance.processInput('profile');
      
      // Get the current step
      const currentStep = workflowInstance.getCurrentStep();
      
      // Verify we're now on the profile step
      expect(currentStep.id).toBe('profile');
      expect(currentStep.ui).toMatchObject({
        type: 'menu',
        title: 'Profile Information'
      });
      
      // Verify account service was called
      expect(mockAccountService.getUserProfile).toHaveBeenCalledWith('user-123');
      
      // Verify analytics event was tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:profile',
        expect.objectContaining({
          userId: 'user-123',
          platform: 'telegram'
        })
      );
    });
  });
  
  describe('Profile Management Flow', () => {
    test('should handle name change flow', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to profile
      await workflowInstance.processInput('profile');
      
      // Select name change
      await workflowInstance.processInput('changeName');
      
      // Verify we're on the name change prompt step
      expect(workflowInstance.getCurrentStep().id).toBe('nameChangePrompt');
      
      // Verify prompt was delivered
      expect(mockDeliveryAdapter.deliverMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          message: expect.stringContaining('enter your new name')
        })
      );
      
      // Submit new name
      await workflowInstance.processInput('New User Name');
      
      // Verify name was updated
      expect(mockAccountService.updateUserProfile).toHaveBeenCalledWith(
        'user-123',
        { name: 'New User Name' }
      );
      
      // Verify we're back to profile step
      expect(workflowInstance.getCurrentStep().id).toBe('profile');
      
      // Verify analytics event was tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:nameChanged',
        expect.objectContaining({
          userId: 'user-123',
          platform: 'telegram'
        })
      );
    });
    
    test('should validate name input', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to profile and select name change
      await workflowInstance.processInput('profile');
      await workflowInstance.processInput('changeName');
      
      // Submit invalid name (too short)
      await workflowInstance.processInput('A');
      
      // Verify error message was sent
      expect(mockDeliveryAdapter.deliverMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          message: expect.stringContaining('at least 2 characters')
        })
      );
      
      // Verify we're still on name change prompt
      expect(workflowInstance.getCurrentStep().id).toBe('nameChangePrompt');
      
      // Verify update was not called
      expect(mockAccountService.updateUserProfile).not.toHaveBeenCalled();
    });
  });
  
  describe('Preferences Flow', () => {
    test('should render preferences and handle toggle notifications', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to preferences
      await workflowInstance.processInput('preferences');
      
      // Verify preferences step
      expect(workflowInstance.getCurrentStep().id).toBe('preferences');
      expect(workflowInstance.getCurrentStep().ui).toMatchObject({
        type: 'menu',
        title: 'Preferences',
        text: expect.stringContaining('Notifications: Enabled')
      });
      
      // Toggle notifications
      await workflowInstance.processInput('toggleNotifications');
      
      // Verify preferences were updated
      expect(mockAccountService.updateUserPreferences).toHaveBeenCalledWith(
        'user-123',
        { notifications: false }
      );
      
      // Verify analytics event was tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:preferencesUpdated',
        expect.objectContaining({
          userId: 'user-123',
          setting: 'notifications',
          value: false
        })
      );
    });
    
    test('should handle language selection', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to preferences
      await workflowInstance.processInput('preferences');
      
      // Select language
      await workflowInstance.processInput('language');
      
      // Verify language selection step
      expect(workflowInstance.getCurrentStep().id).toBe('languageSelection');
      expect(workflowInstance.getCurrentStep().ui).toMatchObject({
        type: 'menu',
        title: 'Language Selection',
        buttons: expect.arrayContaining([
          { id: 'en', text: 'English' },
          { id: 'es', text: 'Spanish' },
          { id: 'fr', text: 'French' }
        ])
      });
      
      // Select a language
      await workflowInstance.processInput('es');
      
      // Verify preferences were updated
      expect(mockAccountService.updateUserPreferences).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          language: 'es'
        })
      );
      
      // Verify analytics event
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:preferences:language',
        expect.objectContaining({
          userId: 'user-123',
          language: 'es'
        })
      );
    });
  });
  
  describe('API Keys Flow', () => {
    test('should list API keys and generate a new key', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to API keys
      await workflowInstance.processInput('apikeys');
      
      // Verify API keys step
      expect(workflowInstance.getCurrentStep().id).toBe('apikeys');
      expect(workflowInstance.getCurrentStep().ui).toMatchObject({
        type: 'menu',
        title: 'API Key Management',
        text: expect.stringContaining('Test Key')
      });
      
      // Generate a new key
      await workflowInstance.processInput('generate');
      
      // Verify key name prompt step
      expect(workflowInstance.getCurrentStep().id).toBe('keyNamePrompt');
      
      // Enter key name
      await workflowInstance.processInput('My New Key');
      
      // Verify key was generated
      expect(mockAccountService.generateApiKey).toHaveBeenCalledWith(
        'user-123',
        'My New Key'
      );
      
      // Verify key display step
      expect(workflowInstance.getCurrentStep().id).toBe('keyDisplay');
      expect(workflowInstance.getCurrentStep().ui.text).toContain('sk_test_12345abcdef');
      
      // Verify analytics event
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:apikey:generated',
        expect.objectContaining({
          userId: 'user-123'
        })
      );
    });
    
    test('should handle API key deletion', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to API keys
      await workflowInstance.processInput('apikeys');
      
      // Delete a key
      await workflowInstance.processInput('delete-key-123');
      
      // Verify deletion confirmation step
      expect(workflowInstance.getCurrentStep().id).toBe('keyDeleteConfirm');
      
      // Confirm deletion
      await workflowInstance.processInput('confirm');
      
      // Verify key was deleted
      expect(mockAccountService.deleteApiKey).toHaveBeenCalledWith(
        'user-123',
        'key-123'
      );
      
      // Verify we're back to API keys listing
      expect(workflowInstance.getCurrentStep().id).toBe('apikeys');
      
      // Verify analytics event
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:apikey:deleted',
        expect.objectContaining({
          userId: 'user-123',
          keyId: 'key-123'
        })
      );
    });
  });
  
  describe('Points Flow', () => {
    test('should show points balance and history', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to points
      await workflowInstance.processInput('points');
      
      // Verify points step
      expect(workflowInstance.getCurrentStep().id).toBe('points');
      expect(workflowInstance.getCurrentStep().ui).toMatchObject({
        type: 'menu',
        title: 'Points Balance',
        text: expect.stringContaining('1000 points')
      });
      
      // Verify points service was called
      expect(mockPointsService.getUserPoints).toHaveBeenCalledWith('user-123');
      expect(mockPointsService.getUserTransactions).toHaveBeenCalledWith('user-123');
      
      // Refresh points
      await workflowInstance.processInput('refresh');
      
      // Verify points were refreshed
      expect(mockPointsService.refreshUserPoints).toHaveBeenCalledWith('user-123');
      
      // Verify analytics event
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:points:refreshed',
        expect.objectContaining({
          userId: 'user-123'
        })
      );
    });
  });
  
  describe('Account Deletion Flow', () => {
    test('should confirm and complete account deletion', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to delete account
      await workflowInstance.processInput('delete');
      
      // Verify delete confirmation step
      expect(workflowInstance.getCurrentStep().id).toBe('deleteConfirm');
      expect(workflowInstance.getCurrentStep().ui).toMatchObject({
        type: 'menu',
        title: 'Confirm Account Deletion',
        text: expect.stringContaining('cannot be undone')
      });
      
      // Confirm deletion
      await workflowInstance.processInput('confirm');
      
      // Verify prompt for typing 'DELETE'
      expect(workflowInstance.getCurrentStep().id).toBe('deleteVerify');
      
      // Type DELETE
      await workflowInstance.processInput('DELETE');
      
      // Verify account was deleted
      expect(mockAccountService.deleteUserAccount).toHaveBeenCalledWith('user-123');
      
      // Verify analytics event
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:deleted',
        expect.objectContaining({
          userId: 'user-123'
        })
      );
    });
    
    test('should cancel account deletion', async () => {
      // Create and initialize workflow
      const workflow = createAccountWorkflow({
        accountService: mockAccountService,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        deliveryAdapter: mockDeliveryAdapter
      });
      
      const workflowInstance = await workflow.createWorkflow({
        context: {
          userId: 'user-123',
          platform: 'telegram',
          chatId: 'chat-123'
        }
      });
      
      // Navigate to delete account
      await workflowInstance.processInput('delete');
      
      // Cancel deletion
      await workflowInstance.processInput('cancel');
      
      // Verify we're back to main menu
      expect(workflowInstance.getCurrentStep().id).toBe('main');
      
      // Verify account was not deleted
      expect(mockAccountService.deleteUserAccount).not.toHaveBeenCalled();
      
      // Verify analytics event
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
        'workflow:account:deleteAborted',
        expect.objectContaining({
          userId: 'user-123'
        })
      );
    });
  });
}); 