// Auth Modal Component for the StationThis web interface
// Provides options for login, wallet connection, and guest access

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';
import { authService } from '../../services/AuthService.js';

export class AuthModalComponent extends Component {
  constructor(parentElement) {
    super(parentElement);
    
    this.state = {
      isVisible: true,
      activeTab: 'login', // login, wallet, guest
      username: '',
      password: '',
      isLoading: false,
      error: null
    };
    
    // Bind methods
    this.handleTabChange = this.handleTabChange.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
    this.handleLogin = this.handleLogin.bind(this);
    this.handleWalletConnect = this.handleWalletConnect.bind(this);
    this.handleGuestAccess = this.handleGuestAccess.bind(this);
    this.handleAuthError = this.handleAuthError.bind(this);
    this.handleAuthSuccess = this.handleAuthSuccess.bind(this);
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    
    // Initialize the modal
    this.init();
    
    // Subscribe to auth events
    EventBus.subscribe('auth:error', this.handleAuthError);
    EventBus.subscribe('auth:authenticated', this.handleAuthSuccess);
  }
  
  template() {
    return `
      <div class="auth-modal ${this.state.isVisible ? 'visible' : 'hidden'}">
        <div class="auth-modal-content">
          <div class="auth-modal-header">
            <h2>StationThis</h2>
          </div>
          
          ${this.state.error ? `<div class="auth-error">${this.state.error}</div>` : ''}
          
          <div class="auth-tabs">
            <button class="auth-tab ${this.state.activeTab === 'login' ? 'active' : ''}" data-tab="login" ${this.state.isLoading ? 'disabled' : ''}>Login</button>
            <button class="auth-tab ${this.state.activeTab === 'wallet' ? 'active' : ''}" data-tab="wallet" ${this.state.isLoading ? 'disabled' : ''}>Connect Wallet</button>
            <button class="auth-tab ${this.state.activeTab === 'guest' ? 'active' : ''}" data-tab="guest" ${this.state.isLoading ? 'disabled' : ''}>Guest</button>
          </div>
          
          <div class="auth-tab-content">
            <!-- Login Tab -->
            <div class="tab-pane ${this.state.activeTab === 'login' ? 'active' : ''}" data-tab="login">
              <form class="login-form">
                <div class="form-group">
                  <label for="username">Username</label>
                  <input 
                    type="text" 
                    id="username" 
                    name="username" 
                    value="${this.state.username}" 
                    placeholder="Enter your username"
                    ${this.state.isLoading ? 'disabled' : ''}
                  />
                </div>
                <div class="form-group">
                  <label for="password">Password</label>
                  <input 
                    type="password" 
                    id="password" 
                    name="password" 
                    value="${this.state.password}" 
                    placeholder="Enter your password"
                    ${this.state.isLoading ? 'disabled' : ''}
                  />
                </div>
                <button 
                  type="button" 
                  class="btn login-btn"
                  ${this.state.isLoading ? 'disabled' : ''}
                >
                  ${this.state.isLoading && this.state.activeTab === 'login' ? 'Logging in...' : 'Login'}
                </button>
              </form>
            </div>
            
            <!-- Wallet Tab -->
            <div class="tab-pane ${this.state.activeTab === 'wallet' ? 'active' : ''}" data-tab="wallet">
              <div class="wallet-options">
                <p>Connect your cryptocurrency wallet to access your account.</p>
                <button 
                  type="button" 
                  class="btn wallet-btn"
                  ${this.state.isLoading ? 'disabled' : ''}
                >
                  ${this.state.isLoading && this.state.activeTab === 'wallet' ? 'Connecting...' : 'Connect Wallet'}
                </button>
              </div>
            </div>
            
            <!-- Guest Tab -->
            <div class="tab-pane ${this.state.activeTab === 'guest' ? 'active' : ''}" data-tab="guest">
              <div class="guest-options">
                <p>Continue as a guest to explore StationThis. Limited features available.</p>
                <button 
                  type="button" 
                  class="btn guest-btn"
                  ${this.state.isLoading ? 'disabled' : ''}
                >
                  ${this.state.isLoading && this.state.activeTab === 'guest' ? 'Creating guest access...' : 'Continue as Guest'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  init() {
    this.appendToParent();
    
    // Check if already authenticated
    if (authService.isAuthenticated()) {
      this.hide();
      return;
    }
    
    // Add event listeners for tab switching
    const tabButtons = this.element.querySelectorAll('.auth-tab');
    tabButtons.forEach(button => {
      button.addEventListener('click', this.handleTabChange);
    });
    
    // Add event listeners for form inputs
    const inputs = this.element.querySelectorAll('input');
    inputs.forEach(input => {
      input.addEventListener('input', this.handleInputChange);
    });
    
    // Add event listeners for action buttons
    const loginBtn = this.element.querySelector('.login-btn');
    if (loginBtn) loginBtn.addEventListener('click', this.handleLogin);
    
    const walletBtn = this.element.querySelector('.wallet-btn');
    if (walletBtn) walletBtn.addEventListener('click', this.handleWalletConnect);
    
    const guestBtn = this.element.querySelector('.guest-btn');
    if (guestBtn) guestBtn.addEventListener('click', this.handleGuestAccess);
  }
  
  handleTabChange(e) {
    if (this.state.isLoading) return;
    
    const tabName = e.target.dataset.tab;
    if (tabName) {
      this.setState({ activeTab: tabName, error: null });
    }
  }
  
  handleInputChange(e) {
    const { name, value } = e.target;
    this.setState({ [name]: value });
  }
  
  handleLogin(e) {
    e.preventDefault();
    
    const { username, password } = this.state;
    
    // Basic validation
    if (!username || !password) {
      this.setState({ error: 'Please enter both username and password' });
      return;
    }
    
    this.setState({ isLoading: true, error: null });
    
    // Publish login event for the AuthService to handle
    EventBus.publish('auth:login', {
      username,
      password
    });
  }
  
  handleWalletConnect() {
    this.setState({ isLoading: true, error: null });
    
    // Publish wallet connect event for AuthService to handle
    EventBus.publish('auth:wallet', {});
  }
  
  handleGuestAccess() {
    this.setState({ isLoading: true, error: null });
    
    // Publish guest access event for AuthService to handle
    EventBus.publish('auth:guest', {
      guestId: `guest-${Date.now()}`
    });
  }
  
  handleAuthError(data) {
    this.setState({ 
      isLoading: false,
      error: data.message || 'Authentication failed'
    });
  }
  
  handleAuthSuccess() {
    this.setState({ isLoading: false, error: null });
    this.hide();
  }
  
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }
  
  show() {
    this.setState({ isVisible: true });
  }
  
  hide() {
    this.setState({ isVisible: false });
  }
} 