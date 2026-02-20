/**
 * Web Platform Authentication Middleware
 * 
 * Middleware functions for handling authentication
 */

const jwt = require('jsonwebtoken');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('AuthMiddleware');

/**
 * Middleware to authenticate user based on JWT token
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
function authenticateUser(req, res, next) {
  // Public read-only route: allow anonymous GET to /api/v1/workspaces/:slug
  if (req.method === 'GET' && /^\/(api\/v1\/)?workspaces\/[\w-]+$/.test(req.originalUrl)) {
    return next();
  }
  try {
    // Prefer JWT from HTTP-only cookie
    let token = req.cookies && req.cookies.jwt;

    // Fallback: If not present in cookie, check Authorization header (for API clients)
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      // For web pages, redirect to login. For API calls, send 401.
      if (req.accepts('html')) {
        const loginUrl = process.env.NODE_ENV === 'production' ? 'https://noema.art' : '/landing';
        return res.redirect(loginUrl);
      }
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided.' } });
    }

    // Verify the token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not defined in environment variables.');
      return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
    }

    jwt.verify(token, jwtSecret, (err, user) => {
      if (err) {
        if (req.accepts('html')) {
          const loginUrl = process.env.NODE_ENV === 'production' ? 'https://noema.art' : '/landing';
          return res.redirect(loginUrl);
        }
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid token.' } });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    console.error('Authentication error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Optional authentication middleware
 * Will authenticate if token is present, but won't fail if it's not
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
function optionalAuth(req, res, next) {
  try {
    // Get authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token, but that's fine for optional auth
      return next();
    }
    
    // Extract the token
    const token = authHeader.split(' ')[1];
    
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET is not defined; optionalAuth cannot verify token.');
      return next();
    }
    // Verify the token
    const decoded = jwt.verify(token, jwtSecret);
    
    // Add user info to request
    req.user = {
      id: decoded.id
    };
    
    next();
  } catch (error) {
    // Even if token verification fails, we proceed without authentication
    next();
  }
}

/**
 * Middleware to authenticate internal service-to-service requests.
 * Checks for a valid X-Internal-Client-Key header.
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
function requireInternal(req, res, next) {
    const clientKey = req.headers['x-internal-client-key'];

    if (!clientKey) {
        return res.status(401).json({ error: 'Missing X-Internal-Client-Key header.' });
    }

    const validKeys = [
        process.env.INTERNAL_API_KEY_SYSTEM,
        process.env.INTERNAL_API_KEY_GENERAL,
        process.env.INTERNAL_API_KEY_TELEGRAM,
        process.env.INTERNAL_API_KEY_DISCORD,
        process.env.INTERNAL_API_KEY_WEB,
        process.env.INTERNAL_API_KEY_API,
        process.env.INTERNAL_API_KEY_ADMIN,
    ].filter(key => key);

    if (!validKeys.includes(clientKey)) {
        return res.status(403).json({ error: 'Invalid API key provided.' });
    }

    next();
}

/**
 * Middleware to authenticate user via JWT/session or API key (X-API-Key header)
 * If both are present, JWT/session takes precedence.
 */
async function authenticateUserOrApiKey(req, res, next) {
  // Public read-only access for workspace snapshots
  if (req.method === 'GET' && /^\/(api\/v1\/)?workspaces\/[\w-]+$/.test(req.originalUrl)) {
    return next();
  }
  // 1. Try JWT/session auth first
  try {
    let token = req.cookies && req.cookies.jwt;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }
    if (token) {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        logger.error('JWT_SECRET is not defined in environment variables.');
        return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error.' } });
      }
      return jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid token.' } });
        }
        req.user = user;
        console.log('[AuthMiddleware] JWT Verified. req.user set to:', req.user); // DEBUG LOG
        req.authMethod = 'jwt';
        return next();
      });
    }
  } catch (err) {
    // Ignore and fall through to API key
  }
  // 2. Try API key auth
  const apiKey = req.get('X-API-Key');
  if (apiKey) {
    try {
      // Validate API key via internal API
      const internalApiClient = require('../../../utils/internalApiClient');
      internalApiClient.post('/internal/v1/data/auth/validate-key', { apiKey })
        .then(response => {
          req.user = response.data.user;
          req.apiKey = response.data.apiKey;
          req.authMethod = 'apiKey';
          next();
        })
        .catch(error => {
          logger.error('API key authentication failed:', error.message);
          return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key.' } });
        });
      return;
    } catch (error) {
      logger.error('API key authentication error:', error.message);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'API key authentication error.' } });
    }
  }
  // 3. If neither, reject
  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
}

module.exports = {
  authenticateUser,
  optionalAuth,
  authenticateToken: authenticateUser, // Alias for backward compatibility
  requireInternal,
  authenticateUserOrApiKey, // Export new middleware
}; 
