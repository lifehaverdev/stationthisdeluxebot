const { createSessionAdapter } = require('../adapters/sessionAdapter');
const { createSessionManager } = require('../services/sessionManager');
const { createAnalyticsService } = require('../services/analyticsService');
const { createReportGenerator } = require('../services/reportGenerator');

/**
 * Example demonstrating how to integrate SessionAdapter with other components
 */
async function runIntegrationExample() {
  try {
    // Initialize core services
    const sessionManager = createSessionManager({
      // Configure with your database connection
      databaseUrl: process.env.DATABASE_URL
    });

    // Create the session adapter
    const sessionAdapter = createSessionAdapter({
      sessionManager
    });

    // Create other dependent services that use the session adapter
    const analyticsService = createAnalyticsService({
      sessionAdapter,
      // Add other dependencies as needed
    });

    const reportGenerator = createReportGenerator({
      analyticsService,
      // Add other dependencies as needed
    });

    // Example: Generate a weekly report
    const weeklyReport = await reportGenerator.generateWeeklyReport({
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      endDate: new Date()
    });

    console.log('Generated weekly report:');
    console.log('- Total users:', weeklyReport.totalUsers);
    console.log('- New users:', weeklyReport.newUsers);
    console.log('- Active users:', weeklyReport.activeUsers);
    console.log('- Top user locations:', weeklyReport.topLocations);

    // Example: Get real-time analytics for a specific user
    const userId = '123456789';
    const userAnalytics = await analyticsService.getUserInsights(userId);
    
    console.log(`\nUser insights for ${userId}:`);
    console.log('- Session count:', userAnalytics.sessionCount);
    console.log('- Average session duration:', userAnalytics.avgSessionDuration);
    console.log('- Most used features:', userAnalytics.topFeatures);

  } catch (error) {
    console.error('Error in integration example:', error);
  }
}

module.exports = { runIntegrationExample }; 