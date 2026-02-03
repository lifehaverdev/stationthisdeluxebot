/**
 * CSRF Protection Middleware
 *
 * Applies CSRF protection to all state-changing requests (POST, PUT, DELETE, PATCH),
 * except for public authentication endpoints that must be accessible before login/session.
 *
 * To add new public auth endpoints, update the `csrfExcluded` array below.
 *
 * Internal API endpoints are not affected, as they are not exposed to the browser.
 */

const csurf = require('csurf');
const { createLogger } = require('../../../utils/logger');
const csrfLogger = createLogger('csrf');

// List of public-facing auth endpoints to exclude from CSRF protection
// Also excludes API key-authenticated routes (admin, etc.) since CSRF only applies to session-based auth
// NOTE: /api/v1/csrf-token is NOT excluded - it needs the CSRF middleware to run (even though GET is ignored)
// so that req.csrfToken() is available. GET requests are already ignored by csurf.
const csrfExcluded = [
  '/api/v1/auth/web3/nonce',
  '/api/v1/auth/web3/verify',
  '/api/v1/auth/password',
  '/api/v1/auth/apikey',
  '/api/v1/auth/ensure-user',
  '/api/v1/auth/refresh',
  '/api/v1/auth/register', // Add registration if/when implemented
  '/internal/', // Internal API routes (server-to-server, use API keys)
  '/api/v1/admin', // Admin routes use API key authentication, not session-based
  '/api/v1/webhook/alchemy',
  '/api/v1/webhook/comfydeploy',
  '/api/v1/points/supported-assets',
  '/api/v1/upload/', // Upload API endpoints for training datasets
  '/api/v1/payments/', // Public payment endpoints for spell execution
  '/api/v1/mcp', // MCP protocol - discovery is public, execution uses API key auth
  '/api/v1/x402/', // x402 payment protocol - uses payment header auth, not session
];

// Helper: robust path matching (ignores query params, matches prefix)
function isCsrfExcluded(url = '') {
  return csrfExcluded.some(excluded => url.startsWith(excluded));
}

// Requests that authenticate via explicit headers (API keys, bearer tokens) are not
// vulnerable to CSRF because browsers cannot attach these headers automatically.
function isExplicitlyAuthenticated(req) {
  if (!req || !req.headers) return false;
  if (req.headers['x-api-key']) return true;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return true;
  }
  return false;
}

// Create the csurf middleware instance
const csrf = csurf({ cookie: true, ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

// Exported middleware
function csrfProtection(req, res, next) {
    // Removed verbose console logging to reduce noise; enable only when LOG_LEVEL=debug.
    /*
    if (process.env.LOG_LEVEL === 'debug') {
      // eslint-disable-next-line no-console
      console.debug('[CSRF]', req.method, req.originalUrl, 'excluded:', isCsrfExcluded(req.originalUrl));
    }
    */
  if (isCsrfExcluded(req.originalUrl) || isExplicitlyAuthenticated(req)) return next();
  
  // Wrap CSRF error handling to provide better error messages
  return csrf(req, res, (err) => {
    if (err && err.code === 'EBADCSRFTOKEN') {
      const headerToken = req.headers['x-csrf-token'] ? 'present' : 'missing';
      csrfLogger.warn('[CSRF] Invalid token', {
        method: req.method,
        url: req.originalUrl,
        userId: req.user?.userId || req.user?.id || 'anonymous',
        remoteAddress: req.ip,
        headerToken
      });
      return res.status(403).json({
        error: {
          code: 'CSRF_TOKEN_INVALID',
          message: 'Invalid CSRF token. Please refresh the page and try again.'
        }
      });
    }
    return next(err);
  });
}

module.exports = csrfProtection; 
