/**
 * Status API Demo Script
 * 
 * Standalone script to demonstrate the status API
 */

const express = require('express');
const createStatusRoutes = require('../src/platforms/web/routes/api/status');
const { initializeAPI } = require('../src/api');

// Create Express app
const app = express();

// Initialize API services
console.log('Initializing API services...');
const startTime = new Date();
const apiServices = initializeAPI({
  appStartTime: startTime,
  version: '1.0.0-demo'
});

// Create services object (normally this would include other core services)
const services = {
  internal: apiServices.internal
};

// Mount status routes
app.use('/api/status', createStatusRoutes(services));

// Add API documentation endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'StationThis Status API Demo',
    version: '1.0.0-demo',
    endpoints: [
      { path: '/api/status', description: 'Application status information' },
      { path: '/api/status/health', description: 'Health check endpoint' }
    ]
  });
});

// Start the server
const port = process.env.DEMO_PORT || 4001;
app.listen(port, () => {
  console.log(`Status API demo server running at http://localhost:${port}`);
  console.log(`Try these commands in another terminal window:`);
  console.log(`  curl http://localhost:${port}/api/status`);
  console.log(`  curl http://localhost:${port}/api/status/health`);
  console.log('\nPress Ctrl+C to stop the server');
}); 