// CSRF token storage
let csrfToken = null;

// Fetch CSRF token on page load
async function fetchCsrfToken() {
  try {
    const res = await fetch('/api/v1/csrf-token');
    const data = await res.json();
    csrfToken = data.csrfToken;
  } catch (err) {
    console.error('Failed to fetch CSRF token:', err);
  }
}

// Call fetchCsrfToken on DOMContentLoaded
fetchCsrfToken();

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Menu Toggle
  const menuToggle = document.getElementById('menu-toggle');
  const mainNav = document.getElementById('main-nav');
  
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', () => {
      mainNav.classList.toggle('is-open');
    });
  }

  // Modal Logic
  const loginModalTrigger = document.getElementById('login-modal-trigger');
  const loginModal = document.getElementById('login-modal');
  
  if (loginModal) {
    const modalCloseBtn = loginModal.querySelector('.modal-close');

    if (loginModalTrigger && modalCloseBtn) {
      // Show modal on trigger click
      loginModalTrigger.addEventListener('click', () => {
        // Set a cookie to bypass auth for development, then redirect.
        // document.cookie = 'dev_auth_bypass=true; path=/; max-age=3600'; // Expires in 1 hour
        // window.location.href = '/';
        loginModal.classList.add('is-visible');
      });

      // Hide modal on close button click
      modalCloseBtn.addEventListener('click', () => {
        loginModal.classList.remove('is-visible');
      });

      // Hide modal when clicking on the overlay
      loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) {
          loginModal.classList.remove('is-visible');
        }
      });
    }
  }

  // "Show More" for About Section
  const aboutToggle = document.getElementById('about-toggle');
  const expandableAbout = document.getElementById('expandable-about');

  if(aboutToggle && expandableAbout) {
    aboutToggle.addEventListener('click', () => {
      const isExpanded = expandableAbout.classList.contains('expanded');
      if (isExpanded) {
        expandableAbout.classList.remove('expanded');
        aboutToggle.textContent = 'Show More';
      } else {
        expandableAbout.classList.add('expanded');
        aboutToggle.textContent = 'Show Less';
      }
    });
  }

  // Auth Modal UI Logic
  const initialAuthOptions = document.getElementById('initial-auth-options');
  const passwordLoginForm = document.getElementById('password-login-form');
  const apikeyLoginForm = document.getElementById('apikey-login-form');
  const showPasswordLogin = document.getElementById('show-password-login');
  const showApikeyLogin = document.getElementById('show-apikey-login');
  const backLinks = document.querySelectorAll('.back-to-options');

  if (showPasswordLogin) {
      showPasswordLogin.addEventListener('click', (e) => {
          e.preventDefault();
          initialAuthOptions.style.display = 'none';
          passwordLoginForm.style.display = 'block';
      });
  }

  if (showApikeyLogin) {
      showApikeyLogin.addEventListener('click', (e) => {
          e.preventDefault();
          initialAuthOptions.style.display = 'none';
          apikeyLoginForm.style.display = 'block';
      });
  }

  backLinks.forEach(link => {
      link.addEventListener('click', (e) => {
          e.preventDefault();
          initialAuthOptions.style.display = 'block';
          passwordLoginForm.style.display = 'none';
          apikeyLoginForm.style.display = 'none';
      });
  });

  // Wallet Connect Logic
  const connectWalletBtn = document.querySelector('.btn-wallet');
  if (connectWalletBtn) {
    connectWalletBtn.addEventListener('click', async () => {
      if (typeof window.ethereum === 'undefined') {
        alert('Please install MetaMask!');
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        
        // 1. Fetch nonce
        const nonceResponse = await postWithCsrf('/api/v1/auth/web3/nonce', { address });
        
        if (!nonceResponse.ok) {
            const error = await nonceResponse.json();
            throw new Error(error.error.message || 'Failed to get nonce.');
        }

        const { nonce } = await nonceResponse.json();

        // 2. Sign nonce
        const signature = await signer.signMessage(nonce);

        // 3. Verify signature and get JWT
        const verifyResponse = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });

        if (!verifyResponse.ok) {
            const error = await verifyResponse.json();
            throw new Error(error.error.message || 'Signature verification failed.');
        }

        const { token } = await verifyResponse.json();

        // 4. Store JWT and redirect
        localStorage.setItem('jwt', token);
        window.location.href = '/'; // Redirect to the main app

      } catch (error) {
        console.error('Failed to connect wallet:', error);
        alert(`Login failed: ${error.message}`);
      }
    });
  }

  // API Key Login Logic
  if (apikeyLoginForm) {
    const errorDiv = apikeyLoginForm.querySelector('.form-error');

    apikeyLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorDiv.style.display = 'none'; // Hide error on new submission

      const apikey = apikeyLoginForm.querySelector('input[name="apikey"]').value;
      
      try {
        const response = await postWithCsrf('/api/v1/auth/apikey', { apikey });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error.message || 'API key login failed.');
        }

        const { token } = await response.json();
        localStorage.setItem('jwt', token);
        window.location.href = '/';

      } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.style.display = 'block';
      }
    });
  }

  // Password Login Logic
  if (passwordLoginForm) {
    const errorDiv = passwordLoginForm.querySelector('.form-error');

    passwordLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorDiv.style.display = 'none';

      const username = passwordLoginForm.querySelector('input[name="username"]').value;
      const password = passwordLoginForm.querySelector('input[name="password"]').value;

      try {
        const response = await postWithCsrf('/api/v1/auth/password', { username, password });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error.message || 'Password login failed.');
        }

        const { token } = await response.json();
        localStorage.setItem('jwt', token);
        window.location.href = '/';

      } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.style.display = 'block';
      }
    });
  }

  // Example: update POST requests to include CSRF token
  async function postWithCsrf(url, body) {
    if (!csrfToken) await fetchCsrfToken();
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify(body)
    });
  }

  // Replace fetch('/api/v1/auth/web3/verify', ...) with postWithCsrf
  // ...
  // For each POST request, use postWithCsrf instead of fetch
  // ...

  // Example: Web3 login
  async function handleWeb3Login(address, signature) {
    const verifyResponse = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });
    return verifyResponse;
  }

  // Example: API key login
  async function handleApiKeyLogin(apikey) {
    const response = await postWithCsrf('/api/v1/auth/apikey', { apikey });
    return response;
  }

  // Example: Password login
  async function handlePasswordLogin(username, password) {
    const response = await postWithCsrf('/api/v1/auth/password', { username, password });
    return response;
  }

  // Update event listeners or login flows to use these helpers
  // ...

  /* ============================================================
     Auto-scroll & Shuffle for “Available Tools” feature tiles
     ============================================================ */
  const featuresContainer = document.getElementById('features-container');

  if (featuresContainer) {
    // 1. Filter out unwanted tools
    let tiles = Array.from(featuresContainer.querySelectorAll('.feature-tile'));
    tiles = tiles.filter(tile => {
      const title = tile.querySelector('h4')?.textContent || '';
      if (title.includes('Static Image')) return false;
      if (/_COOK|_API/i.test(title)) return false;
      return true;
    });

    // 2. Shuffle tiles (Fisher–Yates)
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }

    // 3. Re-attach in new order
    featuresContainer.innerHTML = '';
    tiles.forEach(t => featuresContainer.appendChild(t));

    // 4. Continuous bi-directional auto-scroll
    let dir = 1; // 1 => right, -1 => left
    const SPEED = 0.5; // px per frame

    function autoScroll() {
      const max = featuresContainer.scrollWidth - featuresContainer.clientWidth;
      // Reverse at edges
      if (featuresContainer.scrollLeft >= max) dir = -1;
      else if (featuresContainer.scrollLeft <= 0) dir = 1;

      featuresContainer.scrollLeft += SPEED * dir;
      requestAnimationFrame(autoScroll);
    }

    // Kick off after slight delay to ensure layout ready
    setTimeout(() => requestAnimationFrame(autoScroll), 300);
  }

  /* ---------------- Reviews auto-scroll ---------------- */
  const reviewsContainer = document.getElementById('reviews-container');
  if (reviewsContainer) {
    let dirR = 1;
    const SPEED_R = 0.4;

    function autoScrollReviews() {
      const max = reviewsContainer.scrollWidth - reviewsContainer.clientWidth;
      if (reviewsContainer.scrollLeft >= max) dirR = -1;
      else if (reviewsContainer.scrollLeft <= 0) dirR = 1;
      reviewsContainer.scrollLeft += SPEED_R * dirR;
      requestAnimationFrame(autoScrollReviews);
    }
    setTimeout(() => requestAnimationFrame(autoScrollReviews), 500);
  }
}); 