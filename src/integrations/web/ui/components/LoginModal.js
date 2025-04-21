/**
 * Login Modal
 * Vanilla JavaScript implementation for session management
 * Handles user authentication via API key, wallet connection, or guest mode
 */
class LoginModal {
  /**
   * Create a new login modal
   * @param {Object} options - Modal options
   * @param {Function} options.onLogin - Callback function called after successful login
   * @param {Function} options.onCancel - Callback function called when login is cancelled
   * @param {Object} options.apiService - Session API service for authentication requests
   * @param {string} options.containerId - ID of container element where modal will be mounted
   */
  constructor(options = {}) {
    this.onLogin = options.onLogin || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.apiService = options.apiService;
    this.containerId = options.containerId || 'modal-container';
    
    // Internal state
    this.activeTab = 'apiKey'; // apiKey, wallet, or guest
    this.isLoading = false;
    this.error = null;
    this.apiKey = '';
    this.walletAddress = '';
    this.nonce = '';
    
    // Create modal container if it doesn't exist
    this.ensureContainer();
    
    // Create modal element
    this.modalElement = null;
    this.errorElement = null;
    this.apiKeyInput = null;
  }
  
  /**
   * Ensure the container element exists
   */
  ensureContainer() {
    if (!document.getElementById(this.containerId)) {
      const container = document.createElement('div');
      container.id = this.containerId;
      document.body.appendChild(container);
    }
  }
  
  /**
   * Show the login modal
   */
  show() {
    this.render();
    this.modalElement.style.display = 'block';
  }
  
  /**
   * Hide the login modal
   */
  hide() {
    if (this.modalElement) {
      this.modalElement.style.display = 'none';
    }
  }
  
  /**
   * Set loading state
   * @param {boolean} isLoading - Whether the modal is in loading state
   */
  setLoading(isLoading) {
    this.isLoading = isLoading;
    
    // Update UI elements
    const buttons = this.modalElement.querySelectorAll('button');
    buttons.forEach(button => {
      button.disabled = isLoading;
      
      // Update spinner visibility
      const spinner = button.querySelector('.spinner');
      if (spinner) {
        spinner.style.display = isLoading ? 'inline-block' : 'none';
      }
    });
    
    // Disable inputs during loading
    const inputs = this.modalElement.querySelectorAll('input');
    inputs.forEach(input => {
      input.disabled = isLoading;
    });
  }
  
  /**
   * Set error message
   * @param {string} error - Error message
   */
  setError(error) {
    this.error = error;
    
    if (this.errorElement) {
      if (error) {
        this.errorElement.textContent = error;
        this.errorElement.style.display = 'block';
      } else {
        this.errorElement.style.display = 'none';
      }
    }
  }
  
