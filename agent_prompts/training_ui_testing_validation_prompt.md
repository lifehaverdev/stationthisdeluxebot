# Training UI Testing & Validation - Agent Prompt

## Objective
Create comprehensive testing suite and validation procedures for the enhanced training UI to ensure all features work correctly and integrate properly with the backend.

## Context
After implementing the training UI enhancements across all three phases, thorough testing is needed to validate functionality, performance, and user experience. This includes unit tests, integration tests, and end-to-end testing.

## Files to Create/Modify
- `tests/training-ui/` (create new test directory)
- `tests/training-ui/unit/` (unit tests)
- `tests/training-ui/integration/` (integration tests)
- `tests/training-ui/e2e/` (end-to-end tests)
- `tests/training-ui/fixtures/` (test data and mocks)
- `tests/training-ui/utils/` (test utilities)

## Tasks

### 1. Unit Tests for Frontend Components (HIGH PRIORITY)
**Objective**: Test individual UI components and functions in isolation

**Implementation**:
- Test ModsMenuModal component methods
- Test form validation functions
- Test cost calculation logic
- Test WebSocket event handling
- Test utility functions

**Code Location**: `tests/training-ui/unit/ModsMenuModal.test.js`
```javascript
/**
 * Unit tests for ModsMenuModal component
 */
const ModsMenuModal = require('../../../src/platforms/web/client/src/sandbox/components/ModsMenuModal');

describe('ModsMenuModal', () => {
  let modal;
  let mockWebSocket;

  beforeEach(() => {
    mockWebSocket = {
      on: jest.fn(),
      emit: jest.fn()
    };
    
    modal = new ModsMenuModal({
      onSelect: jest.fn(),
      ws: mockWebSocket
    });
  });

  describe('Form Validation', () => {
    test('should validate training form with required fields', () => {
      const validData = {
        name: 'Test Training',
        modelType: 'SDXL',
        datasetId: '507f1f77bcf86cd799439011',
        triggerWords: 'test, training'
      };
      
      const errors = modal.validateForm(validData, 'new-training');
      expect(errors).toHaveLength(0);
    });

    test('should return errors for missing required fields', () => {
      const invalidData = {
        name: 'Test Training'
        // missing modelType, datasetId, triggerWords
      };
      
      const errors = modal.validateForm(invalidData, 'new-training');
      expect(errors).toContain('Model type is required');
      expect(errors).toContain('Dataset is required');
      expect(errors).toContain('Trigger words are required');
    });

    test('should validate steps parameter range', () => {
      const invalidData = {
        name: 'Test Training',
        modelType: 'SDXL',
        datasetId: '507f1f77bcf86cd799439011',
        triggerWords: 'test',
        steps: 50 // too low
      };
      
      const errors = modal.validateForm(invalidData, 'new-training');
      expect(errors).toContain('Steps must be between 100 and 5000');
    });
  });

  describe('Cost Calculation', () => {
    test('should calculate cost for SDXL training', async () => {
      const formData = {
        modelType: 'SDXL',
        steps: 1000,
        batchSize: 1,
        resolution: '1024,1024'
      };
      
      // Mock fetch response
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({
          success: true,
          data: {
            totalCost: 25.50,
            breakdown: {
              gpuTime: 20.00,
              storage: 3.50,
              processing: 2.00
            }
          }
        })
      });
      
      const cost = await modal.calculateTrainingCost(formData);
      expect(cost).toBe(25.50);
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/training/calculate-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
    });

    test('should handle cost calculation errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      
      const formData = { modelType: 'SDXL' };
      const cost = await modal.calculateTrainingCost(formData);
      
      expect(cost).toBe(0);
      expect(console.error).toHaveBeenCalledWith('Failed to calculate cost:', expect.any(Error));
    });
  });

  describe('WebSocket Integration', () => {
    test('should handle training status updates', () => {
      const trainingId = '507f1f77bcf86cd799439011';
      const status = 'RUNNING';
      const progress = 50;
      
      modal.updateTrainingStatus(trainingId, status, progress);
      
      const training = modal.state.trainings.find(t => t._id === trainingId);
      expect(training).toBeDefined();
      expect(training.status).toBe(status);
      expect(training.progress).toBe(progress);
    });

    test('should handle training errors', () => {
      const trainingId = '507f1f77bcf86cd799439011';
      const error = 'Training failed due to insufficient memory';
      
      modal.showTrainingError(trainingId, error);
      
      const training = modal.state.trainings.find(t => t._id === trainingId);
      expect(training).toBeDefined();
      expect(training.error).toBe(error);
      expect(training.status).toBe('FAILED');
    });
  });

  describe('Form State Management', () => {
    test('should open training form with default values', () => {
      const datasets = [
        { _id: '507f1f77bcf86cd799439011', name: 'Test Dataset' }
      ];
      
      modal.setState({ datasets });
      modal.openTrainingForm();
      
      expect(modal.state.formMode).toBe('new-training');
      expect(modal.state.formValues.datasetId).toBe('507f1f77bcf86cd799439011');
      expect(modal.state.formValues.baseModel).toBe('SDXL');
    });

    test('should open dataset form with default values', () => {
      modal.openDatasetForm();
      
      expect(modal.state.formMode).toBe('new-dataset');
      expect(modal.state.formValues.name).toBe('');
      expect(modal.state.formValues.description).toBe('');
    });
  });

  describe('Image Management', () => {
    test('should add image URLs to dataset', () => {
      const urls = 'https://example.com/image1.jpg, https://example.com/image2.jpg';
      
      modal.addImageUrls(urls);
      
      expect(modal.state.newImageUrls).toHaveLength(2);
      expect(modal.state.newImageUrls[0]).toBe('https://example.com/image1.jpg');
      expect(modal.state.newImageUrls[1]).toBe('https://example.com/image2.jpg');
    });

    test('should handle malformed image URLs', () => {
      const urls = 'invalid-url, , https://example.com/image.jpg, ';
      
      modal.addImageUrls(urls);
      
      expect(modal.state.newImageUrls).toHaveLength(1);
      expect(modal.state.newImageUrls[0]).toBe('https://example.com/image.jpg');
    });
  });
});
```

