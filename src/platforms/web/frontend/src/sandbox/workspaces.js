import { getConnections, getToolWindows, persistState, pushHistory } from './state.js';
import { showNotification, showLoading } from './utils/notifications.js';

// Workspace operation lock to prevent race conditions
let workspaceOperationLock = false;
const workspaceOperationQueue = [];

export async function getCsrfToken() {
  if (window.__csrfToken) return window.__csrfToken;
  try {
    const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`CSRF token fetch failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.csrfToken) {
      throw new Error('CSRF token not in response');
    }
    window.__csrfToken = data.csrfToken;
    return window.__csrfToken;
  } catch (e) {
    console.error('[getCsrfToken] error', e);
    throw new Error('Failed to get CSRF token. Please refresh the page.');
  }
}

function sanitiseOutput(o) {
  if (!o) return null;
  const { type, url, text, generationId } = o;
  // strip data URLs – only keep if it's a remote/link
  const safeUrl = (url && url.startsWith('data:')) ? undefined : url;
  return { type, url: safeUrl, text, generationId };
}

/**
 * Validate snapshot structure
 * @param {Object} snapshot - Snapshot to validate
 * @throws {Error} If snapshot is invalid
 */
function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Snapshot must be an object');
  }
  
  if (!Array.isArray(snapshot.connections)) {
    throw new Error('Snapshot.connections must be an array');
  }
  
  if (!Array.isArray(snapshot.toolWindows)) {
    throw new Error('Snapshot.toolWindows must be an array');
  }
  
  // Validate each connection
  snapshot.connections.forEach((conn, idx) => {
    if (!conn.id || !conn.fromWindowId || !conn.toWindowId) {
      throw new Error(`Connection at index ${idx} missing required fields (id, fromWindowId, toWindowId)`);
    }
  });
  
  // Validate each tool window
  snapshot.toolWindows.forEach((win, idx) => {
    if (!win.id) {
      throw new Error(`Tool window at index ${idx} missing required field: id`);
    }
    if (typeof win.workspaceX !== 'number' || typeof win.workspaceY !== 'number') {
      throw new Error(`Tool window at index ${idx} missing or invalid position (workspaceX, workspaceY)`);
    }
    
    // Validate based on type
    if (win.isSpell) {
      if (!win.spell || !win.spell._id) {
        throw new Error(`Spell window at index ${idx} missing spell._id`);
      }
    } else if (win.type === 'collection') {
      if (!win.collection || !win.collection.collectionId) {
        throw new Error(`Collection window at index ${idx} missing collection.collectionId`);
      }
    } else {
      if (!win.toolId && !win.displayName) {
        throw new Error(`Tool window at index ${idx} missing both toolId and displayName`);
      }
    }
  });
}

/**
 * Calculate snapshot size in bytes
 * @param {Object} snapshot - Snapshot to measure
 * @returns {number} Size in bytes
 */
function calculateSnapshotSize(snapshot) {
  try {
    return new Blob([JSON.stringify(snapshot)]).size;
  } catch (e) {
    console.error('[calculateSnapshotSize] error', e);
    return 0;
  }
}

const MAX_SNAPSHOT_SIZE = 900 * 1024; // 900KB (leave 100KB buffer for 1MB limit)

function buildSnapshot() {
  // Delegate to the new SandboxCanvas public API if available.
  // Falls back to the old state system for legacy compatibility.
  const canvas = window.sandboxCanvas;
  let snapshot;
  if (canvas && typeof canvas.getSnapshot === 'function') {
    snapshot = canvas.getSnapshot();
  } else {
    // Legacy fallback (old state system)
    const connections = getConnections().map(({ element, ...rest }) => rest);
    const toolWindows = getToolWindows().map(w => {
      const base = {
        id: w.id,
        workspaceX: w.workspaceX,
        workspaceY: w.workspaceY,
        output: sanitiseOutput(w.output),
        outputVersions: (w.outputVersions || []).slice(-5).map(v => ({
          ...v,
          output: sanitiseOutput(v.output)
        })),
        currentVersionIndex: w.currentVersionIndex ?? -1,
        parameterMappings: w.parameterMappings || {}
      };
      if (w.isSpell) {
        return { ...base, isSpell: true, spell: {
          _id: w.spell._id,
          name: w.spell.name,
          slug: w.spell.slug,
          exposedInputs: w.spell.exposedInputs || [],
          steps: (w.spell.steps || []).map(s => ({ displayName: s.displayName || s.service || s.toolId, service: s.service })),
        }};
      }
      if (w.type === 'collection') {
        return { ...base, type: 'collection', mode: w.mode, collection: { collectionId: w.collection?.collectionId, name: w.collection?.name } };
      }
      return { ...base, displayName: w.tool?.displayName || '', toolId: w.tool?.toolId || '' };
    });
    snapshot = { connections, toolWindows };
  }

  // Validate snapshot structure
  validateSnapshot(snapshot);

  // Check size before returning
  const size = calculateSnapshotSize(snapshot);
  if (size > MAX_SNAPSHOT_SIZE) {
    throw new Error(`Workspace is too large (${Math.round(size / 1024)}KB). Maximum size is ${Math.round(MAX_SNAPSHOT_SIZE / 1024)}KB. Please remove some tool windows or outputs.`);
  }

  return snapshot;
}

/**
 * Retry helper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise} Result of fn
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Queue workspace operation to prevent race conditions
 * @param {Function} operation - Async operation to queue
 * @returns {Promise} Result of operation
 */
async function queueWorkspaceOperation(operation) {
  return new Promise((resolve, reject) => {
    workspaceOperationQueue.push(async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        workspaceOperationQueue.shift();
        if (workspaceOperationQueue.length > 0) {
          workspaceOperationQueue[0]();
        } else {
          workspaceOperationLock = false;
        }
      }
    });
    
    if (!workspaceOperationLock) {
      workspaceOperationLock = true;
      workspaceOperationQueue[0]();
    }
  });
}

// --- Snapshot hydration (no page reload) ---
async function hydrateSnapshot(snapshot, slug = null) {
  // Validate snapshot before hydration
  try {
    validateSnapshot(snapshot);
  } catch (e) {
    throw new Error(`Invalid snapshot format: ${e.message}`);
  }

  const canvas = window.sandboxCanvas;
  if (canvas && typeof canvas.loadFromSnapshot === 'function') {
    // New microact SandboxCanvas path — update state directly, no reload needed
    canvas.loadFromSnapshot(snapshot);
  } else {
    // Legacy fallback: write to old localStorage keys and trigger reload
    const CONNECTIONS_KEY = 'sandbox_connections';
    const TOOL_WINDOWS_KEY = 'sandbox_tool_windows';
    try {
      localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(snapshot.connections || []));
      localStorage.setItem(TOOL_WINDOWS_KEY, JSON.stringify(snapshot.toolWindows || []));
    } catch (e) {
      throw new Error(`Failed to save to localStorage: ${e.message}`);
    }
    if (typeof window.__reloadSandboxState === 'function') {
      try {
        await window.__reloadSandboxState();
      } catch (e) {
        console.error('[hydrateSnapshot] reload error', e);
        throw new Error(`Failed to reload workspace state: ${e.message}`);
      }
    } else {
      window.dispatchEvent(new Event('sandboxSnapshotUpdated'));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Update URL (historic state) if slug provided
  if (slug) {
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', slug);
    window.history.pushState({}, '', url);
  }
}

export { hydrateSnapshot };

/**
 * Get user-friendly error message from API response
 * @param {Response} res - Fetch response
 * @returns {Promise<string>} Error message
 */
async function getErrorMessage(res) {
  try {
    const data = await res.json();
    if (data.error) {
      const errorMessages = {
        'forbidden': 'You do not have permission to update this workspace.',
        'not-found': 'Workspace not found. It may have been deleted.',
        'internal-error': 'Server error occurred. Please try again later.',
        'snapshot required': 'Invalid workspace data. Please try again.',
        'service-unavailable': 'Workspace service is temporarily unavailable.'
      };
      return errorMessages[data.error] || `Error: ${data.error}`;
    }
  } catch (e) {
    // If response isn't JSON, use status text
  }
  
  if (res.status === 403) return 'You do not have permission to perform this action.';
  if (res.status === 404) return 'Workspace not found. It may have been deleted.';
  if (res.status === 413) return 'Workspace is too large. Please remove some content.';
  if (res.status === 500) return 'Server error occurred. Please try again later.';
  if (res.status === 503) return 'Service temporarily unavailable. Please try again later.';
  if (res.status === 0) return 'Network error. Please check your connection.';
  
  return `Failed to save workspace (${res.status}). Please try again.`;
}

export async function saveWorkspace(existingSlug = null, { silent = false, walletAddress = null, name = undefined } = {}) {
  return queueWorkspaceOperation(async () => {
    let loadingDismiss = null;
    let forking = false;

    try {
      // Build and validate snapshot
      let snapshot;
      try {
        snapshot = buildSnapshot();
      } catch (e) {
        if (e.message.includes('too large')) {
          if (!silent) showNotification(e.message, 'error', 8000);
          throw e;
        }
        if (!silent) showNotification(`Failed to create snapshot: ${e.message}`, 'error');
        throw e;
      }

      // avoid saving completely empty workspaces
      if (snapshot.toolWindows.length === 0 && snapshot.connections.length === 0) {
        if (!silent) showNotification('Nothing to save yet! Add some tools first.', 'info');
        return null;
      }

      if (!silent) {
        loadingDismiss = showLoading(existingSlug ? 'Updating workspace...' : 'Saving workspace...');
      }

      // --- Phase 1: If we have a slug, try to update it ---
      // A 403 means we don't own it — fork instead of failing.
      let originSlug = null;
      if (existingSlug) {
        const csrf = await getCsrfToken();
        const body = { snapshot, slug: existingSlug };
        if (walletAddress) body.walletAddress = walletAddress.toLowerCase();
        if (typeof name === 'string') body.name = name;
        const res = await fetch('/api/v1/workspaces', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const savedSlug = (await res.json()).slug || existingSlug;
          const url = new URL(window.location.href);
          url.searchParams.set('workspace', savedSlug);
          window.history.pushState({}, '', url);
          if (!silent) {
            loadingDismiss?.();
            showNotification('Workspace updated successfully.', 'success');
          }
          return savedSlug;
        }

        if (res.status !== 403) {
          throw new Error(await getErrorMessage(res));
        }

        // 403 — not our workspace, fork it
        forking = true;
        originSlug = existingSlug;
        if (!silent) {
          loadingDismiss?.();
          loadingDismiss = showLoading('Forking workspace...');
        }
      }

      // --- Phase 2: Create new workspace (first save or fork) ---
      const result = await retryWithBackoff(async () => {
        const csrf = await getCsrfToken();
        const body = { snapshot };
        if (walletAddress) body.walletAddress = walletAddress.toLowerCase();
        if (originSlug) body.origin = { slug: originSlug };
        if (typeof name === 'string') body.name = name;
        const res = await fetch('/api/v1/workspaces', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(await getErrorMessage(res));
        return await res.json();
      }, 3, 1000);

      const savedSlug = result.slug;
      const url = new URL(window.location.href);
      url.searchParams.set('workspace', savedSlug);
      window.history.pushState({}, '', url);

      if (!silent) {
        loadingDismiss?.();
        const msg = forking ? 'Workspace forked! Link copied to clipboard.' : 'Workspace saved! Link copied to clipboard.';
        const fallback = forking ? `Workspace forked! Your copy: ${url}` : `Workspace saved! Share link: ${url}`;
        try {
          await navigator.clipboard.writeText(url.toString());
          showNotification(msg, 'success');
        } catch (e) {
          showNotification(fallback, 'success', 10000);
        }
      }

      return savedSlug;
    } catch (e) {
      loadingDismiss?.();
      console.error('[saveWorkspace] error', e);
      if (!silent) showNotification(e.message || 'Failed to save workspace. Please try again.', 'error', 8000);
      throw e;
    }
  });
}

export async function loadWorkspace(slug, { silent = false } = {}) {
  if (!slug || typeof slug !== 'string' || slug.trim() === '') {
    throw new Error('Invalid workspace ID');
  }
  
  return queueWorkspaceOperation(async () => {
    let loadingDismiss = null;
    
    try {
      if (!silent) {
        loadingDismiss = showLoading('Loading workspace...');
      }
      
      // Retry with exponential backoff for transient failures
      const result = await retryWithBackoff(async () => {
        const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(slug.trim())}`, {
          credentials: 'include'
        });
        
        if (!res.ok) {
          const errorMsg = await getErrorMessage(res);
          throw new Error(errorMsg);
        }
        
        const data = await res.json();
        if (!data.snapshot) {
          throw new Error('Invalid workspace data received from server.');
        }
        
        return data;
      }, 3, 1000);
      
      // Validate snapshot before hydration
      try {
        validateSnapshot(result.snapshot);
      } catch (e) {
        throw new Error(`Workspace data is corrupted: ${e.message}`);
      }
      
      // Hydrate snapshot (async now)
      await hydrateSnapshot(result.snapshot, slug);

      if (!silent) {
        loadingDismiss?.();
        showNotification('Workspace loaded successfully.', 'success');
      }

      return { slug, name: result.name || null };
    } catch (e) {
      loadingDismiss?.();
      console.error('[loadWorkspace] error', e);
      
      if (!silent) {
        const errorMsg = e.message || 'Failed to load workspace. Please check the workspace ID and try again.';
        showNotification(errorMsg, 'error', 8000);
      }
      
      throw e; // Re-throw so caller can handle if needed
    }
  });
}

// Expose blank workspace helper
export async function loadBlankWorkspace() {
  await hydrateSnapshot({ connections: [], toolWindows: [] });
}
