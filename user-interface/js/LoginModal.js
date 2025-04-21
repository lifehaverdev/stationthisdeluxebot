/**
 * Login Modal Component
 * Vanilla JS class for a login modal with multiple authentication options
 */
class LoginModal {
  /**
   * Create a new login modal
   * @param {Object} options - Modal options
   * @param {function} options.onLogin - Callback when user logs in successfully
   * @param {function} options.onCancel - Callback when user cancels login
   * @param {SessionApiService} options.apiService - Session API service instance
   */
  constructor(options = {}) {
    this.onLogin = options.onLogin || function() {};
    this.onCancel = options.onCancel || function() {};
    this.apiService = options.apiService;
    
    // Internal state
    this.modalElement = null;
    this.activeTab = 'api-key';
    this.isLoading = false;
    this.walletAddress = null;
    this.walletNonce = null;
    
    // Container element
    this.container = document.getElementById('modal-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'modal-container';
      document.body.appendChild(this.container);
    }
    
    // Create the modal structure
    this.createModal();
  }
  
  /**
   * Create modal DOM structure
   */
  createModal() {
    const modal = document.createElement('div');
    modal.className = 'login-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Connect to StationThis</h2>
          <button class="close-button">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="tabs">
            <button class="tab-button active" data-tab="api-key">API Key</button>
            <button class="tab-button" data-tab="wallet">Connect Wallet</button>
            <button class="tab-button" data-tab="guest">Guest Access</button>
          </div>
          
          <div class="tab-content active" id="api-key-tab">
            <form id="api-key-form">
              <div class="form-group">
                <label for="api-key-input">API Key</label>
                <input type="password" id="api-key-input" placeholder="Enter your API key">
                <div class="form-text">Enter the API key provided for accessing StationThis.</div>
              </div>
              <div class="error-message" style="display: none;"></div>
              <button type="submit" class="submit-button">
                <span class="button-text">Connect</span>
                <div class="spinner" style="display: none;"></div>
              </button>
            </form>
          </div>
          
          <div class="tab-content" id="wallet-tab">
            <div class="wallet-connection">
              <p>Connect your wallet to access StationThis with your blockchain credentials.</p>
              <button class="wallet-button">
                <span class="button-text">Connect Wallet</span>
                <div class="spinner" style="display: none;"></div>
              </button>
              <div class="small-text">
                You'll be asked to sign a message to verify wallet ownership.
              </div>
              <div class="error-message" style="display: none;"></div>
            </div>
          </div>
          
          <div class="tab-content" id="guest-tab">
            <div class="guest-access">
              <p>Access StationThis without logging in. Limited functionality available.</p>
              <button class="guest-button">
                <span class="button-text">Continue as Guest</span>
                <div class="spinner" style="display: none;"></div>
              </button>
              <div class="small-text">
                Guest sessions expire after 24 hours and have limited capabilities.
              </div>
              <div class="error-message" style="display: none;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Store reference to modal element
    this.modalElement = modal;
    
    // Add event listeners
    this.addEventListeners();
    
    // Append to container
    this.container.appendChild(modal);
  }
  
