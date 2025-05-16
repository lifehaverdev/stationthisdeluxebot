/**
 * Session API Service
 * 
 * Provides API methods for session management in the web interface.
 */

/**
 * Class to handle session-related API calls
 */
class SessionApiService {
  /**
   * Creates a new session API service
   * @param {Object} options - Service options
   * @param {string} options.baseUrl - Base API URL
   * @param {Function} options.fetchFn - Custom fetch function (optional)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '/api/internal';
    this.fetch = options.fetchFn || window.fetch.bind(window);
  }

  /**
   * Make API request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   * @private
   */
  async _request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (options.apiKey) {
      headers['X-API-Key'] = options.apiKey;
    }

    try {
      const response = await this.fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      return data;
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  /**
   * Validate API key
   * @param {string} apiKey - API key to validate
   * @returns {Promise<Object>} - Validation result
   */
  async validateApiKey(apiKey) {
    return this._request('/session/validate', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });
  }

  /**
   * Generate nonce for wallet authentication
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} - Nonce data
   */
  async generateNonce(walletAddress) {
    return this._request('/session/nonce', {
      method: 'POST',
      body: JSON.stringify({ walletAddress }),
    });
  }

  /**
   * Validate wallet signature
   * @param {Object} data - Validation data
   * @param {string} data.walletAddress - Wallet address
   * @param {string} data.signature - Wallet signature
   * @param {string} data.nonce - Nonce that was signed
   * @returns {Promise<Object>} - Validation result with session data
   */
  async validateWallet(data) {
    return this._request('/session/wallet', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Create a guest session
   * @returns {Promise<Object>} - Guest session data
   */
  async createGuestSession() {
    return this._request('/session/guest', {
      method: 'POST',
    });
  }

  /**
   * Get current session data
   * @param {string} apiKey - API key
   * @returns {Promise<Object>} - Session data
   */
  async getSession(apiKey) {
    return this._request('/session', {
      method: 'GET',
      apiKey,
    });
  }

  /**
   * Update session data
   * @param {string} apiKey - API key
   * @param {Object} data - Data to update
   * @returns {Promise<Object>} - Updated session data
   */
  async updateSession(apiKey, data) {
    return this._request('/session', {
      method: 'PUT',
      apiKey,
      body: JSON.stringify(data),
    });
  }

  /**
   * End current session
   * @param {string} apiKey - API key
   * @returns {Promise<Object>} - Result
   */
  async endSession(apiKey) {
    return this._request('/session', {
      method: 'DELETE',
      apiKey,
    });
  }
}

// Export for browser and Node.js environments
if (typeof module !== 'undefined') {
  module.exports = SessionApiService;
} else if (typeof window !== 'undefined') {
  window.SessionApiService = SessionApiService;
} 