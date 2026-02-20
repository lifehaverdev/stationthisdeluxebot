/**
 * Polling Helper
 *
 * Shared utility for waiting on async operations (ComfyUI jobs, vastai instances, etc.)
 * Replaces arbitrary timeouts with condition-based waiting.
 */

/**
 * Poll a function until it returns a truthy value or timeout is reached.
 * @param {() => Promise<any>} fn - Async function to poll. Return truthy to stop.
 * @param {Object} [options]
 * @param {number} [options.interval=2000] - Milliseconds between polls.
 * @param {number} [options.timeout=60000] - Max milliseconds before giving up.
 * @param {string} [options.label='pollUntil'] - Label for timeout error message.
 * @returns {Promise<any>} The first truthy result from fn.
 */
async function pollUntil(fn, { interval = 2000, timeout = 60000, label = 'pollUntil' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`${label}: timed out after ${timeout}ms`);
}

module.exports = { pollUntil };
