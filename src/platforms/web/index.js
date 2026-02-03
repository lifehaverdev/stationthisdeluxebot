// require('dotenv').config();
/**
 * Web Platform Entry Point
 *
 * Initializes the web platform adapter and configures Express routes
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const httpLogger = require('../../utils/pino'); // Import the centralized pino-http logger
const fs = require('fs');
const { createLogger } = require('../../utils/logger');
const { authenticateUser } = require('./middleware/auth');
const csrfProtection = require('./middleware/csrf'); // <-- Import new CSRF middleware
const { referralHandler } = require('./middleware/referralHandler');
const { createAgentCardRouter } = require('../../api/external/mcp/agentCard');

// Add this function before middleware setup
function rawBodySaver(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}

/**
 * Initialize the web platform
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Web platform instance
 */
function initializeWebPlatform(services, options = {}) {
  const app = express();
  const logger = services.logger || console; // Get logger from services, fallback to console
  const publicPath = path.join(__dirname, '..', '..', '..', 'public');
  const maintenancePagePath = process.env.MAINTENANCE_MODE_PAGE
    ? path.resolve(process.env.MAINTENANCE_MODE_PAGE)
    : path.join(publicPath, 'maintenance.html');
  const maintenanceFlagPath = process.env.MAINTENANCE_MODE_FILE
    ? path.resolve(process.env.MAINTENANCE_MODE_FILE)
    : path.join('/var', 'run', 'hyperbot', 'maintenance.flag');

  // Trust the first proxy in front of the app.
  app.set('trust proxy', 1);

  // Set up middleware
  logger.info('[WebPlatform] Initializing middleware...');
  app.use(httpLogger); // Use the centralized, correctly configured HTTP logger
  app.use(cors({
    origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:4000'],
    credentials: true
  }));
  app.use(express.json({ verify: rawBodySaver }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  const maintenanceBypassPaths = new Set([
    '/api/health',
    '/health',
  ]);

  const isMaintenanceEnabled = () => {
    if (process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true') {
      return true;
    }
    try {
      return fs.existsSync(maintenanceFlagPath);
    } catch (err) {
      logger.warn('[WebPlatform] Unable to read maintenance flag', err);
      return false;
    }
    return false;
  };

  app.use((req, res, next) => {
    if (!isMaintenanceEnabled() || maintenanceBypassPaths.has(req.path)) {
      return next();
    }

    const message = process.env.MAINTENANCE_MODE_MESSAGE
      || 'StationThis is undergoing scheduled maintenance. Please try again shortly.';

    res.set('Retry-After', process.env.MAINTENANCE_RETRY_AFTER || '120');

    if (req.accepts('html') && fs.existsSync(maintenancePagePath)) {
      return res.status(503).sendFile(maintenancePagePath);
    }

    return res.status(503).json({
      error: 'maintenance',
      message
    });
  });

  // --- Referral Handler ---
  app.use(referralHandler);

  // --- CSRF Protection ---
  app.use(csrfProtection); // Use centralized CSRF middleware

  // Endpoint to provide CSRF token to frontend
  app.get('/api/v1/csrf-token', (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  return {
    app,
    initializeRoutes: async () => {
      // --- Page Routes ---
      // Allow anonymous access to sandbox when ?workspace=<id>
      app.get('/', (req, res, next) => {
        if (req.query.workspace) {
          return res.sendFile(path.join(__dirname, 'client', 'index.html'));
        }
        return next();
      });

      app.get('/', authenticateUser, (req, res) => {
        // Auth middleware has run, so if we're here, the user is authenticated.
        res.sendFile(path.join(__dirname, 'client', 'index.html'));
      });

      app.get('/logout', (req, res) => {
          // Clear the JWT cookie to log the user out
          res.clearCookie('jwt', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
          });
          res.redirect('/landing');
      });

      app.get('/landing', (req, res) => {
        res.sendFile(path.join(publicPath, 'landing.html'));
      });

      app.get('/pricing', (req, res) => {
        res.sendFile(path.join(publicPath, 'pricing.html'));
      });

      app.get('/docs', (req, res) => {
        res.sendFile(path.join(publicPath, 'docs.html'));
      });

      app.get('/admin', (req, res) => {
        res.sendFile(path.join(publicPath, 'admin.html'));
      });

      // Spell Execution Page
      app.get('/spells/:slug', (req, res) => {
        res.sendFile(path.join(publicPath, 'spell.html'));
      });

      // Health check
      app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok' });
      });

      // ERC-8004 Agent Card (/.well-known/agent-card.json)
      const agentCardRouter = createAgentCardRouter({
        toolRegistry: services.toolRegistry,
        internalApiClient: services.internalApiClient
      });
      if (agentCardRouter) {
        app.use('/.well-known/agent-card.json', agentCardRouter);
        logger.info('[WebPlatform] Agent card mounted at /.well-known/agent-card.json');
      }

      // --- Static File Serving ---
      const clientDir = path.join(__dirname, 'client');
      const clientDist = path.join(clientDir, 'dist');
      const clientSrc = path.join(clientDir, 'src');

      // Serve static files from the client/dist directory first (production bundle only)
      app.use(express.static(clientDist));

      // Serve sandbox source modules (ESM bundle is not built yet)
      app.use('/sandbox', express.static(path.join(clientSrc, 'sandbox')));
      app.get('/index.css', (req, res) => res.sendFile(path.join(clientSrc, 'index.css')));

      // Then serve assets from the public directory (images, landing pages, etc.)
      app.use(express.static(publicPath));
      
      // Then serve from the regular static path if specified
      if (options.staticPath) {
        app.use(express.static(options.staticPath));
      }

      // Handle SPA routing - return main app's index.html for all other routes
      app.get('*', (req, res) => {
        if (req.accepts('html')) {
          const clientIndexPath = path.join(__dirname, 'client', 'dist', 'index.html');
          if (fs.existsSync(clientIndexPath)) {
            res.sendFile(clientIndexPath);
          } else {
            // If the main app doesn't exist, we don't have a good fallback for SPA routes.
            // Sending a 404 is more appropriate than sending an unrelated file.
            res.status(404).send('Application not found.');
          }
        } else {
          res.status(404).json({ error: 'Not found' });
        }
      });

      logger.info('[WebPlatform] Routes initialized.');
    },
    start: (port = 3000) => {
      return new Promise((resolve) => {
        const server = app.listen(port, () => {
          logger.info(`Web platform running on port ${port}`); // Use logger here
          resolve(server);
        });
      });
    }
  };
}

module.exports = {
  initializeWebPlatform
};
