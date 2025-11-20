/**
 * Group Lock Utilities
 * 
 * Provides atomic locking mechanism for group processing to prevent race conditions.
 * Uses promise chain pattern for atomic lock acquisition.
 */

// --- In-memory lock for currently processing user-token groups ---
// Using promise chain pattern for atomic lock acquisition (prevents race conditions)
const processingGroupLocks = new Map(); // groupKey -> Promise (mutex chain)

/**
 * Gets a group key from user address and token address.
 * @param {string} user - The user address
 * @param {string} token - The token address
 * @returns {string} The group key
 */
function getGroupKey(user, token) {
  return user.toLowerCase() + '-' + token.toLowerCase();
}

/**
 * Acquire lock for a specific group key using promise chain pattern.
 * This ensures atomic lock acquisition and prevents race conditions.
 * @param {string} groupKey - The group key to lock
 * @returns {Promise<Function>} A function to release the lock
 */
async function acquireGroupLock(groupKey) {
  // Get or create lock promise chain for this key
  if (!processingGroupLocks.has(groupKey)) {
    processingGroupLocks.set(groupKey, Promise.resolve());
  }
  
  // Add ourselves to the chain - wait for previous operations
  const previousLock = processingGroupLocks.get(groupKey);
  let releaseLock;
  const ourLock = previousLock.then(() => {
    return new Promise(resolve => {
      releaseLock = resolve; // Store release function
    });
  });
  
  // Update chain with our lock
  processingGroupLocks.set(groupKey, ourLock);
  
  // Wait for our turn (for previous operations to complete)
  await previousLock;
  
  // Return release function
  return () => {
    releaseLock(); // Release lock, allowing next operation
    // Clean up lock chain if no one is waiting
    if (processingGroupLocks.get(groupKey) === ourLock) {
      processingGroupLocks.delete(groupKey);
    }
  };
}

module.exports = {
  getGroupKey,
  acquireGroupLock
};

