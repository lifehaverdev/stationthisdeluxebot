const { createSessionAdapter } = require('../adapters/sessionAdapter');
const { createSessionManager } = require('../services/sessionManager');

/**
 * Example RateLimiter class that uses SessionAdapter to track and limit
 * user requests across different endpoints and features
 */
class RateLimiter {
  constructor(options) {
    this.sessionAdapter = options.sessionAdapter;
    this.limits = new Map();
    
    // Set default limits
    this.setLimit('api', 100, 60 * 60 * 1000); // 100 requests per hour
    this.setLimit('login', 5, 15 * 60 * 1000); // 5 login attempts per 15 minutes
    this.setLimit('message', 30, 60 * 1000); // 30 messages per minute
  }

  /**
   * Set rate limit for a specific action type
   * @param {string} actionType - Type of action to limit (e.g., 'api', 'login')
   * @param {number} maxRequests - Maximum number of requests allowed
   * @param {number} windowMs - Time window in milliseconds
   */
  setLimit(actionType, maxRequests, windowMs) {
    this.limits.set(actionType, { maxRequests, windowMs });
  }

  /**
   * Check if a user has exceeded their rate limit for a specific action
   * @param {string} userId - User ID
   * @param {string} actionType - Type of action (e.g., 'api', 'login')
   * @returns {Promise<{allowed: boolean, remaining: number, reset: Date}>}
   */
  async checkLimit(userId, actionType) {
    try {
      if (!this.limits.has(actionType)) {
        throw new Error(`Unknown rate limit action type: ${actionType}`);
      }

      const { maxRequests, windowMs } = this.limits.get(actionType);
      const now = new Date();
      const windowStart = new Date(now.getTime() - windowMs);
      
      // Get user session data
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      if (!userSession) {
        // If no session exists, create one with initial activity records
        await this.sessionAdapter.createUserSession(userId, {
          rateLimits: {
            [actionType]: {
              requests: [],
              lastReset: now
            }
          }
        });
        
        return { allowed: true, remaining: maxRequests - 1, reset: new Date(now.getTime() + windowMs) };
      }
      
      // Initialize rate limits object if it doesn't exist
      if (!userSession.rateLimits) {
        userSession.rateLimits = {};
      }
      
      // Initialize action type tracking if it doesn't exist
      if (!userSession.rateLimits[actionType]) {
        userSession.rateLimits[actionType] = {
          requests: [],
          lastReset: now
        };
      }
      
      // Filter out requests older than the window
      let requests = userSession.rateLimits[actionType].requests.filter(timestamp => 
        new Date(timestamp) > windowStart
      );
      
      // Check if user has exceeded their limit
      const remaining = maxRequests - requests.length;
      const allowed = remaining > 0;
      
      // If allowed, record this new request
      if (allowed) {
        requests.push(now.toISOString());
      }
      
      // Update session with new request data
      await this.sessionAdapter.updateUserSession(userId, {
        rateLimits: {
          ...userSession.rateLimits,
          [actionType]: {
            requests,
            lastReset: userSession.rateLimits[actionType].lastReset
          }
        }
      });
      
      // Calculate reset time
      let resetTime;
      if (requests.length > 0) {
        const oldestRequest = new Date(requests[0]);
        resetTime = new Date(oldestRequest.getTime() + windowMs);
      } else {
        resetTime = new Date(now.getTime() + windowMs);
      }
      
      return {
        allowed,
        remaining: Math.max(0, remaining),
        reset: resetTime
      };
    } catch (error) {
      console.error('Error checking rate limit:', error);
      // In case of error, allow the request but with a warning
      return { 
        allowed: true, 
        remaining: 0, 
        reset: new Date(), 
        error: error.message 
      };
    }
  }

