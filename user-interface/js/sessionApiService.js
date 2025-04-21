/**
 * Session API Service
 * Handles all session-related API requests, including authentication and session management
 */
class SessionApiService {
  /**
   * Create a new Session API Service
   * @param {Object} options - Service options
   * @param {string} options.baseUrl - API base URL
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '/api';
    this.sessionKey = 'stationthis_session';
  }

  /**
   * Make API request
   * @param {string} endpoint - API endpoint path
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} - API response
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const session = this.getSession();
    if (session && session.apiKey) {
      defaultOptions.headers['X-API-Key'] = session.apiKey;
    }
    
    const fetchOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...(options.headers || {})
      }
    };
    
    try {
      const response = await fetch(url, fetchOptions);
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
   * @returns {Promise<Object>} - Validation response
   */
  async validateApiKey(apiKey) {
    try {
      const response = await this.request('/session/validate-api-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey })
      });
      
      if (response.success && response.session) {
        this.saveSession(response.session);
      }
      
      return response;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate nonce for wallet authentication
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} - Nonce response
   */
  async generateNonce(walletAddress) {
    try {
      return await this.request('/session/generate-nonce', {
        method: 'POST',
        body: JSON.stringify({ walletAddress })
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate wallet
   * @param {Object} data - Wallet data
   * @param {string} data.walletAddress - Wallet address
   * @param {string} data.signature - Signed message
   * @param {string} data.nonce - Nonce used for signing
   * @returns {Promise<Object>} - Validation response
   */
  async validateWallet(data) {
    try {
      const response = await this.request('/session/validate-wallet', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      if (response.success && response.session) {
        this.saveSession(response.session);
      }
      
      return response;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create guest session
   * @returns {Promise<Object>} - Guest session response
   */
  async createGuestSession() {
    try {
      const response = await this.request('/session/guest', {
        method: 'POST'
      });
      
      if (response.success && response.session) {
        this.saveSession(response.session);
      }
      
      return response;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user data using current session
   * @returns {Promise<Object>} - User data
   */
  async getUserData() {
    try {
      return await this.request('/session/user');
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Logout current session
   * @returns {Promise<Object>} - Logout response
   */
  async logout() {
    try {
      const response = await this.request('/session/logout', {
        method: 'POST'
      });
      
      this.clearSession();
      return response;
    } catch (error) {
      this.clearSession();
      return { success: true };
    }
  }

  /**
   * Save session data to local storage
   * @param {Object} session - Session data
   */
  saveSession(session) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.sessionKey, JSON.stringify(session));
    }
  }

  /**
   * Get session data from local storage
   * @returns {Object|null} - Session data or null if not found
   */
  getSession() {
    if (typeof localStorage !== 'undefined') {
      try {
        const sessionData = localStorage.getItem(this.sessionKey);
        return sessionData ? JSON.parse(sessionData) : null;
      } catch (error) {
        console.error('Error retrieving session:', error);
        return null;
      }
    }
    return null;
  }

  /**
   * Clear session data from local storage
   */
  clearSession() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.sessionKey);
    }
  }

  /**
   * Check if user is logged in
   * @returns {boolean} - Whether user is logged in
   */
  isLoggedIn() {
    const session = this.getSession();
    return !!(session && session.apiKey);
  }
}

// Make available in both Node.js and browser environments
if (typeof module !== 'undefined') {
  module.exports = SessionApiService;
} else if (typeof window !== 'undefined') {
  window.SessionApiService = SessionApiService;
} 