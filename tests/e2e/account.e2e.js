/**
 * Account Commands E2E Tests
 * 
 * End-to-end tests for account-related commands including:
 * - Points balance and history
 * - Account settings
 * - Profile management
 */

const { connectToBot, disconnectBot } = require('../helpers/botConnection');
const { createTestUser, clearUserData } = require('../helpers/dataHelpers');
const { executeCommand, waitForResponse, expectText, expectButton } = require('../helpers/testHelpers');

// Test user details
const TEST_USER = {
  id: 'e2e-test-user-' + Date.now(),
  name: 'E2E Test User',
  username: 'e2etester',
  initialPoints: 500
};

// Global variables
let bot;
let userId = TEST_USER.id;

describe('Account Commands', () => {
  beforeAll(async () => {
    // Connect to test bot instance
    bot = await connectToBot();
    
    // Create test user with initial points balance
    await createTestUser(bot, {
      userId: TEST_USER.id,
      username: TEST_USER.username, 
      name: TEST_USER.name,
      points: TEST_USER.initialPoints
    });
  });

  afterAll(async () => {
    // Clean up user data
    await clearUserData(bot, TEST_USER.id);
    
    // Disconnect from bot
    await disconnectBot(bot);
  });

  afterEach(async () => {
    // Reset user state between tests
    await bot.resetUserState(userId);
  });

  describe('Points command', () => {
    test('should show points balance', async () => {
      // Execute points command
      await executeCommand(bot, userId, '/points');
      
      // Wait for and verify response
      const response = await waitForResponse(bot, userId);
      
      // Verify points balance is shown
      expectText(response, `You currently have ${TEST_USER.initialPoints} points`);
      
      // Verify buttons exist
      expectButton(response, 'View History');
      expectButton(response, 'Refresh');
    });

    test('should show transaction history', async () => {
      // Execute points command
      await executeCommand(bot, userId, '/points');
      
      // Click on "View History" button
      await bot.clickButton(userId, 'points:history');
      
      // Wait for and verify response
      const response = await waitForResponse(bot, userId);
      
      // Verify transaction history or empty state message
      // The test user might not have any transactions by default
      expectText(response, 'Transaction History');
      
      // Verify back button exists
      expectButton(response, 'Back to Points');
    });

    test('should refresh points balance', async () => {
      // Execute points command
      await executeCommand(bot, userId, '/points');
      
      // Click on "Refresh" button
      await bot.clickButton(userId, 'points:refresh');
      
      // Wait for and verify response
      const response = await waitForResponse(bot, userId);
      
      // Verify points balance is shown again
      expectText(response, `You currently have ${TEST_USER.initialPoints} points`);
    });

    test('should handle errors gracefully', async () => {
      // Temporarily break the points service connection
      await bot.simulateServiceFailure('points');
      
      // Execute points command
      await executeCommand(bot, userId, '/points');
      
      // Wait for and verify error response
      const response = await waitForResponse(bot, userId);
      
      // Verify error message
      expectText(response, 'Error retrieving points');
      
      // Restore service
      await bot.restoreService('points');
    });
  });

  describe('Account command', () => {
    test('should show account settings', async () => {
      // Execute account command
      await executeCommand(bot, userId, '/account');
      
      // Wait for and verify response
      const response = await waitForResponse(bot, userId);
      
      // Verify account settings shown
      expectText(response, 'Account Settings');
      
      // Verify all option buttons exist
      expectButton(response, 'Profile');
      expectButton(response, 'Preferences');
      expectButton(response, 'API Keys');
      expectButton(response, 'Delete Account');
    });

    test('should show and edit profile information', async () => {
      // Execute account command
      await executeCommand(bot, userId, '/account');
      
      // Click on "Profile" button
      await bot.clickButton(userId, 'account:profile');
      
      // Wait for profile view
      let response = await waitForResponse(bot, userId);
      
      // Verify profile information
      expectText(response, `Name: ${TEST_USER.name}`);
      expectText(response, `Username: ${TEST_USER.username}`);
      expectButton(response, 'Change Name');
      
      // Test changing name
      await bot.clickButton(userId, 'account:profile:name');
      
      // Wait for name change prompt
      response = await waitForResponse(bot, userId);
      expectText(response, 'Enter your new name:');
      
      // Send new name
      const newName = 'Updated Test Name';
      await bot.sendMessage(userId, newName);
      
      // Wait for confirmation and updated profile
      response = await waitForResponse(bot, userId);
      expectText(response, 'Your name has been updated successfully');
      
      // Profile should be displayed again with updated name
      response = await waitForResponse(bot, userId);
      expectText(response, `Name: ${newName}`);
    });

    test('should manage preferences', async () => {
      // Execute account command
      await executeCommand(bot, userId, '/account');
      
      // Click on "Preferences" button
      await bot.clickButton(userId, 'account:preferences');
      
      // Wait for preferences view
      let response = await waitForResponse(bot, userId);
      
      // Verify preferences information
      expectText(response, 'Language:');
      expectText(response, 'Notifications:');
      expectButton(response, 'Language');
      expectButton(response, 'Toggle Notifications');
      
      // Test changing language
      await bot.clickButton(userId, 'account:preferences:language');
      
      // Wait for language options
      response = await waitForResponse(bot, userId);
      expectText(response, 'Select Language');
      expectButton(response, 'English');
      expectButton(response, 'Spanish');
      
      // Select Spanish
      await bot.clickButton(userId, 'account:preferences:language:es');
      
      // Wait for confirmation and updated preferences
      response = await waitForResponse(bot, userId);
      expectText(response, 'Language preference updated successfully');
      
      // Preferences should be displayed again with updated language
      response = await waitForResponse(bot, userId);
      expectText(response, 'Language: Spanish');
      
      // Test toggling notifications
      await bot.clickButton(userId, 'account:preferences:notifications');
      
      // Wait for confirmation
      response = await waitForResponse(bot, userId);
      expectText(response, 'Notifications have been');
    });

    test('should manage API keys', async () => {
      // Execute account command
      await executeCommand(bot, userId, '/account');
      
      // Click on "API Keys" button
      await bot.clickButton(userId, 'account:apikeys');
      
      // Wait for API keys view
      let response = await waitForResponse(bot, userId);
      
      // Verify API keys view
      expectText(response, 'API Keys');
      expectButton(response, 'Create New Key');
      
      // Test creating a new API key
      await bot.clickButton(userId, 'account:apikeys:create');
      
      // Wait for key name prompt
      response = await waitForResponse(bot, userId);
      expectText(response, 'Enter a name for your new API key:');
      
      // Send key name
      const keyName = 'Test API Key';
      await bot.sendMessage(userId, keyName);
      
      // Wait for confirmation with the API key
      response = await waitForResponse(bot, userId);
      expectText(response, 'Your new API key has been created');
      
      // Wait for updated API keys list
      response = await waitForResponse(bot, userId);
      expectText(response, keyName);
      expectButton(response, 'Revoke Keys');
      
      // Test revoking a key
      await bot.clickButton(userId, 'account:apikeys:revoke');
      
      // Wait for revoke options
      response = await waitForResponse(bot, userId);
      expectText(response, 'Revoke API Key');
      expectButton(response, keyName);
      
      // Select the key to revoke
      // Note: we need to use a regex pattern here since the button ID contains the dynamic key ID
      await bot.clickButtonMatching(userId, new RegExp(`account:apikeys:revoke:.+`));
      
      // Wait for confirmation
      response = await waitForResponse(bot, userId);
      expectText(response, 'API key has been revoked successfully');
    });

    test('should confirm account deletion', async () => {
      // Execute account command
      await executeCommand(bot, userId, '/account');
      
      // Click on "Delete Account" button
      await bot.clickButton(userId, 'account:delete');
      
      // Wait for confirmation view
      let response = await waitForResponse(bot, userId);
      
      // Verify delete confirmation message
      expectText(response, 'Are you sure you want to delete your account?');
      expectButton(response, 'Yes, Delete My Account');
      expectButton(response, 'Cancel');
      
      // Test cancelling deletion
      await bot.clickButton(userId, 'account:delete:cancel');
      
      // Wait for cancellation confirmation
      response = await waitForResponse(bot, userId);
      expectText(response, 'Account deletion canceled');
      
      // Should return to account menu
      response = await waitForResponse(bot, userId);
      expectText(response, 'Account Settings');
      
      // We don't actually test the final deletion step to avoid
      // cleaning up the test user before other tests run
    });
  });
}); 