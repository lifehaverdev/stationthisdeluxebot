// src/platforms/web/client/src/sandbox/components/ReauthModal.js
// Full-featured re-authentication modal that matches the landing page login
// UI and supports wallet connect, API key, and username/password flows.
// Opens on-demand inside the sandbox so the workspace remains intact.

(function () {
  /* --------------------------------------------------------- */
  /*  Scoped styles so only the modal adopts landing aesthetics */
  /* --------------------------------------------------------- */
  function injectScopedStyles() {
    if (document.getElementById('reauth-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'reauth-modal-styles';
    style.textContent = `
      /* Overlay */
      #reauth-login-modal.modal-overlay {
        position: fixed;
        top: 0;left: 0;width: 100%;height: 100%;
        background-color: rgba(0,0,0,0.6);
        display: flex;justify-content: center;align-items: center;
        z-index: 1000;
        backdrop-filter: blur(8px);
        visibility: hidden;opacity: 0;
        transition: visibility 0s 0.3s, opacity 0.3s;
      }
      #reauth-login-modal.modal-overlay.is-visible {
        visibility: visible;opacity: 1;transition: opacity 0.3s;
      }

      /* Panel & content */
      #reauth-login-modal .panel {
        background-color: rgba(255,255,255,0.4);
        border:1px solid #000;border-radius:12px;
        padding: var(--space-8,32px);
        max-width:500px;
        color:#000;
      }

      #reauth-login-modal .modal-close {
        position:absolute;top:var(--space-2,8px);right:var(--space-4,16px);
        background:none;border:none;font-size:2em;color:var(--color-steel-text,#333);cursor:pointer;
      }
      #reauth-login-modal .modal-body {display:flex;flex-direction:column;gap:var(--space-6,24px);text-align:center;}

      #reauth-login-modal .btn-wallet {padding:var(--space-5,20px)var(--space-8,32px);font-size:1.2em;}

      /* Hide alt logins same as landing */
      #reauth-login-modal .alternative-logins,
      #reauth-login-modal #password-login-form,
      #reauth-login-modal #apikey-login-form {display:none !important;}
    `;
    document.head.appendChild(style);
  }

  injectScopedStyles();
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
  // Modal markup copied from public/landing.html (#login-modal) so styling is identical
  const modalHTML = `
  <div id="reauth-login-modal" class="modal-overlay">
    <div class="modal-content panel">
      <button class="modal-close">&times;</button>
      <h2>Connect your Ethereum Wallet</h2>
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
    // Show with same transition class as landing page
    requestAnimationFrame(() => {
      modal.classList.add('is-visible');
    });
    attachLogic(modal);
  }
  function closeModal() {
    const modal = document.getElementById('reauth-login-modal');
    if (!modal) return;
    // Fade out then remove for smooth UX
    modal.classList.remove('is-visible');
    setTimeout(() => {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }, 300);
    state.isOpen = false;
    window.__reauthModalOpen__ = false;
  }

  window.openReauthModal = openModal;
})(); 