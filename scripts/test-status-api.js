/**
 * Test Script for Status API
 * 
 * Tests the internal status API and its integration with platforms
 */

// Simulate the app startup process but with debugging
const { initializeServices } = require('../src/core/services');
const { initializePlatforms } = require('../src/platforms');

async function testStatusAPI() {
  console.log('Starting test for Status API integration...');
  
  // Initialize core services
  console.log('Initializing core services...');
  const services = await initializeServices({ logger: console });
  
  // Verify internal API is available
  console.log('\nVerifying internal API:');
  console.log('- Internal services exist:', services.internal ? 'Yes' : 'No');
  
  if (services.internal && services.internal.status) {
    // Test status API directly
    console.log('\nTesting status API directly:');
    const statusInfo = services.internal.status.getStatus();
    console.log('Status info:', statusInfo);
  } else {
    console.error('ERROR: Internal status API is not available');
    process.exit(1);
  }
  
  // Create a platform services object similar to app.js
  console.log('\nCreating platform services object...');
  const platformServices = {
    comfyuiService: services.comfyUI,
    pointsService: services.points,
    sessionService: services.session,
    workflowsService: services.workflows,
    mediaService: services.media,
    logger: console,
    appStartTime: new Date(),
    db: services.db,
    // Add internal API services
    internal: services.internal
  };
  
  // Initialize platforms with minimal options for testing
  console.log('\nInitializing platforms...');
  const platforms = initializePlatforms(platformServices, {
    enableTelegram: false,
    enableDiscord: false,
    enableWeb: false
  });
  
  console.log('\nStatus API test completed successfully!');
}

// Run the test
testStatusAPI().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
}); 