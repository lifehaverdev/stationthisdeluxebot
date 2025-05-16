/**
 * Status API Test
 * 
 * Tests for the status API endpoints
 */

const request = require('supertest');
const express = require('express');
const assert = require('assert');
const createStatusRoutes = require('../../src/platforms/web/routes/api/status');
const { initializeAPI } = require('../../src/api');

describe('Status API Endpoints', () => {
  let app;
  let services;
  
  beforeEach(() => {
    // Initialize Express app
    app = express();
    
    // Setup services with mock data
    const appStartTime = new Date();
    const apiServices = initializeAPI({
      appStartTime,
      version: '1.0.0-test'
    });
    
    services = {
      internal: apiServices.internal
    };
    
    // Mount status routes
    app.use('/api/status', createStatusRoutes(services));
  });
  
  it('should return status information', async () => {
    const response = await request(app).get('/api/status');
    
    // Response should be successful
    assert.strictEqual(response.status, 200);
    
    // Response should have expected structure
    assert.strictEqual(response.body.status, 'ok');
    assert.ok(response.body.uptime);
    assert.ok(response.body.uptime.formatted);
    assert.ok(response.body.uptime.ms >= 0);
    assert.ok(response.body.startTime);
    assert.strictEqual(response.body.version, '1.0.0-test');
  });
  
  it('should return health check response', async () => {
    const response = await request(app).get('/api/status/health');
    
    // Response should be successful
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'ok');
  });
});

// If running directly
if (require.main === module) {
  const apiServices = initializeAPI({
    appStartTime: new Date(),
    version: '1.0.0-test'
  });
  
  const services = {
    internal: apiServices.internal
  };
  
  const app = express();
  app.use('/api/status', createStatusRoutes(services));
  
  const port = process.env.TEST_PORT || 4001;
  app.listen(port, () => {
    console.log(`Test server running on http://localhost:${port}`);
    console.log(`Try: curl http://localhost:${port}/api/status`);
  });
} 