/**
 * Web Platform Authentication Middleware
 * 
 * Middleware functions for handling authentication
 */

const jwt = require('jsonwebtoken');

/**
 * Middleware to authenticate user based on JWT token
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
function authenticateUser(req, res, next) {
  try {
    // Get authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    
    // Extract the token
    const token = authHeader.split(' ')[1];
    
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'stationthis-jwt-secret');
    
    // Add user info to request
    req.user = {
      id: decoded.id
    };
    
    next();
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
    
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'stationthis-jwt-secret');
    
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

module.exports = {
  authenticateUser,
  optionalAuth,
  authenticateToken: authenticateUser, // Alias for backward compatibility
  requireInternal,
}; 