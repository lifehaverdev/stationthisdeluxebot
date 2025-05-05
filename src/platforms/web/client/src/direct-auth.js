/**
 * Direct Auth Implementation for StationThis
 * This is a completely standalone implementation that bypasses
 * the component system entirely to ensure it works reliably.
 */

(function() {
  // Create and append auth modal on page load
  document.addEventListener('DOMContentLoaded', function() {
    console.log('Direct auth initializing...');
    
    // Create modal element
    const modalEl = document.createElement('div');
    modalEl.id = 'direct-auth-modal';
    modalEl.style.position = 'fixed';
    modalEl.style.top = '0';
    modalEl.style.left = '0';
    modalEl.style.width = '100%';
    modalEl.style.height = '100%';
    modalEl.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    modalEl.style.display = 'flex';
    modalEl.style.justifyContent = 'center';
    modalEl.style.alignItems = 'center';
    modalEl.style.zIndex = '10000';
    
    // Create modal content
    modalEl.innerHTML = `
      <div style="width: 400px; background-color: #1e1e1e; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);">
        <div style="padding: 1.5rem; background-color: #121212; text-align: center;">
          <h2 style="margin: 0; color: #90caf9; font-size: 1.8rem;">StationThis Authentication</h2>
        </div>
        
        <div id="direct-auth-tabs" style="display: flex; border-bottom: 1px solid #333;">
          <button data-tab="login" style="flex: 1; padding: 0.8rem; background: none; border: none; color: #f5f5f5; cursor: pointer; opacity: 1; border-bottom: 2px solid #90caf9;">Login</button>
          <button data-tab="wallet" style="flex: 1; padding: 0.8rem; background: none; border: none; color: #f5f5f5; cursor: pointer; opacity: 0.6;">Wallet</button>
          <button data-tab="guest" style="flex: 1; padding: 0.8rem; background: none; border: none; color: #f5f5f5; cursor: pointer; opacity: 0.6;">Guest</button>
        </div>
        
        <div style="padding: 1.5rem;">
          <!-- Login Form -->
          <div id="login-panel" style="display: block;">
            <div style="margin-bottom: 1.2rem;">
              <label style="display: block; margin-bottom: 0.5rem; color: #f5f5f5;">Email</label>
              <input id="direct-email" type="email" placeholder="Enter your email" style="width: 100%; padding: 0.7rem; background-color: #333; border: 1px solid #444; border-radius: 4px; color: #f5f5f5;">
            </div>
            <div style="margin-bottom: 1.2rem;">
              <label style="display: block; margin-bottom: 0.5rem; color: #f5f5f5;">Password</label>
              <input id="direct-password" type="password" placeholder="Enter your password" style="width: 100%; padding: 0.7rem; background-color: #333; border: 1px solid #444; border-radius: 4px; color: #f5f5f5;">
            </div>
            <button id="direct-login-btn" style="width: 100%; padding: 0.8rem; background-color: #2979ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Login</button>
          </div>
          
          <!-- Wallet Panel -->
          <div id="wallet-panel" style="display: none; text-align: center;">
            <p style="margin-bottom: 1.5rem; opacity: 0.8;">Connect your crypto wallet to continue</p>
            <button id="direct-wallet-btn" style="width: 100%; padding: 0.8rem; background-color: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Connect Wallet</button>
          </div>
          
          <!-- Guest Panel -->
          <div id="guest-panel" style="display: none; text-align: center;">
            <p style="margin-bottom: 1.5rem; opacity: 0.8;">Continue as a guest to try StationThis</p>
            <button id="direct-guest-btn" style="width: 100%; padding: 0.8rem; background-color: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue as Guest</button>
          </div>
        </div>
      </div>
    `;
    
    // Add to document
    document.body.appendChild(modalEl);
    console.log('Direct auth modal added to DOM');
    
    // Get references to panels from the modal element
    const loginPanel = modalEl.querySelector('#login-panel');
    const walletPanel = modalEl.querySelector('#wallet-panel');
    const guestPanel = modalEl.querySelector('#guest-panel');
    
    const panels = {
      'login': loginPanel,
      'wallet': walletPanel,
      'guest': guestPanel
    };
    
    // Set up tab switching
    const tabs = modalEl.querySelectorAll('#direct-auth-tabs button');
    tabs.forEach(tab => {
      tab.addEventListener('click', function() {
        console.log('Tab clicked:', tab.getAttribute('data-tab'));
        
        // Update tab styles
        tabs.forEach(t => {
          t.style.opacity = '0.6';
          t.style.borderBottom = 'none';
        });
        tab.style.opacity = '1';
        tab.style.borderBottom = '2px solid #90caf9';
        
        // Show correct panel
        const tabName = tab.getAttribute('data-tab');
        
        // Hide all panels
        if (loginPanel) loginPanel.style.display = 'none';
        if (walletPanel) walletPanel.style.display = 'none';
        if (guestPanel) guestPanel.style.display = 'none';
        
        // Show the selected panel
        if (panels[tabName]) {
          panels[tabName].style.display = 'block';
        }
      });
    });
    
    // Set up login button
    const loginBtn = modalEl.querySelector('#direct-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', function() {
        const email = modalEl.querySelector('#direct-email').value;
        const password = modalEl.querySelector('#direct-password').value;
        
        if (!email || !password) {
          alert('Please enter both email and password');
          return;
        }
        
        console.log('Direct login with:', email);
        completeAuth('login', { email });
      });
    }
    
    // Set up wallet button
    const walletBtn = modalEl.querySelector('#direct-wallet-btn');
    if (walletBtn) {
      walletBtn.addEventListener('click', function() {
        console.log('Direct wallet connect');
        walletBtn.textContent = 'Connecting...';
        
        setTimeout(() => {
          const address = '0x' + Math.random().toString(16).slice(2, 10);
          completeAuth('wallet', { address });
        }, 1500);
      });
    }
    
    // Set up guest button
    const guestBtn = modalEl.querySelector('#direct-guest-btn');
    if (guestBtn) {
      guestBtn.addEventListener('click', function() {
        console.log('Direct guest access');
        completeAuth('guest', { guestId: `guest-${Date.now()}` });
      });
    }
    
    // Function to handle auth completion
    function completeAuth(method, data) {
      console.log(`Direct auth completed via ${method}:`, data);
      
      // Hide the modal
      modalEl.style.display = 'none';
      
      // Dispatch the event for the original system
      const customEvent = new CustomEvent('auth:authenticated', { 
        detail: { user: { ...data, type: method } }
      });
      window.dispatchEvent(customEvent);
    }
    
    // Keep the modal in DOM and visible 
    function ensureVisibility() {
      if (!document.body.contains(modalEl)) {
        console.log('Direct auth modal was removed, re-adding');
        document.body.appendChild(modalEl);
      }
    }
    
    // Set up observers to keep modal visible
    const observer = new MutationObserver(ensureVisibility);
    observer.observe(document.body, { childList: true });
    
    // Periodically check if modal is in the DOM
    const interval = setInterval(ensureVisibility, 500);
    
    // Clean up interval if page is unloaded
    window.addEventListener('beforeunload', function() {
      clearInterval(interval);
    });
  });
})(); 