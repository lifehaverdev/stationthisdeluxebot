/**
 * Guest Authentication Service
 * 
 * Handles JWT token generation and verification for guest accounts.
 * Guest tokens are long-lived since accounts persist indefinitely.
 */

const jwt = require('jsonwebtoken');

class GuestAuthService {
  constructor({ logger, userCoreDb }) {
    this.logger = logger;
    this.userCoreDb = userCoreDb;
    this.jwtSecret = process.env.JWT_SECRET;
    
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  /**
   * Create a guest authentication token
   * @param {Object} user - User document from userCoreDb
   * @returns {Promise<string>} JWT token
   */
  async createGuestToken(user) {
    if (!user || !user._id) {
      throw new Error('Invalid user document');
    }

    const payload = {
      userId: user._id.toString(),
      isGuest: true
    };
    
    // No expiration - tokens can be long-lived since accounts persist
    // In production, you might want to add expiration for security
    const token = jwt.sign(payload, this.jwtSecret);
    
    this.logger.debug(`[GuestAuthService] Created guest token for user ${user._id}`);
    return token;
  }

  /**
   * Verify a guest authentication token
   * @param {string} token - JWT token
   * @returns {Promise<Object>} User document
   */
  async verifyGuestToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      if (!decoded.isGuest) {
        throw new Error('Token is not a guest token');
      }

      const user = await this.userCoreDb.findById(decoded.userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.isGuest) {
        throw new Error('User is not flagged as guest');
      }

      return user;
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid guest token');
      }
      if (error.name === 'TokenExpiredError') {
        throw new Error('Guest token expired');
      }
      throw error;
    }
  }
}

module.exports = GuestAuthService;

