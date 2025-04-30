/**
 * Web Platform Routes
 * 
 * Initializes all routes for the web platform
 */

const authRoutes = require('./authRoutes');
const collectionsRoutes = require('./collectionsRoutes');
const shareRoutes = require('./shareRoutes');
const workflowsRoutes = require('./api/workflows');
const pointsRoutes = require('./api/points');
const pipelinesRoutes = require('./api/pipelines');

/**
 * Initialize all routes for the web platform
 * @param {Express} app - Express application instance
 * @param {Object} services - Core services
 */
function initializeRoutes(app, services) {
  // Mount API routes
  app.use('/api/auth', authRoutes(services));
  app.use('/api/collections', collectionsRoutes(services));
  app.use('/api/share', shareRoutes(services));
  app.use('/api/workflows', workflowsRoutes(services));
  app.use('/api/points', pointsRoutes(services));
  app.use('/api/pipelines', pipelinesRoutes);
  
  // Health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  
  // API documentation
  app.get('/api', (req, res) => {
    res.status(200).json({
      name: 'StationThis API',
      version: '1.0.0',
      endpoints: [
        { path: '/api/auth', description: 'Authentication endpoints' },
        { path: '/api/collections', description: 'Collection management' },
        { path: '/api/share', description: 'Collection sharing' },
        { path: '/api/workflows', description: 'Workflow execution and configuration' },
        { path: '/api/points', description: 'Point balance and transactions' },
        { path: '/api/pipelines', description: 'Pipeline templates and execution' }
      ]
    });
  });
}

module.exports = {
  initializeRoutes
}; 