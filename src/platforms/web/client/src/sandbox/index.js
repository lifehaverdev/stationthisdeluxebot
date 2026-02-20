/**
 * Sandbox init — fetch interceptor, session keepalive, paste-to-upload.
 *
 * All major systems are now in the microact SPA:
 *   - Chrome (header, sidebar, HUD, FAB, action modal) → microact components
 *   - Zoom/pan/lasso → viewport.js
 *   - Window management → windowManager.js
 *   - WebSocket + execution → execution.js
 *   - Tool list + sidebar → Sidebar component + store
 *
 * This file handles:
 *   - 401 fetch interceptor (reauth modal on session expiry)
 *   - Session keepalive
 *   - Paste-to-upload shortcut
 */

import './components/ReauthModal.js';
import { initSessionKeepAlive, forceSessionRefresh } from './utils/sessionKeepAlive.js';

// ── Fetch interceptor (401 → reauth modal) ─────────────────
(function interceptUnauthorized() {
    if (window.__fetch401InterceptorAttached__) return;
    window.__fetch401InterceptorAttached__ = true;
    const originalFetch = window.fetch;

    const SKIP_ENDPOINTS = ['/api/v1/generations/status', '/api/v1/auth/session/refresh'];

    function shouldSkip(url, opts) {
        if (!url) return false;
        if (url.includes('/api/v1/workspaces/') && (!opts || opts.method === 'GET')) return true;
        return SKIP_ENDPOINTS.some(ep => url.includes(ep));
    }

    function getUrl(input) {
        if (typeof input === 'string') return input;
        if (input instanceof Request) return input.url;
        if (input instanceof URL) return input.toString();
        return input?.url || '';
    }

    window.fetch = async function (...args) {
        const [input, options] = args;
        let cloned = null;
        try { cloned = input instanceof Request ? input.clone() : new Request(input, options); } catch {}

        let resp = await originalFetch.apply(this, args);
        const url = getUrl(input);

        if (resp?.status === 401 && !shouldSkip(url, options)) {
            if (!url.includes('/api/v1/auth/session/refresh')) {
                const refreshed = await forceSessionRefresh();
                if (refreshed && cloned) {
                    const retry = await originalFetch.call(this, cloned.clone());
                    if (retry?.status !== 401) return retry;
                    resp = retry;
                }
            }
            if (typeof window.openReauthModal === 'function' && !window.__reauthModalOpen__) {
                window.openReauthModal();
            }
        }

        if (resp?.status === 403) {
            try {
                const data = await resp.clone().json().catch(() => null);
                if (data?.error?.code === 'CSRF_TOKEN_INVALID' && window.openReauthModal && !window.__reauthModalOpen__) {
                    window.openReauthModal();
                }
            } catch {}
        }
        return resp;
    };
})();

// ── Public init ─────────────────────────────────────────────
export async function init() {
    // Note: initState() is NOT called here — the SPA manages state initialization
    // via the store and windowManager. Calling it would wipe tools loaded by windowManager.
    initSessionKeepAlive();

    // Clear stale DOM from previous session
    document.querySelectorAll('.tool-window, .connection-line').forEach(el => el.remove());

    // Paste image → create upload window
    document.addEventListener('paste', (e) => {
        const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
        if (!item || !window.sandbox) return;
        const file = item.getAsFile();
        const { x, y } = window.sandbox.screenToWorkspace(e.clientX, e.clientY);
        import('./window/index.js').then(({ createUploadWindow }) => {
            const win = createUploadWindow({ id: `upload-${Date.now()}`, position: { x, y } });
            win.loadPastedFile?.(file);
        });
    });
}

// Backward compat: auto-init when loaded standalone
if (typeof window.__SANDBOX_SPA_MANAGED__ === 'undefined') {
    document.addEventListener('DOMContentLoaded', () => init());
}