  /**
   * Track a request and check if it's allowed by rate limits
   * @param {string} userId - User ID
   * @param {string} actionType - Type of action
   * @param {object} metadata - Additional metadata about the request
   * @returns {Promise<{allowed: boolean, remaining: number, reset: Date}>}
   */
  async trackRequest(userId, actionType, metadata = {}) {
    // First check if the request is allowed
    const result = await this.checkLimit(userId, actionType);
    
    // Record the attempt regardless of whether it was allowed
    await this.sessionAdapter.updateUserActivity(userId, {
      action: `${actionType}_request`,
      allowed: result.allowed,
      timestamp: new Date(),
      ...metadata
    });
    
    return result;
  }

  /**
   * Reset rate limits for a user
   * @param {string} userId - User ID
   * @param {string} actionType - Optional specific action type to reset
   * @returns {Promise<boolean>}
   */
  async resetLimits(userId, actionType = null) {
    try {
      const userSession = await this.sessionAdapter.getUserSessionData(userId);
      
      if (!userSession || !userSession.rateLimits) {
        return false;
      }
      
      const now = new Date();
      const updates = { rateLimits: { ...userSession.rateLimits } };
      
      if (actionType) {
        // Reset specific action type
        if (updates.rateLimits[actionType]) {
          updates.rateLimits[actionType] = {
            requests: [],
            lastReset: now
          };
        }
      } else {
        // Reset all rate limits
        Object.keys(updates.rateLimits).forEach(action => {
          updates.rateLimits[action] = {
            requests: [],
            lastReset: now
          };
        });
      }
      
      await this.sessionAdapter.updateUserSession(userId, updates);
      
      // Log the reset activity
      await this.sessionAdapter.updateUserActivity(userId, {
        action: 'rate_limit_reset',
        actionType: actionType || 'all',
        timestamp: now
      });
      
      return true;
    } catch (error) {
      console.error('Error resetting rate limits:', error);
      return false;
    }
  }
}

/**
 * Example demonstrating how to use the RateLimiter with SessionAdapter
 */
async function runRateLimiterExample() {
  try {
    // Initialize core services
    const sessionManager = createSessionManager({
      databaseUrl: process.env.DATABASE_URL
    });

    // Create the session adapter
    const sessionAdapter = createSessionAdapter({
      sessionManager
    });

    // Create rate limiter
    const rateLimiter = new RateLimiter({
      sessionAdapter
    });
    
    // Define custom limit for file uploads
    rateLimiter.setLimit('file_upload', 10, 5 * 60 * 1000); // 10 uploads per 5 minutes
    
    // Simulate a series of API requests
    const userId = 'user123';
    console.log('\nSimulating API requests:');
    
    for (let i = 1; i <= 5; i++) {
      const result = await rateLimiter.trackRequest(userId, 'api', {
        endpoint: '/api/data',
        method: 'GET',
        ip: '192.168.1.1'
      });
      
      console.log(`Request ${i}: ${result.allowed ? 'Allowed' : 'Blocked'}, Remaining: ${result.remaining}`);
    }
    
    // Simulate login attempts
    console.log('\nSimulating login attempts:');
    
    for (let i = 1; i <= 7; i++) {
      const result = await rateLimiter.trackRequest(userId, 'login', {
        success: i < 4, // First 3 attempts fail
        ip: '192.168.1.1'
      });
      
      console.log(`Login attempt ${i}: ${result.allowed ? 'Allowed' : 'Blocked'}, Remaining: ${result.remaining}`);
    }
    
    // Get the user's session data to see recorded activity
    const userSession = await sessionAdapter.getUserSessionData(userId);
    console.log('\nUser session data:');
    console.log(JSON.stringify(userSession, null, 2));
    
    // Reset login rate limits
    console.log('\nResetting login rate limits:');
    await rateLimiter.resetLimits(userId, 'login');
    
    // Check login limit again
    const afterResetResult = await rateLimiter.checkLimit(userId, 'login');
    console.log(`After reset: Allowed: ${afterResetResult.allowed}, Remaining: ${afterResetResult.remaining}`);

  } catch (error) {
    console.error('Error in rate limiter example:', error);
  }
}

module.exports = { 
  runRateLimiterExample,
  RateLimiter 
}; 