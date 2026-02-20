/**
 * Shared API helpers — CSRF token management and authenticated fetch.
 */

let csrfToken = null;

export async function fetchCsrfToken() {
  try {
    const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.csrfToken;
  } catch (err) {
    console.error('Failed to fetch CSRF token:', err);
  }
}

export async function postWithCsrf(url, body) {
  if (!csrfToken) await fetchCsrfToken();
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify(body)
  });
}

export async function fetchWithCsrf(url, options = {}) {
  if (!csrfToken) await fetchCsrfToken();
  const headers = { 'X-CSRF-Token': csrfToken, ...options.headers };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
}

export async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
