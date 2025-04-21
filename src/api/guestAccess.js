/**
 * Guest Access Service
 * 
 * Provides functionality for managing guest access to generation workflows
 * with a limited number of requests per session.
 */

const { v4: uuidv4 } = require('uuid');
const { Logger } = require('../utils/logger');
const { AppError } = require('../core/shared/errors/AppError');

const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'guestAccess'
});

// Constants
const GUEST_REQUEST_LIMIT = 3;
const GUEST_PREFIX = 'guest_';

/**
 * Check if a user is a guest user
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if user is a guest
 */
function isGuestUser(userId) {
  return userId && userId.startsWith(GUEST_PREFIX);
}

/**
 * Generate a new guest user ID
 * @returns {string} - Generated guest user ID
 */
function generateGuestId() {
  return `${GUEST_PREFIX}${uuidv4()}`;
}

/**
 * Guest Access Service
 * Manages guest access to generation workflows
 */
class GuestAccessService {
  /**
   * Create a new GuestAccessService
   * @param {Object} options - Service options
   * @param {Object} options.sessionManager - Session manager instance
   * @param {Object} options.workflowManager - Workflow manager instance
   */
  constructor({ sessionManager, workflowManager }) {
    this.sessionManager = sessionManager;
    this.workflowManager = workflowManager;
    
    // Validate required dependencies
    if (!sessionManager) {
      throw new Error('Session manager is required for GuestAccessService');
    }
    
    logger.info('GuestAccessService initialized');
  }

  /**
   * Create a new guest session
   * @returns {Promise<Object>} - Guest session data
   */
  async createGuestSession() {
    try {
      // Generate guest ID
      const guestId = generateGuestId();
      
      // Create guest session
      const guestSession = {
        userId: guestId,
        isGuest: true,
        createdAt: Date.now(),
        requestsRemaining: GUEST_REQUEST_LIMIT,
        requestsUsed: 0,
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      };
      
      // Store session in session manager
      await this.sessionManager.createSession(guestId, guestSession);
      
      logger.info('Created guest session', { guestId });
      
      return {
        userId: guestId,
        apiKey: guestId, // Use the guest ID as the API key for simplicity
        session: guestSession
      };
    } catch (error) {
      logger.error('Failed to create guest session', { error });
      throw new AppError('Failed to create guest session', {
        code: 'GUEST_SESSION_CREATION_FAILED'
      });
    }
  }

  /**
   * Check if a guest user can access a workflow
   * @param {string} userId - Guest user ID
   * @param {string} workflowId - Workflow ID to access
   * @returns {Promise<boolean>} - True if guest can access workflow
   */
  async canAccessWorkflow(userId, workflowId) {
    try {
      // Check if user is a guest
      if (!isGuestUser(userId)) {
        // Non-guest users are handled by normal authentication
        return true;
      }
      
      // Get guest session
      const session = await this.sessionManager.getSession(userId);
      
      // Validate session
      if (!session) {
        logger.warn('Guest session not found', { userId });
        return false;
      }
      
      // Check if session is expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        logger.info('Guest session expired', { userId });
        return false;
      }
      
      // Check remaining requests
      if (session.requestsRemaining <= 0) {
        logger.info('Guest out of requests', { userId });
        return false;
      }
      
      // Guest can access workflow
      return true;
    } catch (error) {
      logger.error('Error checking guest workflow access', { userId, error });
      return false;
    }
  }

  /**
   * Track a workflow request from a guest user
   * @param {string} userId - Guest user ID
   * @param {string} workflowId - Workflow ID that was accessed
   * @returns {Promise<Object>} - Updated session data
   */
  async trackWorkflowRequest(userId, workflowId) {
    try {
      // Check if user is a guest
      if (!isGuestUser(userId)) {
        // Nothing to track for non-guest users
        return { success: true };
      }
      
      // Get guest session
      const session = await this.sessionManager.getSession(userId);
      
      // Validate session
      if (!session) {
        logger.warn('Guest session not found when tracking request', { userId });
        throw new AppError('Guest session not found', {
          code: 'GUEST_SESSION_NOT_FOUND'
        });
      }
      
      // Update session data
      const updatedSession = {
        ...session,
        requestsRemaining: Math.max(0, (session.requestsRemaining || GUEST_REQUEST_LIMIT) - 1),
        requestsUsed: (session.requestsUsed || 0) + 1,
        lastActivity: Date.now()
      };
      
      // Save updated session
      await this.sessionManager.updateSession(userId, updatedSession);
      
      logger.info('Tracked guest workflow request', { 
        userId, 
        requestsRemaining: updatedSession.requestsRemaining,
        requestsUsed: updatedSession.requestsUsed
      });
      
      return {
        success: true,
        session: updatedSession
      };
    } catch (error) {
      logger.error('Error tracking guest workflow request', { userId, error });
      throw new AppError('Failed to track guest workflow request', {
        code: 'GUEST_REQUEST_TRACKING_FAILED'
      });
    }
  }

  /**
   * Get guest session data
   * @param {string} userId - Guest user ID
   * @returns {Promise<Object|null>} - Guest session data or null if not found
   */
  async getGuestSession(userId) {
    try {
      // Check if user is a guest
      if (!isGuestUser(userId)) {
        return null;
      }
      
      // Get guest session
      return await this.sessionManager.getSession(userId);
    } catch (error) {
      logger.error('Error getting guest session', { userId, error });
      return null;
    }
  }

  /**
   * Validate a guest API key
   * @param {string} apiKey - API key to validate (guest ID)
   * @returns {Promise<Object>} - Validation result
   */
  async validateGuestApiKey(apiKey) {
    try {
      // Check if key is a guest ID
      if (!isGuestUser(apiKey)) {
        return {
          success: false,
          error: 'Not a valid guest key'
        };
      }
      
      // Get guest session
      const session = await this.sessionManager.getSession(apiKey);
      
      // Validate session
      if (!session) {
        return {
          success: false,
          error: 'Guest session not found'
        };
      }
      
      // Check if session is expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        return {
          success: false,
          error: 'Guest session expired'
        };
      }
      
      return {
        success: true,
        session
      };
    } catch (error) {
      logger.error('Error validating guest API key', { apiKey, error });
      return {
        success: false,
        error: 'Failed to validate guest API key'
      };
    }
  }
}

// Helper for middleware
function createGuestAccessMiddleware({ guestAccessService }) {
  return async (req, res, next) => {
    // Check if request has a guest user ID
    const apiKey = req.headers['x-api-key'];
    
    if (apiKey && isGuestUser(apiKey)) {
      // Validate guest access
      const workflowId = req.body.workflowId || req.body.type;
      
      const canAccess = await guestAccessService.canAccessWorkflow(apiKey, workflowId);
      
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          error: 'Guest request limit exceeded',
          code: 'GUEST_LIMIT_EXCEEDED',
          requestsLimit: GUEST_REQUEST_LIMIT
        });
      }
      
      // Set guest context for downstream handlers
      req.guestContext = {
        isGuest: true,
        userId: apiKey
      };
    }
    
    next();
  };
}

module.exports = {
  GuestAccessService,
  createGuestAccessMiddleware,
  isGuestUser,
  generateGuestId,
  GUEST_REQUEST_LIMIT
}; 