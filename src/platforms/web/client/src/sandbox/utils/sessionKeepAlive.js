const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const MIN_INTERVAL_BETWEEN_ATTEMPTS_MS = 2 * 60 * 1000; // avoid hammering endpoint

let keepAliveTimer = null;
let refreshPromise = null;
let lastAttemptTs = 0;
let sessionActive = true;

function stopTimer() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function performRefresh({ force = false, skipThrottle = false } = {}) {
  if (!sessionActive && !force) return false;
  const now = Date.now();
  if (!skipThrottle && refreshPromise) {
    return refreshPromise;
  }
  if (!skipThrottle && now - lastAttemptTs < MIN_INTERVAL_BETWEEN_ATTEMPTS_MS) {
    return false;
  }
  lastAttemptTs = now;
  refreshPromise = (async () => {
    try {
      if (!window.auth?.ensureCsrfToken) return false;
      const token = await window.auth.ensureCsrfToken();
      const res = await fetch('/api/v1/auth/session/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({}),
        credentials: 'include'
      });
      if (!res.ok) {
        if (res.status === 401) {
          sessionActive = false;
          stopTimer();
          return false;
        }
        throw new Error(`Session refresh failed (${res.status})`);
      }
      sessionActive = true;
      window.dispatchEvent(new CustomEvent('session-refreshed'));
      return true;
    } catch (error) {
      console.warn('[SessionKeepAlive] Session refresh error:', error);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function ensureTimer() {
  if (keepAliveTimer || !sessionActive) return;
  keepAliveTimer = setInterval(() => performRefresh(), REFRESH_INTERVAL_MS);
}

export function initSessionKeepAlive() {
  ensureTimer();
  // Attempt an initial refresh shortly after load if a session exists
  setTimeout(() => {
    performRefresh();
  }, 10 * 1000);
  window.addEventListener('reauth-success', () => {
    sessionActive = true;
    ensureTimer();
    performRefresh({ force: true, skipThrottle: true });
  });
}

export function forceSessionRefresh() {
  return performRefresh({ force: true, skipThrottle: true });
}
