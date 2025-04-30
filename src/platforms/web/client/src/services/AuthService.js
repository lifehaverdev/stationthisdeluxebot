/**
 * Authentication Service for StationThis Web Client
 * 
 * Handles all authentication-related API calls and token management
 */

import { EventBus } from '../stores/EventBus.js';

class AuthService {
  constructor() {
    this.token = localStorage.getItem('auth_token');
    this.user = JSON.parse(localStorage.getItem('user') || 'null');
    
    // Initialize event handlers
    this._setupEventHandlers();
  }
  
  /**
   * Set up event handlers for auth-related events
   * @private
   */
  _setupEventHandlers() {
    // Listen for login events from components
    EventBus.subscribe('auth:login', this.login.bind(this));
    EventBus.subscribe('auth:wallet', this.connectWallet.bind(this));
    EventBus.subscribe('auth:guest', this.guestAccess.bind(this));
    EventBus.subscribe('auth:logout', this.logout.bind(this));
  }
  
  /**
   * Login with email/username and password
   * @param {Object} data Authentication data
   * @param {string} data.username Username or email
   * @param {string} data.password User password
   * @returns {Promise<Object>} Authentication result
   */
  async login(data) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: data.username,
          password: data.password
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Authentication failed');
      }
      
      const responseData = await response.json();
      
      // Store token and user data
      this.token = responseData.token;
      this.user = responseData.user;
      
      localStorage.setItem('auth_token', this.token);
      localStorage.setItem('user', JSON.stringify(this.user));
      
      // Publish authenticated event
      EventBus.publish('auth:authenticated', {
        user: this.user,
        token: this.token,
        method: 'password'
      });
      
      return responseData;
    } catch (error) {
      console.error('Login error:', error);
      
      // Publish authentication error
      EventBus.publish('auth:error', {
        message: error.message,
        method: 'password'
      });
      
      throw error;
    }
  }
  
  /**
   * Connect with cryptocurrency wallet
   * @param {Object} data Wallet data
   * @param {string} data.address Wallet address
   * @returns {Promise<Object>} Authentication result
   */
  async connectWallet(data) {
    try {
      // Check if Web3 is available
      if (typeof window.ethereum === 'undefined') {
        throw new Error('No Ethereum wallet detected. Please install MetaMask or another wallet.');
      }
      
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      
      // Get authentication message to sign
      const messageResponse = await fetch('/api/auth/wallet/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address })
      });
      
      if (!messageResponse.ok) {
        const errorData = await messageResponse.json();
        throw new Error(errorData.error || 'Failed to get authentication message');
      }
      
      const { message } = await messageResponse.json();
      
      // Sign the message
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address]
      });
      
      // Verify signature and authenticate
      const authResponse = await fetch('/api/auth/wallet/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address, signature, message })
      });
      
      if (!authResponse.ok) {
        const errorData = await authResponse.json();
        throw new Error(errorData.error || 'Wallet authentication failed');
      }
      
      const responseData = await authResponse.json();
      
      // Store token and user data
      this.token = responseData.token;
      this.user = responseData.user;
      
      localStorage.setItem('auth_token', this.token);
      localStorage.setItem('user', JSON.stringify(this.user));
      
      // Publish authenticated event
      EventBus.publish('auth:authenticated', {
        user: this.user,
        token: this.token,
        method: 'wallet'
      });
      
      return responseData;
    } catch (error) {
      console.error('Wallet connection error:', error);
      
      // Publish authentication error
      EventBus.publish('auth:error', {
        message: error.message,
        method: 'wallet'
      });
      
      throw error;
    }
  }
  
  /**
   * Access as guest
   * @param {Object} data Guest data
   * @param {string} data.guestId Optional guest ID
   * @returns {Promise<Object>} Guest session data
   */
  async guestAccess(data) {
    try {
      const response = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          guestId: data.guestId || `guest-${Date.now()}`
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Guest access failed');
      }
      
      const responseData = await response.json();
      
      // Store token and guest user data
      this.token = responseData.token;
      this.user = responseData.user;
      
      localStorage.setItem('auth_token', this.token);
      localStorage.setItem('user', JSON.stringify(this.user));
      
      // Publish authenticated event
      EventBus.publish('auth:authenticated', {
        user: this.user,
        token: this.token,
        method: 'guest'
      });
      
      return responseData;
    } catch (error) {
      console.error('Guest access error:', error);
      
      // Publish authentication error
      EventBus.publish('auth:error', {
        message: error.message,
        method: 'guest'
      });
      
      throw error;
    }
  }
  
  /**
   * Log out the current user
   * @returns {Promise<boolean>} Logout success
   */
  async logout() {
    try {
      if (this.token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    // Clear local storage and state regardless of API success
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    this.token = null;
    this.user = null;
    
    // Publish logout event
    EventBus.publish('auth:logout:complete');
    
    return true;
  }
  
  /**
   * Check if the user is authenticated
   * @returns {boolean} Whether user is authenticated
   */
  isAuthenticated() {
    return !!this.token;
  }
  
  /**
   * Get the current user
   * @returns {Object|null} Current user or null if not authenticated
   */
  getCurrentUser() {
    return this.user;
  }
  
  /**
   * Get the authentication token
   * @returns {string|null} Auth token or null if not authenticated
   */
  getToken() {
    return this.token;
  }
  
  /**
   * Add authorization header to request options
   * @param {Object} options Request options
   * @returns {Object} Options with auth header
   */
  addAuthHeader(options = {}) {
    if (!this.token) return options;
    
    const headers = options.headers || {};
    return {
      ...options,
      headers: {
        ...headers,
        'Authorization': `Bearer ${this.token}`
      }
    };
  }
}

// Create and export singleton instance
export const authService = new AuthService(); 