/**
 * Simplified Auth Modal Implementation for StationThis
 * 
 * This is a standalone implementation of the auth modal that doesn't rely on
 * the complex component system. It can be used for testing and as a fallback.
 */

// Create and append the auth modal to the document body
function initializeAuthModal() {
  console.log('Initializing simplified auth modal');
  
  // Check if modal already exists to avoid duplicates
  const existingModal = document.getElementById('auth-modal');
  if (existingModal) {
    return existingModal;
  }
  
  // Create modal container
  const modalContainer = document.createElement('div');
  modalContainer.id = 'auth-modal';
  modalContainer.className = 'auth-modal';
  
  // Add modal HTML
  modalContainer.innerHTML = `
    <div class="auth-modal-content">
      <div class="auth-modal-header">
        <h2>StationThis Authentication</h2>
      </div>
      
      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login">Login</button>
        <button class="auth-tab" data-tab="wallet">Connect Wallet</button>
        <button class="auth-tab" data-tab="guest">Guest</button>
      </div>
      
      <div class="auth-content">
        <!-- Login Tab -->
        <div class="tab-pane active" id="login-tab">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" placeholder="Enter your email">
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Enter your password">
          </div>
          <button class="btn btn-login">Login</button>
        </div>
        
        <!-- Wallet Tab -->
        <div class="tab-pane" id="wallet-tab">
          <div class="wallet-options">
            <p>Connect your crypto wallet to continue</p>
            <button class="btn wallet-btn">Connect Wallet</button>
          </div>
        </div>
        
        <!-- Guest Tab -->
        <div class="tab-pane" id="guest-tab">
          <div class="guest-options">
            <p>Continue as a guest to try StationThis</p>
            <button class="btn guest-btn">Continue as Guest</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Append to body
  document.body.appendChild(modalContainer);
  
  // Make sure it's not removed by other scripts
  protectAuthModalFromRemoval(modalContainer);
  
  // Add event listeners
  attachEventListeners(modalContainer);
  
  return modalContainer;
}

// Protect the auth modal from being removed by other scripts
function protectAuthModalFromRemoval(modalElement) {
  // Use MutationObserver to detect if the modal is removed and re-add it
  const observer = new MutationObserver(function(mutations) {
    const authModal = document.getElementById('auth-modal');
    if (!authModal) {
      console.log('Auth modal was removed, re-adding it');
      document.body.appendChild(modalElement);
    }
  });
  
  // Observe the parent for removal of children
  observer.observe(document.body, { 
    childList: true,
    subtree: false
  });
  
  // Also set a periodic check as backup
  setInterval(function() {
    const authModal = document.getElementById('auth-modal');
    if (!authModal) {
      console.log('Auth modal was removed (interval check), re-adding it');
      document.body.appendChild(modalElement);
    }
  }, 500);
}

// Attach event listeners to the auth modal
function attachEventListeners(modalElement) {
  // Tab switching
  const tabs = modalElement.querySelectorAll('.auth-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and panes
      modalElement.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      modalElement.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Show corresponding tab pane
      const tabId = tab.getAttribute('data-tab');
      const pane = modalElement.querySelector(`#${tabId}-tab`);
      if (pane) pane.classList.add('active');
    });
  });
  
  // Login button
  const loginBtn = modalElement.querySelector('.btn-login');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      const email = modalElement.querySelector('#email').value;
      const password = modalElement.querySelector('#password').value;
      
      if (!email || !password) {
        showError(modalElement, 'Please enter both email and password');
        return;
      }
      
      console.log('Logging in with:', { email });
      // Simulate login success
      completeAuth(modalElement, { type: 'login', email });
    });
  }
  
  // Wallet button
  const walletBtn = modalElement.querySelector('.wallet-btn');
  if (walletBtn) {
    walletBtn.addEventListener('click', () => {
      console.log('Connecting wallet');
      // Simulate wallet connection
      walletBtn.textContent = 'Connecting...';
      
      setTimeout(() => {
        const walletAddress = '0x' + Math.random().toString(16).slice(2, 10);
        completeAuth(modalElement, { type: 'wallet', walletAddress });
      }, 1500);
    });
  }
  
  // Guest button
  const guestBtn = modalElement.querySelector('.guest-btn');
  if (guestBtn) {
    guestBtn.addEventListener('click', () => {
      console.log('Continuing as guest');
      const guestId = 'guest-' + Date.now();
      completeAuth(modalElement, { type: 'guest', guestId });
    });
  }
}

// Show error message in the modal
function showError(modalElement, message) {
  // Remove any existing error
  const existingError = modalElement.querySelector('.auth-error');
  if (existingError) existingError.remove();
  
  // Create error element
  const errorEl = document.createElement('div');
  errorEl.className = 'auth-error';
  errorEl.textContent = message;
  
  // Insert at top of content
  const content = modalElement.querySelector('.auth-content');
  if (content) {
    content.insertBefore(errorEl, content.firstChild);
  }
}

// Complete authentication and close modal
function completeAuth(modalElement, userData) {
  // Get modal if not provided
  if (!modalElement) {
    modalElement = document.getElementById('auth-modal');
  }
  
  // Send auth event
  const authEvent = new CustomEvent('auth:authenticated', { 
    detail: { user: userData }
  });
  window.dispatchEvent(authEvent);
  
  // Hide modal
  if (modalElement) {
    modalElement.classList.remove('visible');
  }
  
  console.log('Authentication completed:', userData);
}

// Show the auth modal
function showAuthModal(options = {}) {
  let modalElement = document.getElementById('auth-modal');
  
  // Create modal if it doesn't exist
  if (!modalElement) {
    modalElement = initializeAuthModal();
  }
  
  // Set initial tab if specified
  if (options.initialTab) {
    const tab = modalElement.querySelector(`.auth-tab[data-tab="${options.initialTab}"]`);
    if (tab) {
      tab.click();
    }
  }
  
  // Show the modal
  modalElement.classList.add('visible');
  
  // Ensure it's added back to the DOM if it was removed
  if (!document.body.contains(modalElement)) {
    document.body.appendChild(modalElement);
  }
}

// Initialize auth system
function initAuth() {
  // Listen for show modal event
  window.addEventListener('auth:show-modal', (event) => {
    showAuthModal(event.detail || {});
  });
  
  // Listen for direct wallet connection
  window.addEventListener('auth:wallet', () => {
    showAuthModal({ initialTab: 'wallet' });
  });
  
  // Listen for direct guest access
  window.addEventListener('auth:guest', (event) => {
    const guestId = event.detail?.guestId || ('guest-' + Date.now());
    completeAuth(null, { type: 'guest', guestId });
  });
  
  console.log('Auth system initialized');
}

// Run initialization when the DOM is loaded
document.addEventListener('DOMContentLoaded', initAuth);

// Export functions for direct use
window.StationThisAuth = {
  show: showAuthModal,
  init: initAuth
}; 