/**
 * RetryHandler - Utility for retrying operations with exponential backoff
 * 
 * Provides a reusable retry mechanism with configurable attempts and delays.
 */

/**
 * Retries an operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {Object} options - Retry configuration
 * @param {number} options.maxAttempts - Maximum number of retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @param {Function} options.onRetry - Optional callback called on each retry attempt
 * @param {Function} options.onFailure - Optional callback called when all retries fail
 * @returns {Promise<any>} - Result of the operation
 * @throws {Error} - Last error if all retries fail
 */
async function retryWithBackoff(operation, options = {}) {
    const {
        maxAttempts = 3,
        baseDelay = 1000,
        onRetry = null,
        onFailure = null
    } = options;

    let lastError;
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            attempts++;

            if (attempts >= maxAttempts) {
                // All retries exhausted
                if (onFailure) {
                    onFailure(error, attempts);
                }
                throw error;
            }

            // Calculate exponential backoff delay
            // Formula: baseDelay * (4 - retries) where retries starts at maxAttempts
            // This gives: attempt 1: baseDelay * 3, attempt 2: baseDelay * 2, attempt 3: baseDelay * 1
            const delay = baseDelay * (maxAttempts + 1 - attempts);
            
            if (onRetry) {
                onRetry(error, attempts, delay);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Should never reach here, but TypeScript/ESLint might complain
    throw lastError;
}

module.exports = {
    retryWithBackoff
};