  /**
   * Switch active tab
   * @param {string} tabName - Tab name to switch to
   */
  switchTab(tabName) {
    this.activeTab = tabName;
    
    // Update tab buttons
    const tabButtons = this.modalElement.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      if (button.dataset.tab === tabName) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
    
    // Update tab content
    const tabContents = this.modalElement.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
      if (content.dataset.tab === tabName) {
        content.style.display = 'block';
      } else {
        content.style.display = 'none';
      }
    });
  }
  
  /**
   * Handle API key login
   * @param {Event} e - Form submit event
   */
  async handleApiKeyLogin(e) {
    e.preventDefault();
    
    const apiKey = this.apiKeyInput.value.trim();
    
    if (!apiKey) {
      this.setError('API key is required');
      return;
    }
    
    this.setLoading(true);
    this.setError(null);
    
    try {
      const response = await this.apiService.validateApiKey(apiKey);
      
      if (!response.success) {
        throw new Error(response.error || 'Invalid API key');
      }
      
      this.onLogin({
        method: 'apiKey',
        apiKey,
        session: response.session
      });
      
      this.hide();
    } catch (error) {
      this.setError(error.message || 'Failed to validate API key');
    } finally {
      this.setLoading(false);
    }
  }
  
  /**
   * Handle wallet connection
   */
  async handleWalletConnect() {
    this.setLoading(true);
    this.setError(null);
    
    try {
      // Check if wallet is available
      if (typeof window.ethereum === 'undefined') {
        throw new Error('Wallet not detected. Please install MetaMask or similar wallet.');
      }
      
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const walletAddress = accounts[0];
      
      // Generate nonce for signing
      const nonceResponse = await this.apiService.generateNonce(walletAddress);
      
      if (!nonceResponse.success) {
        throw new Error(nonceResponse.error || 'Failed to generate nonce');
      }
      
      const nonce = nonceResponse.nonce;
      this.walletAddress = walletAddress;
      this.nonce = nonce;
      
      // Request signature
      const message = `Sign this message to authenticate with StationThis\nNonce: ${nonce}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress]
      });
      
      // Validate wallet
      const response = await this.apiService.validateWallet({
        walletAddress,
        signature,
        nonce
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to authenticate wallet');
      }
      
      this.onLogin({
        method: 'wallet',
        walletAddress,
        apiKey: response.session.apiKey,
        session: response.session
      });
      
      this.hide();
    } catch (error) {
      console.error('Wallet connection error:', error);
      this.setError(error.message || 'Failed to connect wallet');
    } finally {
      this.setLoading(false);
    }
  }
  
  /**
   * Handle guest login
   */
  async handleGuestLogin() {
    this.setLoading(true);
    this.setError(null);
    
    try {
      const response = await this.apiService.createGuestSession();
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to create guest session');
      }
      
      this.onLogin({
        method: 'guest',
        apiKey: response.session.apiKey,
        session: response.session
      });
      
      this.hide();
    } catch (error) {
      this.setError(error.message || 'Failed to create guest session');
    } finally {
      this.setLoading(false);
    }
  }
  
  /**
   * Render the modal
   */
  render() {
    // Clean up existing modal if any
    if (this.modalElement) {
      this.modalElement.remove();
    }
    
    // Create modal element
    this.modalElement = document.createElement('div');
    this.modalElement.className = 'login-modal';
    this.modalElement.style.display = 'none';
    
    // Add modal content
    this.modalElement.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Welcome to StationThis</h2>
          <button type="button" class="close-button">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="error-message" style="display: none;"></div>
          
          <div class="tabs">
            <div class="tab-buttons">
              <button type="button" class="tab-button active" data-tab="apiKey">API Key</button>
              <button type="button" class="tab-button" data-tab="wallet">Connect Wallet</button>
              <button type="button" class="tab-button" data-tab="guest">Guest Access</button>
            </div>
            
            <div class="tab-contents">
              <div class="tab-content" data-tab="apiKey" style="display: block;">
                <form id="api-key-form">
                  <div class="form-group">
                    <label for="api-key-input">Enter your API Key</label>
                    <input type="text" id="api-key-input" placeholder="Paste your API key here">
                    <small class="form-text">Enter your existing API key to access your account</small>
                  </div>
                  
                  <button type="submit" class="submit-button">
                    <span class="spinner" style="display: none;"></span>
                    Login with API Key
                  </button>
                </form>
              </div>
              
              <div class="tab-content" data-tab="wallet" style="display: none;">
                <div class="text-center">
                  <p>Connect your Web3 wallet to access your account</p>
                  <button type="button" class="wallet-button">
                    <span class="spinner" style="display: none;"></span>
                    Connect Wallet
                  </button>
                  <small class="form-text">We'll create an API key for you when you connect your wallet</small>
                </div>
              </div>
              
              <div class="tab-content" data-tab="guest" style="display: none;">
                <div class="text-center">
                  <p>Try out StationThis without an account</p>
                  <p class="small-text">Limited features are available in guest mode</p>
                  <button type="button" class="guest-button">
                    <span class="spinner" style="display: none;"></span>
                    Continue as Guest
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <p class="small-text">By continuing, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </div>
    `;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .login-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        font-family: Arial, sans-serif;
        z-index: 1000;
      }
      
      .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
      }
      
      .modal-content {
        position: relative;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        border-radius: 5px;
        max-width: 500px;
        width: 100%;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }
      
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 20px;
        border-bottom: 1px solid #eee;
      }
      
      .modal-header h2 {
        margin: 0;
        font-size: 1.5rem;
      }
      
      .close-button {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
      }
      
      .modal-body {
        padding: 20px;
      }
      
      .modal-footer {
        padding: 15px 20px;
        border-top: 1px solid #eee;
        text-align: center;
      }
      
      .error-message {
        background-color: #f8d7da;
        color: #721c24;
        padding: 10px;
        margin-bottom: 15px;
        border-radius: 4px;
      }
      
      .tabs {
        width: 100%;
      }
      
      .tab-buttons {
        display: flex;
        margin-bottom: 15px;
        border-bottom: 1px solid #ddd;
      }
      
      .tab-button {
        padding: 10px 15px;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.7;
      }
      
      .tab-button.active {
        opacity: 1;
        font-weight: bold;
        border-bottom: 2px solid #007bff;
      }
      
      .form-group {
        margin-bottom: 15px;
      }
      
      .form-group label {
        display: block;
        margin-bottom: 5px;
      }
      
      .form-group input {
        width: 100%;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
      }
      
      .form-text {
        display: block;
        margin-top: 5px;
        font-size: 0.875rem;
        color: #6c757d;
      }
      
      .small-text {
        font-size: 0.875rem;
        color: #6c757d;
      }
      
      .text-center {
        text-align: center;
      }
      
      button {
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
        margin-top: 10px;
      }
      
      .submit-button, .guest-button {
        width: 100%;
        background-color: #28a745;
        color: white;
        border: none;
      }
      
      .wallet-button {
        width: 100%;
        background-color: white;
        color: #007bff;
        border: 1px solid #007bff;
      }
      
      button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
      
      .spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        border-top-color: white;
        animation: spin 1s ease-in-out infinite;
        margin-right: 5px;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    
    // Append the modal and styles to the container
    const container = document.getElementById(this.containerId);
    container.appendChild(style);
    container.appendChild(this.modalElement);
    
    // Get references to DOM elements
    this.errorElement = this.modalElement.querySelector('.error-message');
    this.apiKeyInput = this.modalElement.querySelector('#api-key-input');
    
    // Add event listeners
    
    // Close button
    const closeButton = this.modalElement.querySelector('.close-button');
    closeButton.addEventListener('click', () => {
      this.hide();
      this.onCancel();
    });
    
    // Tab buttons
    const tabButtons = this.modalElement.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.switchTab(button.dataset.tab);
      });
    });
    
    // API key form
    const apiKeyForm = this.modalElement.querySelector('#api-key-form');
    apiKeyForm.addEventListener('submit', (e) => this.handleApiKeyLogin(e));
    
    // Wallet button
    const walletButton = this.modalElement.querySelector('.wallet-button');
    walletButton.addEventListener('click', () => this.handleWalletConnect());
    
    // Guest button
    const guestButton = this.modalElement.querySelector('.guest-button');
    guestButton.addEventListener('click', () => this.handleGuestLogin());
    
    // Set initial state
    this.switchTab(this.activeTab);
    if (this.error) {
      this.setError(this.error);
    }
  }
}

/**
 * Create and show a login modal
 * @param {Object} options - Modal options
 * @param {Function} options.onLogin - Callback function called after successful login
 * @param {Function} options.onCancel - Callback function called when login is cancelled
 * @param {Object} options.apiService - Session API service for authentication requests
 * @returns {LoginModal} - The created login modal instance
 */
function showLoginModal(options = {}) {
  const modal = new LoginModal(options);
  modal.show();
  return modal;
}

// Export both the class and the convenience function
if (typeof module !== 'undefined') {
  module.exports = {
    LoginModal,
    showLoginModal
  };
} 