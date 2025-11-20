/**
 * EventDeduplicationService
 * 
 * Handles transaction hash caching and duplicate detection to prevent
 * duplicate processing of webhook events.
 * 
 * This is a stateless utility service with no external dependencies.
 */
class EventDeduplicationService {
  constructor(logger) {
    this.logger = logger || console;
    
    // In-memory cache for recently processed tx hashes
    // TTL: 2 minutes
    this.RECENT_TX_CACHE_TTL_MS = 2 * 60 * 1000;
    this.recentProcessedTxHashes = new Map(); // txHash -> timestamp
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupCache(), 60 * 1000);
  }

  /**
   * Checks if a transaction hash has been recently processed.
   * @param {string} txHash - The transaction hash to check
   * @returns {boolean} True if the transaction was recently processed
   */
  isDuplicate(txHash) {
    const normalizedHash = txHash.toLowerCase();
    const ts = this.recentProcessedTxHashes.get(normalizedHash);
    
    if (!ts) return false;
    
    if (Date.now() - ts > this.RECENT_TX_CACHE_TTL_MS) {
      // Expired, remove from cache
      this.recentProcessedTxHashes.delete(normalizedHash);
      return false;
    }
    
    return true;
  }

  /**
   * Marks a transaction hash as processed.
   * @param {string} txHash - The transaction hash to mark
   */
  markProcessed(txHash) {
    const normalizedHash = txHash.toLowerCase();
    this.recentProcessedTxHashes.set(normalizedHash, Date.now());
  }

  /**
   * Cleans up expired entries from the cache.
   */
  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [txHash, ts] of this.recentProcessedTxHashes.entries()) {
      if (now - ts > this.RECENT_TX_CACHE_TTL_MS) {
        this.recentProcessedTxHashes.delete(txHash);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`[EventDeduplicationService] Cleaned up ${cleaned} expired cache entries`);
    }
  }

  /**
   * Gets the current cache size (for monitoring).
   * @returns {number} Number of entries in cache
   */
  getCacheSize() {
    return this.recentProcessedTxHashes.size;
  }

  /**
   * Clears all cache entries (useful for testing).
   */
  clearCache() {
    this.recentProcessedTxHashes.clear();
  }

  /**
   * Cleanup on service destruction.
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearCache();
  }
}

module.exports = EventDeduplicationService;

