/**
 * Minimal history-based SPA router.
 * Supports sync and async route handlers.
 */

const routes = new Map();
let currentCleanup = null;

export function route(path, handler) {
  routes.set(path, handler);
}

export function navigate(path) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  resolve();
}

export async function resolve() {
  if (typeof currentCleanup === 'function') {
    currentCleanup();
    currentCleanup = null;
  }

  const path = window.location.pathname;
  const handler = routes.get(path);

  if (handler) {
    try {
      const result = await handler();
      if (result && typeof result.cleanup === 'function') {
        currentCleanup = result.cleanup;
      }
    } catch (err) {
      console.error('[Router] Route handler error for', path, err);
    }
  } else {
    // Fallback to landing for unknown routes
    const fallback = routes.get('/');
    if (fallback) await fallback();
  }
}

export function startRouter() {
  // Intercept link clicks for SPA navigation
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    // Only intercept local paths
    if (href.startsWith('/') && !href.startsWith('//')) {
      e.preventDefault();
      navigate(href);
    }
  });

  window.addEventListener('popstate', () => resolve());
  resolve();
}
