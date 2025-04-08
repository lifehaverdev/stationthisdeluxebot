const { createSessionAdapter } = require('../adapters/sessionAdapter');
const { createSessionManager } = require('../services/sessionManager');

/**
 * Example demonstrating how to use SessionAdapter
 */
async function sessionAdapterExample() {
  try {
    // Initialize the session manager (would typically connect to your database)
    const sessionManager = createSessionManager({
      // Add your database connection or other dependencies here
    });

    // Create the session adapter with the session manager
    const sessionAdapter = createSessionAdapter({
      sessionManager
    });

    // Example user ID 
    const userId = '123456789';

    // Retrieve analytics data for a user
    const userData = await sessionAdapter.getUserAnalyticsData(userId);
    
    if (userData) {
      console.log('Retrieved user analytics data:');
      console.log('- Joined chats:', userData.joinedChats);
      console.log('- Verification status:', userData.verificationStatus);
      console.log('- Recent actions:', userData.actions);
    } else {
      console.log(`No analytics data found for user ${userId}`);
    }

    // Example usage of getUserSessionsAnalyticsData for reporting
    const allSessions = await sessionAdapter.getUserSessionsAnalyticsData();
    console.log(`Retrieved data for ${allSessions.length} user sessions`);
    
    // You can now process this data for analytics reporting
    const verifiedUsers = allSessions.filter(session => 
      session.verificationStatus && session.verificationStatus.verified
    );
    
    console.log(`Total verified users: ${verifiedUsers.length}`);
    
  } catch (error) {
    console.error('Error in session adapter example:', error);
  }
}

module.exports = { sessionAdapterExample }; 