/**
 * Lightweight In-Memory Rate Limiter
 * 
 * Provides rate limiting functionality without external dependencies.
 * Uses in-memory storage (Map) and can be easily extended to use Redis later.
 * 
 * @module rateLimiter
 */

/**
 * Rate limiter storage entry
 * @typedef {Object} RateLimitEntry
 * @property {number} count - Current request count
 * @property {number} resetTime - Timestamp when the window resets
 */

class RateLimiter {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 minute)
   * @param {number} options.max - Maximum requests per window (default: 10)
   * @param {Function} options.keyGenerator - Function to generate rate limit key from request (default: uses IP)
   * @param {Function} options.skip - Function to determine if request should be skipped (default: never skip)
   * @param {Function} logger - Logger instance (optional)
   */
  constructor(options = {}, logger = console) {
    this.windowMs = options.windowMs || 60000; // 1 minute default
    this.max = options.max || 10;
    this.keyGenerator = options.keyGenerator || this._defaultKeyGenerator;
    this.skip = options.skip || (() => false);
    this.logger = logger;
    
    // In-memory storage: key -> { count, resetTime }
    this.storage = new Map();
    
    // Cleanup interval: remove expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this._cleanup();
    }, 5 * 60 * 1000);
    
    // Store cleanup interval so it can be cleared if needed
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref(); // Don't keep process alive
    }
  }

  /**
   * Default key generator: uses IP address
   * @private
   */
  _defaultKeyGenerator(req) {
    // Try to get IP from various sources
    const ip = req.ip || 
               req.connection?.remoteAddress || 
               req.socket?.remoteAddress ||
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               'unknown';
    return `ip:${ip}`;
  }

  /**
   * Clean up expired entries from storage
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.storage.entries()) {
      if (now > entry.resetTime) {
        this.storage.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`[RateLimiter] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Check if a request should be rate limited
   * @param {Object} req - Express request object
   * @returns {{allowed: boolean, remaining: number, resetTime: number}}
   */
  check(req) {
    // Skip if skip function returns true
    if (this.skip(req)) {
      return { allowed: true, remaining: this.max, resetTime: Date.now() + this.windowMs };
    }

    const key = this.keyGenerator(req);
    const now = Date.now();
    
    let entry = this.storage.get(key);
    
    // If entry doesn't exist or has expired, create new entry
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + this.windowMs
      };
    }
    
    // Increment count
    entry.count++;
    this.storage.set(key, entry);
    
    const remaining = Math.max(0, this.max - entry.count);
    const allowed = entry.count <= this.max;
    
    if (!allowed) {
      this.logger.warn(`[RateLimiter] Rate limit exceeded for key: ${key} (${entry.count}/${this.max})`);
    }
    
    return {
      allowed,
      remaining,
      resetTime: entry.resetTime,
      total: entry.count
    };
  }

  /**
   * Reset rate limit for a specific key
   * @param {string} key - Rate limit key
   */
  reset(key) {
    this.storage.delete(key);
  }

  /**
   * Get current rate limit status for a key
   * @param {Object} req - Express request object
   * @returns {{remaining: number, resetTime: number, total: number}}
   */
  getStatus(req) {
    const key = this.keyGenerator(req);
    const entry = this.storage.get(key);
    const now = Date.now();
    
    if (!entry || now > entry.resetTime) {
      return {
        remaining: this.max,
        resetTime: now + this.windowMs,
        total: 0
      };
    }
    
    return {
      remaining: Math.max(0, this.max - entry.count),
      resetTime: entry.resetTime,
      total: entry.count
    };
  }

  /**
   * Destroy the rate limiter and clean up resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.storage.clear();
  }
}

/**
 * Create Express middleware for rate limiting
 * @param {Object} options - Rate limiter options
 * @param {Function} logger - Logger instance (optional)
 * @returns {Function} Express middleware
 */
function createRateLimitMiddleware(options = {}, logger = console) {
  const limiter = new RateLimiter(options, logger);
  
  return (req, res, next) => {
    const result = limiter.check(req);
    
    // Set rate limit headers (following standard format)
    res.setHeader('X-RateLimit-Limit', limiter.max);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
    
    if (!result.allowed) {
      return res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: options.message || 'You have sent too many requests in a given amount of time. Please try again later.',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        }
      });
    }
    
    next();
  };
}

/**
 * Create a rate limiter that uses wallet address as the key
 * Useful for per-wallet rate limiting
 * @param {Object} options - Rate limiter options
 * @param {Function} logger - Logger instance (optional)
 * @returns {Function} Express middleware
 */
function createWalletRateLimitMiddleware(options = {}, logger = console) {
  return createRateLimitMiddleware({
    ...options,
    keyGenerator: (req) => {
      // Try to get wallet from various sources
      const wallet = req.body?.userWalletAddress || 
                    req.body?.wallet || 
                    req.query?.wallet || 
                    req.headers['x-wallet-address'] ||
                    'unknown';
      return `wallet:${wallet.toLowerCase()}`;
    }
  }, logger);
}

/**
 * Create a rate limiter that uses master account ID as the key
 * @param {Object} options - Rate limiter options
 * @param {Function} logger - Logger instance (optional)
 * @returns {Function} Express middleware
 */
function createAccountRateLimitMiddleware(options = {}, logger = console) {
  return createRateLimitMiddleware({
    ...options,
    keyGenerator: (req) => {
      // Try to get master account ID from various sources
      const accountId = req.params?.masterAccountId ||
                       req.body?.masterAccountId ||
                       req.query?.masterAccountId ||
                       'unknown';
      return `account:${accountId}`;
    }
  }, logger);
}

module.exports = {
  RateLimiter,
  createRateLimitMiddleware,
  createWalletRateLimitMiddleware,
  createAccountRateLimitMiddleware
};

