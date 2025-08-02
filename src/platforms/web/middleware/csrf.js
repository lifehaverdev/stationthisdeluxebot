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

// List of public-facing auth endpoints to exclude from CSRF protection
const csrfExcluded = [
  '/api/v1/auth/web3/nonce',
  '/api/v1/auth/web3/verify',
  '/api/v1/auth/password',
  '/api/v1/auth/apikey',
  '/api/v1/auth/refresh',
  '/api/v1/auth/register', // Add registration if/when implemented
  '/internal/',// Add more as needed
  '/api/v1/webhook/alchemy',
  '/api/v1/webhook/comfydeploy',
  '/api/v1/points/supported-assets',
];

// Helper: robust path matching (ignores query params, matches prefix)
function isCsrfExcluded(url) {
  return csrfExcluded.some(excluded => url.startsWith(excluded));
}

// Create the csurf middleware instance
const csrf = csurf({ cookie: true, ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });

// Exported middleware
function csrfProtection(req, res, next) {
    console.log('[CSRF]', req.method, req.originalUrl, 'excluded:', isCsrfExcluded(req.originalUrl));
  if (isCsrfExcluded(req.originalUrl)) return next();
  return csrf(req, res, next);
}

module.exports = csrfProtection; 