// src/platforms/web/client/src/sandbox/components/ReauthModal.js
// Full-featured re-authentication modal that matches the landing page login
// UI and supports wallet connect, API key, and username/password flows.
// Opens on-demand inside the sandbox so the workspace remains intact.

(function () {
  // Prevent double-init
  if (window.openReauthModal) return;

  const state = { isOpen: false };

  /* ----------------- CSRF Helpers ----------------- */
  async function getCsrf() {
    if (window.auth?.ensureCsrfToken) return window.auth.ensureCsrfToken();
    const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await res.json();
    return data.csrfToken;
  }
  async function postWithCsrf(url, body) {
    const token = await getCsrf();
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  }
  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
  function hideError(el) {
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  /* -------- Dynamically load ethers library if needed -------- */
  async function ensureEthers() {
    if (window.ethers) return;
    return new Promise((resolve, reject) => {
      // Avoid duplicating script tags
      const existing = document.querySelector('script[data-ethers]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', () => reject(new Error('Failed to load wallet library.')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js';
      script.async = true;
      script.setAttribute('data-ethers', 'true');
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load wallet library.'));
      document.head.appendChild(script);
    });
  }

  /* ----------------- Wallet Connect ----------------- */
  async function walletConnectFlow(errorDiv, onSuccess) {
    if (typeof window.ethereum === 'undefined') {
      showError(errorDiv, 'Please install MetaMask!');
      return;
    }

    // Ensure ethers is available
    try {
      await ensureEthers();
    } catch (loadErr) {
      showError(errorDiv, loadErr.message);
      return;
    }

    if (!window.ethers) {
      showError(errorDiv, 'Wallet library not loaded.');
      return;
    }

    try {
      const provider = new window.ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      // 1. Nonce
      const nonceRes = await postWithCsrf('/api/v1/auth/web3/nonce', { address });
      if (!nonceRes.ok) {
        const err = await nonceRes.json();
        throw new Error(err.error?.message || 'Failed to get nonce.');
      }
      const { nonce } = await nonceRes.json();

      // 2. Sign
      const signature = await signer.signMessage(nonce);

      // 3. Verify
      const verifyRes = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });
      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error?.message || 'Signature verification failed.');
      }

      hideError(errorDiv);
      onSuccess();
    } catch (err) {
      console.error('[ReauthModal] wallet connect error:', err);
      showError(errorDiv, err.message || 'Wallet connection failed.');
    }
  }

  /* ----------------- Modal HTML ----------------- */
  const modalHTML = `
  <div id="reauth-login-modal" class="modal-overlay" style="display:none;">
    <div class="modal-content panel">
      <button class="modal-close">&times;</button>
      <h2>Connect to Continue</h2>
      <div class="modal-body">
        <div id="initial-auth-options">
          <button class="btn btn-primary btn-wallet">Connect Wallet</button>
          <div class="alternative-logins">
            <a href="#" id="show-password-login">Login with Username/Password</a>
            <span>&nbsp;or&nbsp;</span>
            <a href="#" id="show-apikey-login">Use an API Key</a>
          </div>
        </div>

        <form id="password-login-form" class="auth-form" style="display:none;">
          <div class="form-error" style="display:none;"></div>
          <input type="text" name="username" placeholder="Username" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit" class="btn btn-primary">Login</button>
          <a href="#" class="back-to-options">&larr; Back</a>
        </form>

        <form id="apikey-login-form" class="auth-form" style="display:none;">
          <div class="form-error" style="display:none;"></div>
          <input type="text" name="apikey" placeholder="API Key" required>
          <button type="submit" class="btn btn-primary">Login</button>
          <a href="#" class="back-to-options">&larr; Back</a>
        </form>
      </div>
    </div>
  </div>`;

  /* ----------------- Init / Event Wiring ----------------- */
  function attachLogic(modal) {
    const initialOpts = modal.querySelector('#initial-auth-options');
    const passwordForm = modal.querySelector('#password-login-form');
    const apikeyForm = modal.querySelector('#apikey-login-form');
    const showPw = modal.querySelector('#show-password-login');
    const showKey = modal.querySelector('#show-apikey-login');
    const backLinks = modal.querySelectorAll('.back-to-options');
    const walletBtn = modal.querySelector('.btn-wallet');
    const closeBtn = modal.querySelector('.modal-close');

    // Toggle views
    showPw.addEventListener('click', (e) => {
      e.preventDefault();
      initialOpts.style.display = 'none';
      passwordForm.style.display = 'block';
    });
    showKey.addEventListener('click', (e) => {
      e.preventDefault();
      initialOpts.style.display = 'none';
      apikeyForm.style.display = 'block';
    });
    backLinks.forEach((lnk) => lnk.addEventListener('click', (e) => {
      e.preventDefault();
      passwordForm.style.display = 'none';
      apikeyForm.style.display = 'none';
      initialOpts.style.display = 'block';
    }));

    // Close handlers
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Wallet connect
    const walletErrDiv = document.createElement('div');
    walletErrDiv.className = 'form-error';
    walletErrDiv.style.display = 'none';
    initialOpts.appendChild(walletErrDiv);
    walletBtn.addEventListener('click', () => walletConnectFlow(walletErrDiv, onAuthSuccess));

    // Password login
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errDiv = passwordForm.querySelector('.form-error');
      hideError(errDiv);
      const username = passwordForm.querySelector('input[name="username"]').value;
      const password = passwordForm.querySelector('input[name="password"]').value;
      try {
        const res = await postWithCsrf('/api/v1/auth/password', { username, password });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || 'Password login failed.');
        }
        onAuthSuccess();
      } catch (err) {
        showError(errDiv, err.message);
      }
    });

    // API key login
    apikeyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errDiv = apikeyForm.querySelector('.form-error');
      hideError(errDiv);
      const apikey = apikeyForm.querySelector('input[name="apikey"]').value;
      try {
        const res = await postWithCsrf('/api/v1/auth/apikey', { apikey });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || 'API key login failed.');
        }
        onAuthSuccess();
      } catch (err) {
        showError(errDiv, err.message);
      }
    });
  }

  function onAuthSuccess() {
    if (window.auth?.resetCsrfToken) window.auth.resetCsrfToken();
    closeModal();
    window.dispatchEvent(new CustomEvent('reauth-success'));
  }

  /* ----------------- Public API ----------------- */
  function openModal() {
    if (state.isOpen) return;
    state.isOpen = true;
    window.__reauthModalOpen__ = true;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('reauth-login-modal');
    modal.style.display = 'flex';
    attachLogic(modal);
  }
  function closeModal() {
    const modal = document.getElementById('reauth-login-modal');
    if (!modal) return;
    modal.parentNode.removeChild(modal);
    state.isOpen = false;
    window.__reauthModalOpen__ = false;
  }

  window.openReauthModal = openModal;
})(); 