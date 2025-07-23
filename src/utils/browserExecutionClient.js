const { ExecutionClient } = require('./ExecutionClient');

// Fetch CSRF token helper
async function getCsrfHeaders() {
  const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
  const { csrfToken } = await res.json();
  return { 'x-csrf-token': csrfToken };
}

const browserExecutionClient = new ExecutionClient({
  baseUrl: '/api/v1/generation',
  authStrategy: getCsrfHeaders,
  fetchImpl: window.fetch.bind(window),
});

module.exports = browserExecutionClient; 