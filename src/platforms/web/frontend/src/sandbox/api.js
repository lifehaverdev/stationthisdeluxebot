/**
 * Sandbox API utilities — tool registry loading, file upload, CSRF.
 *
 * Consolidates the scattered fetch calls from io.js and state.js into
 * a single module that reuses the frontend's shared API helpers.
 */

import { fetchCsrfToken, postWithCsrf, fetchJson } from '../lib/api.js';

const CACHE_KEY = 'sandbox_tool_cache';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Load tool registry with 6h localStorage cache.
 * Returns the tools array.
 */
export async function loadToolRegistry() {
  // 1. Try cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { updatedAt, tools } = JSON.parse(raw);
      if (Array.isArray(tools) && Date.now() - updatedAt < CACHE_TTL_MS) {
        // Valid cache — use it, refresh in background
        refreshToolCache();
        return tools;
      }
    }
  } catch (e) {
    console.warn('[sandbox/api] cache parse error', e);
  }

  // 2. No valid cache — fetch now
  return refreshToolCache();
}

async function refreshToolCache() {
  try {
    const tools = await fetchJson('/api/v1/tools/registry');
    const list = Array.isArray(tools) ? tools : (tools?.tools || []);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ updatedAt: Date.now(), tools: list }));
    } catch {}
    return list;
  } catch (err) {
    console.error('[sandbox/api] tool registry fetch failed:', err);
    return [];
  }
}

/**
 * Upload a file to Cloudflare R2 via signed URL.
 * Returns the permanent URL on success.
 */
export async function uploadFileToStorage(file) {
  // Get signed URL
  const res = await postWithCsrf('/api/v1/storage/upload-url', {
    fileName: file.name,
    contentType: file.type
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Upload URL failed: ${res.status}`);
  }

  const { signedUrl, permanentUrl } = await res.json();

  // PUT to R2
  const uploadRes = await fetch(signedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type }
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`R2 upload failed: ${text}`);
  }

  return permanentUrl;
}

/**
 * Check status of pending generations (recovery after disconnect).
 */
export async function checkGenerationStatuses(generationIds) {
  if (!generationIds.length) return [];

  const res = await postWithCsrf('/api/v1/generations/status', { generationIds });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.warn('[sandbox/api] generation status check unauthorized');
      return [];
    }
    throw new Error(`Generation status check failed: ${res.status}`);
  }

  const data = await res.json();
  return data.generations || [];
}

// Re-export shared helpers for convenience
export { fetchCsrfToken, postWithCsrf, fetchJson };