### 2. Integration Tests for API Endpoints (HIGH PRIORITY)
**Objective**: Test API endpoints and their integration with the frontend

**Implementation**:
- Test training API endpoints
- Test dataset API endpoints
- Test cost calculation API
- Test WebSocket real-time updates
- Test error handling and edge cases

**Code Location**: `tests/training-ui/integration/api.test.js`
```javascript
/**
 * Integration tests for training API endpoints
 */
const request = require('supertest');
const express = require('express');
const createTrainingsApi = require('../../../src/api/internal/trainingsApi');
const createDatasetsApi = require('../../../src/api/internal/datasetsApi');
const createCostCalculationApi = require('../../../src/api/internal/costCalculationApi');

describe('Training API Integration', () => {
  let app;
  let mockDb;
  let mockLogger;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    mockDb = {
      data: {
        trainingJobs: {
          find: jest.fn(),
          findOne: jest.fn(),
          insertOne: jest.fn(),
          updateOne: jest.fn(),
          deleteMany: jest.fn(),
          countDocuments: jest.fn()
        },
        datasets: {
          find: jest.fn(),
          findOne: jest.fn(),
          insertOne: jest.fn(),
          updateOne: jest.fn(),
          deleteMany: jest.fn(),
          countDocuments: jest.fn()
        }
      }
    };
    
    const trainingsApi = createTrainingsApi({ logger: mockLogger, db: mockDb });
    const datasetsApi = createDatasetsApi({ logger: mockLogger, db: mockDb });
    const costApi = createCostCalculationApi({ logger: mockLogger });
    
    app.use('/api/v1/trainings', trainingsApi);
    app.use('/api/v1/datasets', datasetsApi);
    app.use('/api/v1/cost', costApi);
  });

  describe('Training Endpoints', () => {
    test('POST /api/v1/trainings should create new training', async () => {
      const trainingData = {
        masterAccountId: '507f1f77bcf86cd799439011',
        name: 'Test Training',
        modelType: 'SDXL',
        datasetId: '507f1f77bcf86cd799439012',
        triggerWords: 'test, training',
        steps: 1000,
        learningRate: 0.0004
      };
      
      mockDb.data.trainingJobs.insertOne.mockResolvedValue({
        insertedId: '507f1f77bcf86cd799439013'
      });
      
      const response = await request(app)
        .post('/api/v1/trainings')
        .send(trainingData)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('_id');
      expect(mockDb.data.trainingJobs.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Training',
          modelType: 'SDXL',
          datasetId: '507f1f77bcf86cd799439012'
        })
      );
    });

    test('GET /api/v1/trainings/owner/:masterAccountId should return user trainings', async () => {
      const mockTrainings = [
        {
          _id: '507f1f77bcf86cd799439013',
          name: 'Test Training 1',
          status: 'COMPLETED',
          baseModel: 'SDXL'
        },
        {
          _id: '507f1f77bcf86cd799439014',
          name: 'Test Training 2',
          status: 'RUNNING',
          baseModel: 'FLUX'
        }
      ];
      
      mockDb.data.trainingJobs.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockTrainings)
      });
      
      const response = await request(app)
        .get('/api/v1/trainings/owner/507f1f77bcf86cd799439011')
        .expect(200);
      
      expect(response.body).toEqual(mockTrainings);
      expect(mockDb.data.trainingJobs.find).toHaveBeenCalledWith({
        ownerAccountId: '507f1f77bcf86cd799439011'
      });
    });

    test('POST /api/v1/trainings/batch-delete should delete multiple trainings', async () => {
      const deleteData = {
        ids: ['507f1f77bcf86cd799439013', '507f1f77bcf86cd799439014'],
        masterAccountId: '507f1f77bcf86cd799439011'
      };
      
      mockDb.data.trainingJobs.deleteMany.mockResolvedValue({
        deletedCount: 2
      });
      
      const response = await request(app)
        .post('/api/v1/trainings/batch-delete')
        .send(deleteData)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.deletedCount).toBe(2);
    });
  });

  describe('Dataset Endpoints', () => {
    test('POST /api/v1/datasets should create new dataset', async () => {
      const datasetData = {
        masterAccountId: '507f1f77bcf86cd799439011',
        name: 'Test Dataset',
        description: 'Test dataset description',
        tags: ['test', 'training']
      };
      
      mockDb.data.datasets.insertOne.mockResolvedValue({
        insertedId: '507f1f77bcf86cd799439015'
      });
      
      const response = await request(app)
        .post('/api/v1/datasets')
        .send(datasetData)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('_id');
    });

    test('POST /api/v1/datasets/:datasetId/images should add images to dataset', async () => {
      const imageData = {
        imageUrls: [
          'https://example.com/image1.jpg',
          'https://example.com/image2.jpg'
        ]
      };
      
      mockDb.data.datasets.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1
      });
      
      const response = await request(app)
        .post('/api/v1/datasets/507f1f77bcf86cd799439015/images')
        .send(imageData)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.addedCount).toBe(2);
    });
  });

  describe('Cost Calculation Endpoints', () => {
    test('POST /api/v1/cost/calculate-training should calculate training cost', async () => {
      const costData = {
        modelType: 'SDXL',
        steps: 1000,
        learningRate: 0.0004,
        batchSize: 1,
        resolution: '1024,1024'
      };
      
      const response = await request(app)
        .post('/api/v1/cost/calculate-training')
        .send(costData)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalCost');
      expect(response.body.data).toHaveProperty('breakdown');
      expect(response.body.data.breakdown).toHaveProperty('gpuTime');
      expect(response.body.data.breakdown).toHaveProperty('storage');
      expect(response.body.data.breakdown).toHaveProperty('processing');
    });

    test('POST /api/v1/cost/calculate-dataset should calculate dataset cost', async () => {
      const datasetCostData = {
        imageCount: 100,
        imageSize: 2, // MB
        duration: 24 // hours
      };
      
      const response = await request(app)
        .post('/api/v1/cost/calculate-dataset')
        .send(datasetCostData)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalCost');
      expect(response.body.data).toHaveProperty('breakdown');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing required fields', async () => {
      const invalidData = {
        name: 'Test Training'
        // missing required fields
      };
      
      const response = await request(app)
        .post('/api/v1/trainings')
        .send(invalidData)
        .expect(400);
      
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.message).toContain('required');
    });

    test('should handle database errors', async () => {
      mockDb.data.trainingJobs.insertOne.mockRejectedValue(new Error('Database connection failed'));
      
      const trainingData = {
        masterAccountId: '507f1f77bcf86cd799439011',
        name: 'Test Training'
      };
      
      const response = await request(app)
        .post('/api/v1/trainings')
        .send(trainingData)
        .expect(500);
      
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });
});
```

