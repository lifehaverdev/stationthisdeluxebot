/**
 * Guest Authentication Middleware
 * 
 * Middleware that supports both regular user authentication and guest authentication.
 * Tries regular auth first, then falls back to guest token if available.
 */

const { createLogger } = require('../../../utils/logger');
const logger = createLogger('GuestAuthMiddleware');

/**
 * Create middleware that authenticates either regular users or guests
 * @param {GuestAuthService} guestAuthService - Instance of GuestAuthService
 * @returns {Function} Express middleware
 */
function authenticateGuestOrUser(guestAuthService) {
  return async (req, res, next) => {
    // Try regular authentication first
    if (req.user && req.user.userId) {
      return next();
    }

    // Try guest token
    const guestToken = req.headers['x-guest-token'] || req.cookies?.guestToken;
    if (guestToken) {
      try {
        const user = await guestAuthService.verifyGuestToken(guestToken);
        req.user = {
          userId: user._id.toString(),
          isGuest: true
        };
        req.guestUser = user;
        logger.debug(`[GuestAuthMiddleware] Authenticated guest user ${user._id}`);
        return next();
      } catch (error) {
        logger.warn(`[GuestAuthMiddleware] Guest token verification failed: ${error.message}`);
        // Fall through to 401
      }
    }

    // No valid authentication
    if (req.accepts('html')) {
      return res.redirect('/landing');
    }
    return res.status(401).json({ 
      error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } 
    });
  };
}

module.exports = { authenticateGuestOrUser };