  /**
   * Add event listeners to modal elements
   */
  addEventListeners() {
    // Tab switching
    const tabButtons = this.modalElement.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.switchTab(button.dataset.tab);
      });
    });
    
    // Close button
    const closeButton = this.modalElement.querySelector('.close-button');
    closeButton.addEventListener('click', () => {
      this.hide();
      this.onCancel();
    });
    
    // Modal overlay (clicking outside modal)
    const overlay = this.modalElement.querySelector('.modal-overlay');
    overlay.addEventListener('click', () => {
      this.hide();
      this.onCancel();
    });
    
    // API Key form submission
    const apiKeyForm = this.modalElement.querySelector('#api-key-form');
    apiKeyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleApiKeyLogin();
    });
    
    // Wallet connection
    const walletButton = this.modalElement.querySelector('.wallet-button');
    walletButton.addEventListener('click', () => {
      this.handleWalletLogin();
    });
    
    // Guest access
    const guestButton = this.modalElement.querySelector('.guest-button');
    guestButton.addEventListener('click', () => {
      this.handleGuestLogin();
    });
  }
  
  /**
   * Switch between tabs
   * @param {string} tabId - ID of tab to switch to
   */
  switchTab(tabId) {
    // Update active tab
    this.activeTab = tabId;
    
    // Update tab buttons
    const tabButtons = this.modalElement.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      if (button.dataset.tab === tabId) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
    
    // Update tab content
    const tabContents = this.modalElement.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
      if (content.id === `${tabId}-tab`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }
  
  /**
   * Handle API key login
   */
  async handleApiKeyLogin() {
    if (this.isLoading) return;
    
    const apiKeyInput = this.modalElement.querySelector('#api-key-input');
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      this.showError('api-key', 'Please enter your API key');
      return;
    }
    
    this.setLoading('api-key', true);
    
    try {
      const response = await this.apiService.validateApiKey(apiKey);
      
      if (response.success) {
        this.handleLoginSuccess({
          apiKey: apiKey,
          session: response.session
        });
      } else {
        this.showError('api-key', response.error || 'Invalid API key');
      }
    } catch (error) {
      this.showError('api-key', 'Error validating API key. Please try again.');
      console.error('API key validation error:', error);
    }
    
    this.setLoading('api-key', false);
  }
  
  /**
   * Handle wallet login
   */
  async handleWalletLogin() {
    if (this.isLoading) return;
    
    this.setLoading('wallet', true);
    
    try {
      // Check if wallet is available
      if (typeof window.ethereum === 'undefined') {
        this.showError('wallet', 'No Ethereum wallet detected. Please install MetaMask or another wallet.');
        this.setLoading('wallet', false);
        return;
      }
      
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) {
        this.showError('wallet', 'Could not access your wallet. Please try again.');
        this.setLoading('wallet', false);
        return;
      }
      
      // Get wallet address
      this.walletAddress = accounts[0];
      
      // Get nonce for signing
      const nonceResponse = await this.apiService.generateNonce(this.walletAddress);
      if (!nonceResponse.success) {
        this.showError('wallet', nonceResponse.error || 'Failed to generate authentication challenge.');
        this.setLoading('wallet', false);
        return;
      }
      
      this.walletNonce = nonceResponse.nonce;
      
      // Create message to sign
      const message = `Sign this message to authenticate with StationThis: ${this.walletNonce}`;
      
      // Request signature
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, this.walletAddress]
      });
      
      // Validate signature with server
      const validationResponse = await this.apiService.validateWallet({
        walletAddress: this.walletAddress,
        signature: signature,
        nonce: this.walletNonce
      });
      
      if (validationResponse.success) {
        this.handleLoginSuccess({
          walletAddress: this.walletAddress,
          session: validationResponse.session
        });
      } else {
        this.showError('wallet', validationResponse.error || 'Failed to authenticate wallet');
      }
    } catch (error) {
      console.error('Wallet login error:', error);
      let errorMessage = 'Error connecting wallet. Please try again.';
      
      // Handle specific errors
      if (error.code === 4001) {
        errorMessage = 'You rejected the signature request. Please try again.';
      }
      
      this.showError('wallet', errorMessage);
    }
    
    this.setLoading('wallet', false);
  }
  
  /**
   * Handle guest login
   */
  async handleGuestLogin() {
    if (this.isLoading) return;
    
    this.setLoading('guest', true);
    
    try {
      const response = await this.apiService.createGuestSession();
      
      if (response.success) {
        this.handleLoginSuccess({
          isGuest: true,
          session: response.session
        });
      } else {
        this.showError('guest', response.error || 'Failed to create guest session');
      }
    } catch (error) {
      this.showError('guest', 'Error creating guest session. Please try again.');
      console.error('Guest login error:', error);
    }
    
    this.setLoading('guest', false);
  }
  
  /**
   * Handle successful login
   * @param {Object} loginData - Login data
   */
  handleLoginSuccess(loginData) {
    this.hide();
    this.onLogin(loginData);
  }
  
  /**
   * Show error message in current tab
   * @param {string} tabId - ID of tab to show error in
   * @param {string} message - Error message to display
   */
  showError(tabId, message) {
    const errorElement = this.modalElement.querySelector(`#${tabId}-tab .error-message`);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
  }
  
  /**
   * Set loading state for a tab
   * @param {string} tabId - ID of tab to set loading state for
   * @param {boolean} isLoading - Whether tab is loading
   */
  setLoading(tabId, isLoading) {
    this.isLoading = isLoading;
    
    let button, spinner, buttonText;
    
    if (tabId === 'api-key') {
      button = this.modalElement.querySelector('#api-key-form .submit-button');
      spinner = this.modalElement.querySelector('#api-key-form .spinner');
      buttonText = this.modalElement.querySelector('#api-key-form .button-text');
    } else if (tabId === 'wallet') {
      button = this.modalElement.querySelector('.wallet-button');
      spinner = this.modalElement.querySelector('.wallet-button .spinner');
      buttonText = this.modalElement.querySelector('.wallet-button .button-text');
    } else if (tabId === 'guest') {
      button = this.modalElement.querySelector('.guest-button');
      spinner = this.modalElement.querySelector('.guest-button .spinner');
      buttonText = this.modalElement.querySelector('.guest-button .button-text');
    }
    
    if (button && spinner && buttonText) {
      if (isLoading) {
        button.disabled = true;
        spinner.style.display = 'inline-block';
        buttonText.style.visibility = 'hidden';
      } else {
        button.disabled = false;
        spinner.style.display = 'none';
        buttonText.style.visibility = 'visible';
      }
    }
  }
  
  /**
   * Show the modal
   */
  show() {
    if (this.modalElement) {
      this.modalElement.style.display = 'block';
      document.body.classList.add('modal-open');
    }
  }
  
  /**
   * Hide the modal
   */
  hide() {
    if (this.modalElement) {
      this.modalElement.style.display = 'none';
      document.body.classList.remove('modal-open');
    }
  }
}

// Make available in both Node.js and browser environments
if (typeof module !== 'undefined') {
  module.exports = LoginModal;
} else if (typeof window !== 'undefined') {
  window.LoginModal = LoginModal;
} 