### 3. End-to-End Tests (MEDIUM PRIORITY)
**Objective**: Test complete user workflows from start to finish

**Implementation**:
- Test complete training workflow
- Test dataset creation and management
- Test cost calculation and payment flow
- Test real-time updates and notifications
- Test error recovery and edge cases

**Code Location**: `tests/training-ui/e2e/training-workflow.test.js`
```javascript
/**
 * End-to-end tests for training workflow
 */
const puppeteer = require('puppeteer');
const { setupTestServer, teardownTestServer } = require('../utils/test-server');

describe('Training Workflow E2E', () => {
  let browser;
  let page;
  let server;

  beforeAll(async () => {
    server = await setupTestServer();
    browser = await puppeteer.launch({ headless: false });
  });

  afterAll(async () => {
    await browser.close();
    await teardownTestServer(server);
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('http://localhost:3000');
  });

  afterEach(async () => {
    await page.close();
  });

  describe('Complete Training Workflow', () => {
    test('should create dataset, calculate cost, and start training', async () => {
      // Navigate to training tab
      await page.click('[data-tab="train"]');
      await page.waitForSelector('.train-dashboard');

      // Create new dataset
      await page.click('.add-dataset-btn');
      await page.waitForSelector('.dataset-form');

      await page.type('input[name="name"]', 'Test Dataset');
      await page.type('textarea[name="description"]', 'Test dataset for E2E testing');
      await page.type('textarea[name="imageUrls"]', 'https://example.com/image1.jpg\nhttps://example.com/image2.jpg');
      await page.click('.add-images-btn');

      await page.click('button[type="submit"]');
      await page.waitForSelector('.dataset-card', { timeout: 10000 });

      // Create new training
      await page.click('.add-training-btn');
      await page.waitForSelector('.train-form');

      await page.type('input[name="name"]', 'Test Training');
      await page.select('select[name="modelType"]', 'SDXL');
      await page.type('input[name="triggerWords"]', 'test, training');
      await page.type('input[name="steps"]', '1000');

      // Calculate cost
      await page.click('#calculate-cost-btn');
      await page.waitForSelector('.cost-value', { timeout: 5000 });

      const costText = await page.textContent('.cost-value');
      expect(costText).toMatch(/\d+\.\d+/);

      // Submit training
      await page.click('button[type="submit"]');
      await page.waitForSelector('.training-card', { timeout: 10000 });

      // Verify training was created
      const trainingCards = await page.$$('.training-card');
      expect(trainingCards).toHaveLength(1);

      const trainingName = await page.textContent('.training-card h4');
      expect(trainingName).toBe('Test Training');
    });

    test('should handle training progress updates', async () => {
      // Create a training (simplified for E2E)
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      await page.type('input[name="name"]', 'Progress Test Training');
      await page.select('select[name="modelType"]', 'SDXL');
      await page.type('input[name="triggerWords"]', 'test');
      
      await page.click('button[type="submit"]');
      await page.waitForSelector('.training-card');

      // Simulate progress update via WebSocket
      await page.evaluate(() => {
        if (window.websocketClient) {
          window.websocketClient.emit('trainingUpdate', {
            trainingId: 'test-training-id',
            status: 'RUNNING',
            progress: 50
          });
        }
      });

      // Wait for progress update
      await page.waitForSelector('.progress-fill[style*="50%"]', { timeout: 5000 });
    });

    test('should handle training errors gracefully', async () => {
      // Create a training
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      await page.type('input[name="name"]', 'Error Test Training');
      await page.select('select[name="modelType"]', 'SDXL');
      await page.type('input[name="triggerWords"]', 'test');
      
      await page.click('button[type="submit"]');
      await page.waitForSelector('.training-card');

      // Simulate training error
      await page.evaluate(() => {
        if (window.websocketClient) {
          window.websocketClient.emit('trainingError', {
            trainingId: 'test-training-id',
            error: 'Training failed due to insufficient memory'
          });
        }
      });

      // Wait for error state
      await page.waitForSelector('.status-failed', { timeout: 5000 });
      
      const retryButton = await page.$('.retry-training');
      expect(retryButton).toBeTruthy();
    });
  });

  describe('Dataset Management', () => {
    test('should create and manage dataset with images', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-dataset-btn');

      // Fill dataset form
      await page.type('input[name="name"]', 'E2E Test Dataset');
      await page.type('textarea[name="description"]', 'Dataset for E2E testing');
      await page.type('input[name="tags"]', 'e2e, test, dataset');
      
      // Add images
      await page.type('textarea[name="imageUrls"]', 'https://example.com/image1.jpg\nhttps://example.com/image2.jpg\nhttps://example.com/image3.jpg');
      await page.click('.add-images-btn');

      // Wait for image previews
      await page.waitForSelector('.image-preview .image-item', { timeout: 5000 });
      
      const imageItems = await page.$$('.image-preview .image-item');
      expect(imageItems).toHaveLength(3);

      // Submit dataset
      await page.click('button[type="submit"]');
      await page.waitForSelector('.dataset-card', { timeout: 10000 });

      // Verify dataset was created
      const datasetCards = await page.$$('.dataset-card');
      expect(datasetCards).toHaveLength(1);

      const datasetName = await page.textContent('.dataset-card h4');
      expect(datasetName).toBe('E2E Test Dataset');
    });

    test('should search and filter datasets', async () => {
      // Create multiple datasets first
      await page.click('[data-tab="train"]');
      
      // Create dataset 1
      await page.click('.add-dataset-btn');
      await page.type('input[name="name"]', 'Public Dataset');
      await page.select('select[name="visibility"]', 'public');
      await page.click('button[type="submit"]');
      await page.waitForSelector('.dataset-card');

      // Create dataset 2
      await page.click('.add-dataset-btn');
      await page.type('input[name="name"]', 'Private Dataset');
      await page.select('select[name="visibility"]', 'private');
      await page.click('button[type="submit"]');
      await page.waitForSelector('.dataset-card');

      // Test search
      await page.type('#dataset-search', 'Public');
      await page.waitForTimeout(500); // Wait for search debounce

      const visibleCards = await page.$$('.dataset-card:not([style*="display: none"])');
      expect(visibleCards).toHaveLength(1);

      // Test filter
      await page.select('#dataset-filter', 'private');
      await page.waitForTimeout(500);

      const privateCards = await page.$$('.dataset-card:not([style*="display: none"])');
      expect(privateCards).toHaveLength(1);
    });
  });

  describe('Cost Calculation', () => {
    test('should calculate and display training cost', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');

      // Fill training form
      await page.type('input[name="name"]', 'Cost Test Training');
      await page.select('select[name="modelType"]', 'SDXL');
      await page.type('input[name="steps"]', '2000');
      await page.type('input[name="batchSize"]', '2');
      await page.type('input[name="triggerWords"]', 'test, cost');

      // Calculate cost
      await page.click('#calculate-cost-btn');
      await page.waitForSelector('.cost-value', { timeout: 5000 });

      const costText = await page.textContent('.cost-value');
      expect(costText).toMatch(/\d+\.\d+/);

      // Verify cost breakdown
      await page.click('.cost-value');
      await page.waitForSelector('.cost-breakdown', { timeout: 1000 });

      const gpuCost = await page.textContent('#gpu-cost');
      const storageCost = await page.textContent('#storage-cost');
      const processingCost = await page.textContent('#processing-cost');

      expect(gpuCost).toMatch(/\d+\.\d+/);
      expect(storageCost).toMatch(/\d+\.\d+/);
      expect(processingCost).toMatch(/\d+\.\d+/);
    });
  });
});
```

