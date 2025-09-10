document.addEventListener('DOMContentLoaded', () => {
    const logoutButton = document.getElementById('logout-button');

    if (logoutButton) {
        logoutButton.style.display = 'block';
        logoutButton.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = '/logout';
        });
    }
});

// Canonical CSRF token utility
(function() {
    let csrfToken = null;
    async function ensureCsrfToken() {
        if (!csrfToken) {
            try {
                const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || 'Could not fetch CSRF token');
                }
                const data = await res.json();
                csrfToken = data.csrfToken;
            } catch(err) {
                console.error('CSRF Token Error:', err);
                throw err;
            }
        }
        return csrfToken;
    }
    // Optionally allow for future reset/refresh
    function resetCsrfToken() { csrfToken = null; }
    window.auth = window.auth || {};
    window.auth.ensureCsrfToken = ensureCsrfToken;
    window.auth.resetCsrfToken = resetCsrfToken;
})();

// --- UserCore initialisation -------------------------------------------------

(function() {
  const USER_CORE_KEY = 'masterAccountId';
  const ANON_ID_KEY = 'webAnonId';
  let _masterAccountId = localStorage.getItem(USER_CORE_KEY) || null;
  let _initialising = null; // Promise

  /** Lightweight UUID v4 generator */
  function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }

  async function ensureUserCore() {
    if (_masterAccountId) return _masterAccountId;
    if (_initialising) return _initialising;

    _initialising = (async () => {
      // Derive platformId – prefer JWT sub if accessible (from localStorage token), else anonId
      let jwtSub = null;
      try {
        const stored = localStorage.getItem('jwt');
        if (stored) {
          const payload = JSON.parse(atob(stored.split('.')[1]));
          jwtSub = payload.sub;
        }
      } catch {}

      let anonId = localStorage.getItem(ANON_ID_KEY);
      if (!anonId) {
        anonId = uuidv4();
        localStorage.setItem(ANON_ID_KEY, anonId);
      }

      const platformId = jwtSub || anonId;
      try {
        const res = await fetch('/api/v1/auth/ensure-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            platform: 'web',
            platformId,
            platformContext: { userAgent: navigator.userAgent, lang: navigator.language }
          })
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        _masterAccountId = data.masterAccountId;
        if (_masterAccountId) localStorage.setItem(USER_CORE_KEY, _masterAccountId);
      } catch(err) {
        console.warn('[ensureUserCore] failed', err);
        // propagate null so caller can decide to retry or disable UI
        _masterAccountId = null;
      }
      return _masterAccountId;
    })();

    return _initialising;
  }

  function getMasterAccountId() { return _masterAccountId; }
  function resetMasterAccountId() {
    _masterAccountId = null;
    localStorage.removeItem(USER_CORE_KEY);
  }

  window.auth = window.auth || {};
  window.auth.ensureUserCore = ensureUserCore;
  window.auth.getMasterAccountId = getMasterAccountId;
  window.auth.resetMasterAccountId = resetMasterAccountId;
})();

// Kick off initialisation after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.auth && window.auth.ensureUserCore();
  });
} else {
  window.auth && window.auth.ensureUserCore();
} 