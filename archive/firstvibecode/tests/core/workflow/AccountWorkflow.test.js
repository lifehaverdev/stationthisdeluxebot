/**
 * Account Workflow Tests
 * 
 * Tests the functionality of the Account Workflow.
 */

const { createAccountWorkflow } = require('../../../src/core/workflow/workflows/AccountWorkflow');

// Mock dependencies
const mockAccountService = {
  getUserProfile: jest.fn(),
  updateUserProfile: jest.fn(),
  getUserPreferences: jest.fn(),
  updateUserPreferences: jest.fn(),
  getUserApiKeys: jest.fn(),
  generateApiKey: jest.fn(),
  deleteApiKey: jest.fn(),
  deleteUserAccount: jest.fn()
};

const mockPointsService = {
  getUserBalance: jest.fn(),
  getUserTransactions: jest.fn(),
  refreshPoints: jest.fn(),
  createBalanceBar: jest.fn()
};

const mockAnalyticsService = {
  trackEvent: jest.fn()
};

const mockDeliveryAdapter = {
  deliverMessage: jest.fn()
};

describe('AccountWorkflow', () => {
  let workflow;
  let workflowInstance;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock return values
    mockAccountService.getUserProfile.mockResolvedValue({
      name: 'Test User',
      username: 'testuser',
      createdAt: 1609459200000,
      verified: true
    });
    
    mockAccountService.getUserPreferences.mockResolvedValue({
      notifications: true,
      language: 'en',
      theme: 'default'
    });
    
    mockAccountService.getUserApiKeys.mockResolvedValue([
      {
        id: 'key1',
        name: 'Test Key',
        createdAt: 1609459200000,
        truncatedKey: 'sk-1...abc'
      }
    ]);
    
    mockPointsService.getUserBalance.mockResolvedValue({
      points: 1000,
      qoints: 100,
      maxPoints: 10000,
      spentPoints: 2000
    });
    
    mockPointsService.getUserTransactions.mockResolvedValue([
      {
        timestamp: 1609459200000,
        amount: -100,
        reason: 'Test transaction'
      }
    ]);
    
    mockPointsService.createBalanceBar.mockReturnValue('🔷🔷🔹▫️▫️▫️▫️');
    
    // Create workflow instance
    workflow = createAccountWorkflow({
      accountService: mockAccountService,
      pointsService: mockPointsService,
      analyticsService: mockAnalyticsService,
      deliveryAdapter: mockDeliveryAdapter
    });
    
    // Create a workflow instance with standard context
    workflowInstance = workflow.createWorkflow({
      context: {
        userId: 'user123',
        platform: 'telegram',
        username: 'testuser',
        chatId: 'chat123',
        threadId: 'thread123',
        locale: 'en',
        workflowId: 'workflow123',
        startedAt: Date.now()
      }
    });
  });

  describe('initialization', () => {
    test('should throw error when accountService is missing', () => {
      // Act & Assert
      expect(() => createAccountWorkflow({
        pointsService: mockPointsService
      })).toThrow('Account service is required');
    });
    
    test('should initialize workflow with proper structure', () => {
      // Assert
      expect(workflow).toBeDefined();
      expect(workflow.steps).toBeDefined();
      expect(workflow.name).toBe('AccountWorkflow');
      
      // Check for critical steps
      expect(workflow.steps.main).toBeDefined();
      expect(workflow.steps.profile).toBeDefined();
      expect(workflow.steps.preferences).toBeDefined();
      expect(workflow.steps.points).toBeDefined();
      expect(workflow.steps.apikeys).toBeDefined();
      expect(workflow.steps.delete_confirm).toBeDefined();
    });
  });

  describe('main menu step', () => {
    test('should render main menu with all options', async () => {
      // Act
      const result = await workflowInstance.processStep();
      
      // Assert
      expect(result.nextStep).toBe('main');
      expect(result.ui).toEqual({
        type: 'menu',
        title: 'Account Settings',
        message: 'Select an option to manage your account:',
        options: [
          { id: 'profile', text: 'Profile' },
          { id: 'preferences', text: 'Preferences' },
          { id: 'apikeys', text: 'API Keys' },
          { id: 'points', text: 'Points' },
          { id: 'delete', text: 'Delete Account' }
        ]
      });
      
      // Should track view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:main-menu', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should route to correct step based on user input', async () => {
      // Act & Assert for each option
      let result = await workflowInstance.processInput('profile');
      expect(result.nextStep).toBe('profile');
      
      result = await workflowInstance.processInput('preferences');
      expect(result.nextStep).toBe('preferences');
      
      result = await workflowInstance.processInput('apikeys');
      expect(result.nextStep).toBe('apikeys');
      
      result = await workflowInstance.processInput('points');
      expect(result.nextStep).toBe('points');
      
      result = await workflowInstance.processInput('delete');
      expect(result.nextStep).toBe('delete_confirm');
      
      // Invalid input should stay on same step
      result = await workflowInstance.processInput('invalidoption');
      expect(result.nextStep).toBe('main');
    });
  });

  describe('profile step', () => {
    test('should display user profile information', async () => {
      // Act - First go to profile step
      await workflowInstance.processInput('profile');
      const result = await workflowInstance.processStep();
      
      // Assert
      expect(result.nextStep).toBe('profile');
      expect(result.ui).toEqual({
        type: 'menu',
        title: 'Profile Information',
        message: 'Name: Test User\nUsername: testuser\nMember since: 1/1/2021',
        options: [
          { id: 'name', text: 'Change Name' },
          { id: 'back', text: 'Back to Account' }
        ]
      });
      
      // Should get profile from service
      expect(mockAccountService.getUserProfile).toHaveBeenCalledWith('user123');
      
      // Should track view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:profile-view', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should handle name change input flow', async () => {
      // Act - Go to profile step
      await workflowInstance.processInput('profile');
      await workflowInstance.processStep();
      
      // Navigate to name change
      await workflowInstance.processInput('name');
      const namePromptResult = await workflowInstance.processStep();
      
      // Assert prompt
      expect(namePromptResult.nextStep).toBe('name_change');
      expect(namePromptResult.ui).toEqual({
        type: 'input',
        title: 'Change Your Name',
        message: 'Enter your new name:',
        options: [
          { id: 'back', text: 'Cancel' }
        ]
      });
      
      // Submit new name
      mockAccountService.updateUserProfile.mockResolvedValue({
        name: 'New Name',
        username: 'testuser',
        createdAt: 1609459200000,
        verified: true
      });
      
      await workflowInstance.processInput('New Name');
      
      // Assert
      expect(mockAccountService.updateUserProfile).toHaveBeenCalledWith('user123', { name: 'New Name' });
      expect(mockDeliveryAdapter.deliverMessage).toHaveBeenCalledWith({
        userId: 'user123',
        message: 'Your name has been updated successfully!'
      });
      
      // Should track update
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:name-updated', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should validate name input', async () => {
      // Act - Go to name change step
      await workflowInstance.processInput('profile');
      await workflowInstance.processStep();
      await workflowInstance.processInput('name');
      await workflowInstance.processStep();
      
      // Submit invalid name (too short)
      const result = await workflowInstance.processInput('A');
      
      // Assert
      expect(result.nextStep).toBe('name_change');
      expect(result.ui.message).toContain('Name must be at least 2 characters');
      expect(mockAccountService.updateUserProfile).not.toHaveBeenCalled();
    });
  });

  describe('preferences step', () => {
    test('should display user preferences', async () => {
      // Act - First go to preferences step
      await workflowInstance.processInput('preferences');
      const result = await workflowInstance.processStep();
      
      // Assert
      expect(result.nextStep).toBe('preferences');
      expect(result.ui).toEqual({
        type: 'menu',
        title: 'Preferences',
        message: 'Notifications: Enabled\nLanguage: en\nTheme: default',
        options: [
          { id: 'notifications', text: 'Disable Notifications' },
          { id: 'language', text: 'Change Language' },
          { id: 'theme', text: 'Change Theme' },
          { id: 'back', text: 'Back to Account' }
        ]
      });
      
      // Should get preferences from service
      expect(mockAccountService.getUserPreferences).toHaveBeenCalledWith('user123');
      
      // Should track view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:preferences-view', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should toggle notifications', async () => {
      // Act - Go to preferences step
      await workflowInstance.processInput('preferences');
      await workflowInstance.processStep();
      
      // Mock the update response with toggled value
      mockAccountService.updateUserPreferences.mockResolvedValue({
        notifications: false,
        language: 'en',
        theme: 'default'
      });
      
      // Toggle notifications
      await workflowInstance.processInput('notifications');
      
      // Assert
      expect(mockAccountService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        notifications: false
      });
      
      // Should track update
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:preferences-updated', {
        userId: 'user123',
        platform: 'telegram',
        setting: 'notifications',
        value: false,
        timestamp: expect.any(Number)
      });
    });
    
    test('should handle language selection flow', async () => {
      // Act - Go to preferences step
      await workflowInstance.processInput('preferences');
      await workflowInstance.processStep();
      
      // Navigate to language selection
      await workflowInstance.processInput('language');
      const languagePromptResult = await workflowInstance.processStep();
      
      // Assert prompt
      expect(languagePromptResult.nextStep).toBe('language_select');
      expect(languagePromptResult.ui.options).toEqual([
        { id: 'en', text: 'English' },
        { id: 'es', text: 'Spanish' },
        { id: 'fr', text: 'French' },
        { id: 'de', text: 'German' },
        { id: 'back', text: 'Back to Preferences' }
      ]);
      
      // Select a language
      mockAccountService.updateUserPreferences.mockResolvedValue({
        notifications: true,
        language: 'es',
        theme: 'default'
      });
      
      await workflowInstance.processInput('es');
      
      // Assert
      expect(mockAccountService.updateUserPreferences).toHaveBeenCalledWith('user123', {
        language: 'es'
      });
      
      // Should track update
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:language-updated', {
        userId: 'user123',
        platform: 'telegram',
        language: 'es',
        timestamp: expect.any(Number)
      });
    });
  });

  describe('points step', () => {
    test('should display points balance', async () => {
      // Act - First go to points step
      await workflowInstance.processInput('points');
      const result = await workflowInstance.processStep();
      
      // Assert
      expect(result.nextStep).toBe('points');
      expect(result.ui.title).toBe('Points Balance');
      expect(result.ui.message).toContain('Available: 1000 points');
      expect(result.ui.message).toContain('Qoints: 100');
      expect(result.ui.message).toContain('🔷🔷🔹▫️▫️▫️▫️'); // Balance bar
      
      // Should have options
      expect(result.ui.options).toEqual([
        { id: 'history', text: 'View History' },
        { id: 'refresh', text: 'Refresh Balance' },
        { id: 'back', text: 'Back to Account' }
      ]);
      
      // Should get data from services
      expect(mockPointsService.getUserBalance).toHaveBeenCalledWith('user123');
      expect(mockPointsService.getUserTransactions).toHaveBeenCalledWith('user123');
      expect(mockPointsService.createBalanceBar).toHaveBeenCalled();
      
      // Should track view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:points-view', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should display transaction history', async () => {
      // Act - Go to points step
      await workflowInstance.processInput('points');
      await workflowInstance.processStep();
      
      // Navigate to history
      await workflowInstance.processInput('history');
      const historyResult = await workflowInstance.processStep();
      
      // Assert
      expect(historyResult.nextStep).toBe('points_history');
      expect(historyResult.ui.title).toBe('Transaction History');
      expect(historyResult.ui.message).toContain('1/1/2021: -100 points - Test transaction');
      
      // Should have back option
      expect(historyResult.ui.options).toEqual([
        { id: 'back', text: 'Back to Points' }
      ]);
      
      // Should track view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:points-history', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should refresh points balance', async () => {
      // Act - Go to points step
      await workflowInstance.processInput('points');
      await workflowInstance.processStep();
      
      // Mock updated balance after refresh
      mockPointsService.refreshPoints.mockResolvedValue({
        points: 1200, // Increased points
        qoints: 100,
        maxPoints: 10000,
        spentPoints: 2000
      });
      
      // Refresh balance
      await workflowInstance.processInput('refresh');
      
      // Assert
      expect(mockPointsService.refreshPoints).toHaveBeenCalledWith('user123', expect.anything());
      
      // Should track refresh
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:points-refreshed', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
  });

  describe('API keys step', () => {
    test('should display API keys list', async () => {
      // Act - First go to API keys step
      await workflowInstance.processInput('apikeys');
      const result = await workflowInstance.processStep();
      
      // Assert
      expect(result.nextStep).toBe('apikeys');
      expect(result.ui.title).toBe('API Keys');
      expect(result.ui.message).toContain('Name: Test Key');
      expect(result.ui.message).toContain('Key: sk-1...abc');
      
      // Should have options
      expect(result.ui.options).toEqual([
        { id: 'create', text: 'Create New Key' },
        { id: 'delete', text: 'Delete Key' },
        { id: 'back', text: 'Back to Account' }
      ]);
      
      // Should get data from service
      expect(mockAccountService.getUserApiKeys).toHaveBeenCalledWith('user123');
      
      // Should track view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:apikeys-view', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should create new API key', async () => {
      // Act - Go to API keys step
      await workflowInstance.processInput('apikeys');
      await workflowInstance.processStep();
      
      // Navigate to create key
      await workflowInstance.processInput('create');
      const createPromptResult = await workflowInstance.processStep();
      
      // Assert prompt
      expect(createPromptResult.nextStep).toBe('apikey_create');
      expect(createPromptResult.ui.title).toBe('Create API Key');
      
      // Mock the generated API key
      mockAccountService.generateApiKey.mockResolvedValue({
        id: 'newkey123',
        name: 'New API Key',
        key: 'sk-newapikey123',
        createdAt: Date.now()
      });
      
      // Submit key name
      await workflowInstance.processInput('New API Key');
      
      // Assert
      expect(mockAccountService.generateApiKey).toHaveBeenCalledWith('user123', 'New API Key');
      expect(mockDeliveryAdapter.deliverMessage).toHaveBeenCalledWith({
        userId: 'user123',
        message: expect.stringContaining('Your new API key has been created')
      });
      
      // Verify message contains the key
      const message = mockDeliveryAdapter.deliverMessage.mock.calls[0][0].message;
      expect(message).toContain('sk-newapikey123');
      
      // Should track creation
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:apikey-created', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should validate API key name', async () => {
      // Act - Go to create key step
      await workflowInstance.processInput('apikeys');
      await workflowInstance.processStep();
      await workflowInstance.processInput('create');
      await workflowInstance.processStep();
      
      // Submit invalid name (too short)
      const result = await workflowInstance.processInput('A');
      
      // Assert
      expect(result.nextStep).toBe('apikey_create');
      expect(result.ui.message).toContain('Name must be at least 2 characters');
      expect(mockAccountService.generateApiKey).not.toHaveBeenCalled();
    });
    
    test('should delete API key with confirmation', async () => {
      // Act - Go to API keys step
      await workflowInstance.processInput('apikeys');
      await workflowInstance.processStep();
      
      // Navigate to delete key
      await workflowInstance.processInput('delete');
      const deletePromptResult = await workflowInstance.processStep();
      
      // Assert selection options
      expect(deletePromptResult.nextStep).toBe('apikey_delete');
      expect(deletePromptResult.ui.title).toBe('Delete API Key');
      expect(deletePromptResult.ui.options[0]).toEqual({
        id: 'key1',
        text: 'Test Key (sk-1...abc)'
      });
      
      // Select a key to delete
      await workflowInstance.processInput('key1');
      const confirmResult = await workflowInstance.processStep();
      
      // Assert confirm prompt
      expect(confirmResult.nextStep).toBe('apikey_delete_confirm');
      expect(confirmResult.ui.message).toContain('Are you sure you want to delete');
      
      // Confirm deletion
      await workflowInstance.processInput('confirm');
      
      // Assert
      expect(mockAccountService.deleteApiKey).toHaveBeenCalledWith('user123', 'key1');
      expect(mockDeliveryAdapter.deliverMessage).toHaveBeenCalledWith({
        userId: 'user123',
        message: expect.stringContaining('has been deleted')
      });
      
      // Should track deletion
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:apikey-deleted', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
  });

  describe('account deletion flow', () => {
    test('should confirm before deleting account', async () => {
      // Act - Go to delete step
      await workflowInstance.processInput('delete');
      const confirmResult = await workflowInstance.processStep();
      
      // Assert confirmation prompt
      expect(confirmResult.nextStep).toBe('delete_confirm');
      expect(confirmResult.ui.title).toBe('Delete Account');
      expect(confirmResult.ui.message).toContain('Are you sure you want to delete your account');
      expect(confirmResult.ui.options).toEqual([
        { id: 'confirm', text: 'Yes, Delete My Account' },
        { id: 'cancel', text: 'Cancel' }
      ]);
      
      // Should track confirmation screen view
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:delete-confirm', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should delete account when confirmed', async () => {
      // Act - Go to delete confirmation
      await workflowInstance.processInput('delete');
      await workflowInstance.processStep();
      
      // Confirm deletion
      mockAccountService.deleteUserAccount.mockResolvedValue(true);
      await workflowInstance.processInput('confirm');
      
      // Assert
      expect(mockAccountService.deleteUserAccount).toHaveBeenCalledWith('user123');
      expect(mockDeliveryAdapter.deliverMessage).toHaveBeenCalledWith({
        userId: 'user123',
        message: expect.stringContaining('Your account has been deleted')
      });
      
      // Should track deletion
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:account-deleted', {
        userId: 'user123',
        platform: 'telegram',
        timestamp: expect.any(Number)
      });
    });
    
    test('should cancel account deletion', async () => {
      // Act - Go to delete confirmation
      await workflowInstance.processInput('delete');
      await workflowInstance.processStep();
      
      // Cancel deletion
      await workflowInstance.processInput('cancel');
      
      // Assert
      expect(mockAccountService.deleteUserAccount).not.toHaveBeenCalled();
      // Should return to main menu
      const nextStepResult = await workflowInstance.processStep();
      expect(nextStepResult.nextStep).toBe('main');
    });
  });

  describe('error handling', () => {
    test('should handle and report service errors', async () => {
      // Arrange - Make the profile service throw an error
      mockAccountService.getUserProfile.mockRejectedValue(new Error('Failed to fetch profile'));
      
      // Act - Go to profile step which will now error
      await workflowInstance.processInput('profile');
      const result = await workflowInstance.processStep();
      
      // Assert
      expect(result.nextStep).toBe('error');
      expect(result.error).toBe('Failed to fetch profile');
      
      // Error step should render error message
      const errorStep = await workflowInstance.processStep();
      expect(errorStep.ui.title).toBe('Error');
      expect(errorStep.ui.message).toContain('An error occurred: Failed to fetch profile');
      
      // Should track error
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('workflow:account:error', {
        userId: 'user123',
        step: 'profile',
        error: 'Failed to fetch profile'
      });
    });
    
    test('should allow returning to main menu from error', async () => {
      // Act - Go to error step
      await workflowInstance.processInput('profile');
      mockAccountService.getUserProfile.mockRejectedValue(new Error('Test error'));
      await workflowInstance.processStep(); // This will error
      await workflowInstance.processStep(); // This renders the error UI
      
      // Navigate back to main from error
      const result = await workflowInstance.processInput('main');
      
      // Assert
      expect(result.nextStep).toBe('main');
      
      // Should be able to render main menu again
      const mainStep = await workflowInstance.processStep();
      expect(mainStep.ui.title).toBe('Account Settings');
    });
  });
}); 