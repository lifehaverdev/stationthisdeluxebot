const { createAnalyticsService } = require('../core/analytics');
const { createSessionAdapter } = require('../adapters/sessionAdapter');
const SessionManager = require('../core/session/sessionManager'); // Assuming this exists

/**
 * Example demonstrating how to use the AnalyticsService
 */
async function analyticsExample() {
  // Create dependencies
  const sessionManager = new SessionManager();
  const sessionAdapter = createSessionAdapter({ sessionManager });
  
  // Create analytics service with session adapter
  const analyticsService = createAnalyticsService({ 
    sessionAdapter 
  });
  
  // Example tracking events
  const userId = '123456789';
  const chatId = '-100123456789';
  const actionData = { reason: 'suspicious activity' };
  
  try {
    // Track user join event
    await analyticsService.trackUserJoin(userId, chatId);
    console.log(`Tracked user join for ${userId} in chat ${chatId}`);
    
    // Track verification event
    await analyticsService.trackVerification(userId, chatId, true);
    console.log(`Tracked verification for ${userId} in chat ${chatId}`);
    
    // Track gatekeeping event
    await analyticsService.trackGatekeep(userId, chatId, true);
    console.log(`Tracked gatekeeping for ${userId} in chat ${chatId}`);
    
    // Track account action
    await analyticsService.trackAccountAction(userId, 'banned', actionData);
    console.log(`Tracked account action: banned for ${userId}`);
  } catch (error) {
    console.error('Error tracking analytics:', error);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  analyticsExample().catch(console.error);
}

module.exports = { analyticsExample }; 