### 4. Performance Tests (MEDIUM PRIORITY)
**Objective**: Test UI performance and responsiveness

**Implementation**:
- Test form rendering performance
- Test large dataset handling
- Test WebSocket update performance
- Test memory usage and leaks
- Test mobile responsiveness

**Code Location**: `tests/training-ui/performance/performance.test.js`
```javascript
/**
 * Performance tests for training UI
 */
const puppeteer = require('puppeteer');
const { performance } = require('perf_hooks');

describe('Training UI Performance', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('http://localhost:3000');
  });

  afterEach(async () => {
    await page.close();
  });

  describe('Form Rendering Performance', () => {
    test('should render training form within acceptable time', async () => {
      await page.click('[data-tab="train"]');
      
      const startTime = performance.now();
      await page.click('.add-training-btn');
      await page.waitForSelector('.train-form');
      const endTime = performance.now();
      
      const renderTime = endTime - startTime;
      expect(renderTime).toBeLessThan(500); // Should render within 500ms
    });

    test('should handle large dataset lists efficiently', async () => {
      // Create many datasets programmatically
      await page.evaluate(() => {
        const datasets = Array.from({ length: 100 }, (_, i) => ({
          _id: `dataset-${i}`,
          name: `Dataset ${i}`,
          images: Array.from({ length: 10 }, (_, j) => `https://example.com/image-${i}-${j}.jpg`),
          visibility: 'private'
        }));
        
        // Simulate state update
        if (window.modsMenuModal) {
          window.modsMenuModal.setState({ datasets });
          window.modsMenuModal.render();
        }
      });

      const startTime = performance.now();
      await page.waitForSelector('.datasets-grid');
      const endTime = performance.now();
      
      const renderTime = endTime - startTime;
      expect(renderTime).toBeLessThan(1000); // Should render within 1 second
    });
  });

  describe('WebSocket Performance', () => {
    test('should handle rapid status updates efficiently', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      await page.type('input[name="name"]', 'Performance Test Training');
      await page.select('select[name="modelType"]', 'SDXL');
      await page.type('input[name="triggerWords"]', 'test');
      
      await page.click('button[type="submit"]');
      await page.waitForSelector('.training-card');

      // Simulate rapid progress updates
      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        await page.evaluate((progress) => {
          if (window.websocketClient) {
            window.websocketClient.emit('trainingUpdate', {
              trainingId: 'test-training-id',
              status: 'RUNNING',
              progress: progress
            });
          }
        }, i);
        
        // Small delay to simulate real updates
        await page.waitForTimeout(10);
      }
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      expect(totalTime).toBeLessThan(5000); // Should handle 100 updates within 5 seconds
    });
  });

  describe('Memory Usage', () => {
    test('should not leak memory during extended use', async () => {
      const initialMemory = await page.metrics();
      
      // Simulate extended use
      for (let i = 0; i < 50; i++) {
        await page.click('[data-tab="train"]');
        await page.click('.add-training-btn');
        await page.click('.cancel-btn');
        
        await page.click('.add-dataset-btn');
        await page.click('.cancel-btn');
      }
      
      // Force garbage collection
      await page.evaluate(() => {
        if (window.gc) window.gc();
      });
      
      const finalMemory = await page.metrics();
      const memoryIncrease = finalMemory.JSHeapUsedSize - initialMemory.JSHeapUsedSize;
      
      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Mobile Responsiveness', () => {
    test('should render correctly on mobile devices', async () => {
      await page.setViewport({ width: 375, height: 667 }); // iPhone SE
      
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      // Check that form is responsive
      const formElement = await page.$('.train-form');
      const boundingBox = await formElement.boundingBox();
      
      expect(boundingBox.width).toBeLessThanOrEqual(375);
      
      // Check that param rows stack on mobile
      const paramRows = await page.$$('.param-row');
      for (const row of paramRows) {
        const computedStyle = await page.evaluate((el) => {
          return window.getComputedStyle(el).gridTemplateColumns;
        }, row);
        
        expect(computedStyle).toBe('1fr'); // Should be single column on mobile
      }
    });
  });
});
```

### 5. Accessibility Tests (LOW PRIORITY)
**Objective**: Ensure UI is accessible to users with disabilities

**Implementation**:
- Test keyboard navigation
- Test screen reader compatibility
- Test color contrast and visual accessibility
- Test form accessibility
- Test ARIA attributes

**Code Location**: `tests/training-ui/accessibility/accessibility.test.js`
```javascript
/**
 * Accessibility tests for training UI
 */
