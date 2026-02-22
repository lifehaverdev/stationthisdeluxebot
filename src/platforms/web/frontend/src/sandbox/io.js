import { setAvailableTools } from './state.js';

// Initialize tools from API
export async function initializeTools() {
    console.log('[initializeTools] start');

    const CACHE_KEY = 'sandbox_tool_cache';
    const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // 1. Try cache first
    try {
        const cacheRaw = localStorage.getItem(CACHE_KEY);
        if (cacheRaw) {
            const { updatedAt, tools } = JSON.parse(cacheRaw);
            if (Array.isArray(tools) && Date.now() - updatedAt < CACHE_TTL_MS) {
                console.log('[initializeTools] using cached tool list');
                setAvailableTools(tools);
                // Fire-and-forget refresh in background
                refreshCache();
                return tools;
            }
        }
    } catch (e) {
        console.warn('[initializeTools] failed to parse cache', e);
    }

    // 2. No valid cache – fetch now
    return await refreshCache();

    async function refreshCache() {
        try {
            const response = await fetch('/api/v1/tools/registry');
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed: ${response.status} ${response.statusText} - ${errorText}`);
            }
            const tools = await response.json();
            setAvailableTools(tools);
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ updatedAt: Date.now(), tools }));
            } catch {}
            console.log('[initializeTools] fetched and cached', tools.length, 'tools');
            return tools;
        } catch (error) {
            console.error('[initializeTools] error', error);
            showError(error);
            return [];
        }
    }

    function showError(error) {
        const toolsContainer = document.querySelector('.tools-container');
        if (toolsContainer) {
            toolsContainer.innerHTML = `<div style="color:#ff6b6b;padding:16px;text-align:center;font-family:monospace;">Failed to load tools: ${error.message}</div>`;
        }
    }
}

/**
 * Upload a file to R2 storage and return the permanent URL.
 * Pure async function — no side effects, no DOM, no window creation.
 * @param {File} file
 * @returns {Promise<string>} permanentUrl
 */
export async function uploadToStorage(file) {
    const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    if (!csrfRes.ok) throw new Error('Could not fetch CSRF token.');
    const { csrfToken } = await csrfRes.json();

    const response = await fetch('/api/v1/storage/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
        credentials: 'include',
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Could not get signed URL.');
    }
    const { signedUrl, permanentUrl } = await response.json();

    const uploadResponse = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
    });
    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload file to storage: ${errorText}`);
    }

    return permanentUrl;
}

