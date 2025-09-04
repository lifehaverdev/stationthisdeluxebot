// src/platforms/web/client/src/sandbox/workspaces.js
import { getConnections, getToolWindows, persistState, pushHistory } from './state.js';

async function getCsrfToken() {
  if (window.__csrfToken) return window.__csrfToken;
  try {
    const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await res.json();
    window.__csrfToken = data.csrfToken;
    return window.__csrfToken;
  } catch { return ''; }
}

function sanitiseOutput(o) {
  if (!o) return null;
  const { type, url, text, generationId } = o;
  // strip data URLs – only keep if it's a remote/link
  const safeUrl = (url && url.startsWith('data:')) ? undefined : url;
  return { type, url: safeUrl, text, generationId };
}

function buildSnapshot() {
  // Make serializable clones like persistState does
  const connections = getConnections().map(({ element, ...rest }) => rest);
  const toolWindows = getToolWindows().map(w => {
    const base = {
      id: w.id,
      workspaceX: w.workspaceX,
      workspaceY: w.workspaceY,
      output: sanitiseOutput(w.output),
      // keep at most 5 recent versions and sanitise
      outputVersions: (w.outputVersions || []).slice(-5).map(v => ({
        ...v,
        output: sanitiseOutput(v.output)
      })),
      currentVersionIndex: w.currentVersionIndex ?? -1,
      parameterMappings: w.parameterMappings || {}
    };
    if (w.isSpell) {
      return { ...base, isSpell: true, spell: { _id: w.spell._id, name: w.spell.name } };
    }
    if (w.type === 'collection') {
      return { ...base, type: 'collection', mode: w.mode, collection: { collectionId: w.collection?.collectionId, name: w.collection?.name } };
    }
    return { ...base, displayName: w.tool?.displayName || '', toolId: w.tool?.toolId || '' };
  });
  return { connections, toolWindows };
}

export async function saveWorkspace() {
  const snapshot = buildSnapshot();
  const byteSize = obj => new Blob([JSON.stringify(obj)]).size;
  const totalSize = byteSize(snapshot);
  const connSize = byteSize(snapshot.connections);
  const windowsSize = byteSize(snapshot.toolWindows);
  console.group('[Workspace] Snapshot debug');
  console.log(`Total ${totalSize} bytes (connections ${connSize}, windows ${windowsSize})`);
  snapshot.toolWindows.forEach(w => {
    console.log(`  win ${w.id} (${w.isSpell ? 'spell' : w.displayName || w.type}) -> ${byteSize(w)} bytes`);
  });
  console.groupEnd();
  // avoid saving completely empty workspaces
  if (snapshot.toolWindows.length === 0 && snapshot.connections.length === 0) {
    alert('Nothing to save yet! Add some tools first.');
    return;
  }
  try {
    const csrf = await getCsrfToken();
    const res = await fetch('/api/v1/workspaces', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ snapshot })
    });
    if (!res.ok) throw new Error('Save failed');
    const { slug } = await res.json();
    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', slug);
    window.history.pushState({}, '', url);
    alert(`Workspace saved! Shareable link copied to clipboard:\n${url}`);
    navigator.clipboard?.writeText(url.toString());
  } catch (e) {
    console.error('[saveWorkspace] error', e);
    alert('Failed to save workspace.');
  }
}

export async function loadWorkspace(slug) {
  try {
    const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error('Load failed');
    const doc = await res.json();
    const { snapshot } = doc;
    if (!snapshot) throw new Error('Invalid snapshot');
    const stateMod = await import('./state.js');
    pushHistory();
    stateMod.connections = snapshot.connections || [];
    stateMod.activeToolWindows = snapshot.toolWindows || [];
    persistState();
    // Force full rerender
    window.location.href = `${window.location.pathname}?workspace=${slug}`;
  } catch (e) {
    console.error('[loadWorkspace] error', e);
    alert('Failed to load workspace');
  }
}