const puppeteer = require('puppeteer');
const axe = require('axe-core');

describe('Training UI Accessibility', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('http://localhost:3000');
  });

  afterEach(async () => {
    await page.close();
  });

  describe('WCAG Compliance', () => {
    test('should pass axe accessibility tests', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      // Inject axe-core
      await page.addScriptTag({ url: 'https://unpkg.com/axe-core@4.4.0/axe.min.js' });
      
      const results = await page.evaluate(async () => {
        return await axe.run();
      });
      
      expect(results.violations).toHaveLength(0);
    });

    test('should have proper color contrast', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      // Check color contrast for text elements
      const textElements = await page.$$('label, .cost-value, .status-badge');
      
      for (const element of textElements) {
        const contrast = await page.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const color = style.color;
          const backgroundColor = style.backgroundColor;
          
          // Simple contrast check (would need proper contrast calculation in real implementation)
          return color !== backgroundColor;
        }, element);
        
        expect(contrast).toBe(true);
      }
    });
  });

  describe('Keyboard Navigation', () => {
    test('should be navigable with keyboard only', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      // Test tab navigation
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => document.activeElement.tagName);
      expect(focusedElement).toBe('INPUT');
      
      // Test form navigation
      await page.keyboard.press('Tab');
      const secondFocusedElement = await page.evaluate(() => document.activeElement.tagName);
      expect(secondFocusedElement).toBe('SELECT');
    });

    test('should have proper focus indicators', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      // Focus on first input
      await page.focus('input[name="name"]');
      
      const focusStyle = await page.evaluate(() => {
        const focusedElement = document.activeElement;
        return window.getComputedStyle(focusedElement).outline;
      });
      
      expect(focusStyle).not.toBe('none');
    });
  });

  describe('Screen Reader Compatibility', () => {
    test('should have proper ARIA labels', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      // Check for required ARIA attributes
      const form = await page.$('.train-form');
      const ariaLabel = await page.evaluate((el) => el.getAttribute('aria-label'), form);
      expect(ariaLabel).toBeTruthy();
      
      // Check for field labels
      const labels = await page.$$('label');
      expect(labels.length).toBeGreaterThan(0);
      
      for (const label of labels) {
        const forAttr = await page.evaluate((el) => el.getAttribute('for'), label);
        const associatedInput = await page.$(`#${forAttr}`);
        expect(associatedInput).toBeTruthy();
      }
    });

    test('should announce status changes to screen readers', async () => {
      await page.click('[data-tab="train"]');
      await page.click('.add-training-btn');
      
      await page.type('input[name="name"]', 'Accessibility Test Training');
      await page.select('select[name="modelType"]', 'SDXL');
      await page.type('input[name="triggerWords"]', 'test');
      
      await page.click('button[type="submit"]');
      await page.waitForSelector('.training-card');
      
      // Check for status announcement
      const statusElement = await page.$('.status-badge');
      const ariaLive = await page.evaluate((el) => el.getAttribute('aria-live'), statusElement);
      expect(ariaLive).toBe('polite');
    });
  });
});
```

## Success Criteria
- [ ] Comprehensive unit test coverage (>90%)
- [ ] All API endpoints tested with various scenarios
- [ ] Complete E2E workflows tested
- [ ] Performance benchmarks met
- [ ] Accessibility compliance verified
- [ ] Error handling and edge cases covered
- [ ] Mobile responsiveness validated

## Testing Strategy
1. **Unit Tests**: Test individual components and functions
2. **Integration Tests**: Test API endpoints and data flow
3. **E2E Tests**: Test complete user workflows
4. **Performance Tests**: Test rendering and responsiveness
5. **Accessibility Tests**: Test WCAG compliance and usability

## Notes
- Use Jest for unit and integration tests
- Use Puppeteer for E2E and performance tests
- Use axe-core for accessibility testing
- Mock external dependencies and APIs
- Test both success and failure scenarios
- Include performance benchmarks and thresholds
- Test on multiple devices and browsers
