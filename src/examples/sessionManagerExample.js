/**
 * SessionManager Example
 * 
 * This example demonstrates how to use the SessionManager to handle user session data
 * in a simplified way while leveraging the core session system underneath.
 */

const { createSessionManager } = require('../services/sessionManager');
const { ErrorHandler } = require('../core/shared/errors');

/**
 * Run the session manager example
 */
async function runSessionManagerExample() {
  console.log('Starting SessionManager example...');
  
  // Create a sample lobby for demonstration purposes
  const sampleLobby = {
    'user123': {
      name: 'Alice',
      points: 100,
      preferences: { theme: 'dark' }
    },
    'user456': {
      name: 'Bob',
      points: 50,
      preferences: { theme: 'light' }
    }
  };
  
  // Create error handler
  const errorHandler = new ErrorHandler();
  
  // Create session manager with the sample lobby and default values
  const sessionManager = createSessionManager({
    legacyLobby: sampleLobby,
    defaults: {
      points: 0,
      preferences: {
        theme: 'system',
        notifications: true
      }
    }
  });
  
  // Set up error handling
  sessionManager.on('error', (error) => {
    const appError = errorHandler.handleError(error, {
      component: 'SessionManager',
      operation: 'example'
    });
    
    console.error(`Session error: ${appError.message}`);
  });
  
  try {
    // Example 1: Get existing user data from legacy lobby
    console.log('\n--- Example 1: Get existing user data ---');
    const aliceData = await sessionManager.getUserData('user123');
    console.log('Alice data:', aliceData);
    
    // Example 2: Create a new user session
    console.log('\n--- Example 2: Create a new user session ---');
    const charlieData = await sessionManager.createUserSession('user789', {
      name: 'Charlie',
      points: 75
    });
    console.log('Charlie data:', charlieData);
    
    // Example 3: Update user data
    console.log('\n--- Example 3: Update user data ---');
    const updatedAlice = await sessionManager.updateUserData('user123', {
      points: 150,
      recentAchievement: 'Completed tutorial'
    });
    console.log('Updated Alice data:', updatedAlice);
    
    // Example 4: Check if users have sessions
    console.log('\n--- Example 4: Check session existence ---');
    const aliceHasSession = await sessionManager.hasUserSession('user123');
    const unknownHasSession = await sessionManager.hasUserSession('unknown');
    console.log('Alice has session:', aliceHasSession);
    console.log('Unknown user has session:', unknownHasSession);
    
    // Example 5: Create web session with API key
    console.log('\n--- Example 5: Create web session with API key ---');
    const webSession = await sessionManager.createWebSession('user456');
    console.log('Web session created with API key:', webSession.apiKey.substring(0, 8) + '...');
    
    // Example 6: List all sessions
    console.log('\n--- Example 6: List all sessions ---');
    const allSessions = await sessionManager.getAllSessions();
    console.log(`Found ${allSessions.length} active sessions`);
    console.log('Session user IDs:', allSessions.map(s => s.userId));
    
    // Example 7: Get metrics
    console.log('\n--- Example 7: Performance metrics ---');
    const metrics = sessionManager.getMetrics();
    console.log('Session operations metrics:', metrics);
    
    // Example 8: Clean up
    console.log('\n--- Example 8: Clean up ---');
    await sessionManager.deleteUserSession('user789');
    const remainingSessions = await sessionManager.getSessionCount();
    console.log(`Remaining sessions after deletion: ${remainingSessions}`);
    
    console.log('\nSessionManager example completed successfully!');
  } catch (error) {
    const appError = errorHandler.handleError(error, {
      component: 'SessionManager',
      operation: 'example'
    });
    
    console.error(`Example failed: ${appError.message}`);
  }
}

module.exports = { runSessionManagerExample }; 