import {
    pushHistory,
    addConnection,
    getConnections,
    getToolWindow,
    persistState,
} from '../state.js';
import { rerenderToolWindowById } from '../node/toolWindow.js';
import { renderAllConnections } from './drawing.js';

// Listen for upload completion to swap placeholder value with real URL
window.addEventListener('uploadCompleted', ({ detail }) => {
  const { windowId, url } = detail;
  const conns = getConnections();
  conns.forEach(conn => {
    if (conn.fromWindowId === windowId && conn.type === 'image') {
      conn.resolvedUrl = url;
      const tgtEl=document.getElementById(conn.toWindowId);
      const isExecuting=tgtEl && tgtEl.querySelector('.progress-indicator');
      if(!isExecuting){
        rerenderToolWindowById(conn.toWindowId);
      }
    }
  });
});

export function createPermanentConnection(fromWindow, toWindow, type, toAnchor = null) {
    // This is a top-level action, so it manages its own history.
    pushHistory();

    // Get tool data from window elements
    const fromWindowData = fromWindow && fromWindow.dataset ? fromWindow.dataset : fromWindow;
    const toWindowData = toWindow && toWindow.dataset ? toWindow.dataset : toWindow;
    // Fallback: try to get displayName from windowData or element
    const fromDisplayName = fromWindowData.displayName || fromWindow?.tool?.displayName || fromWindow?.getAttribute?.('data-displayname') || '';
    const toDisplayName = toWindowData.displayName || toWindow?.tool?.displayName || toWindow?.getAttribute?.('data-displayname') || '';
    const fromWindowId = fromWindow.id;
    const toWindowId = toWindow.id;

    // Use the explicitly passed anchor, or fallback
    if (!toAnchor) {
        toAnchor = toWindow.querySelector(`.input-anchor[data-type="${type}"]`);
    }
    const paramKey = toAnchor ? toAnchor.dataset.param : type;
    console.log('[createPermanentConnection] Mapping connection to parameter:', paramKey, 'on node', toWindowId);

    // Update parameterMappings in the target tool window's state
    const toWinState = getToolWindow(toWindowId);
    if (toWinState && toWinState.parameterMappings && paramKey) {
        toWinState.parameterMappings[paramKey] = {
            type: 'nodeOutput',
            nodeId: fromWindowId,
            outputKey: type
        };
        console.log(`[Connection Manager] Updated parameterMappings for window ${toWindowId}:`, JSON.parse(JSON.stringify(toWinState.parameterMappings)));
        // Rerender the window to reflect the new connection state (e.g., show "connected" text)
        rerenderToolWindowById(toWindowId);
    }


    // For now, use generic output/input names
    const fromOutput = type;
    const toInput = paramKey;
    const connection = {
        id: 'conn-' + Math.random().toString(36).substr(2, 9),
        fromDisplayName,
        fromWindowId,
        fromOutput,
        toDisplayName,
        toWindowId,
        toInput,
        type,
        createdAt: Date.now()
    };
    addConnection(connection);

    // Persist the new state
    persistState();

    renderAllConnections();
    return connection;
}

export function removeConnection(connectionOrId) {
    // Support being called with either the connection object or its id
    const connections = getConnections();

    // Locate connection index / object
    let idx = -1;
    let conn = null;
    if (typeof connectionOrId === 'string') {
        idx = connections.findIndex(c => c.id === connectionOrId);
        conn = idx !== -1 ? connections[idx] : null;
    } else {
        idx = connections.indexOf(connectionOrId);
        conn = connectionOrId;
    }

    if (idx === -1 || !conn) return; // Nothing to do

    // 1. Remove from connections array
    connections.splice(idx, 1);

    // 2. Clean up parameterMappings on the target node
    const toWinState = getToolWindow(conn.toWindowId);
    if (toWinState && toWinState.parameterMappings) {
        delete toWinState.parameterMappings[conn.toInput];
    }

    // 3. Remove the visual line element if still present
    if (conn.element && conn.element.remove) {
        conn.element.remove();
    }

    // 4. Persist state & visually refresh
    try { persistState(); } catch {}

    rerenderToolWindowById(conn.toWindowId);
    renderAllConnections();

    // 5. Dispatch custom event so other components (e.g., parameter panel) can react
    const ev = new CustomEvent('connectionremoved', {
        detail: {
            connectionId: conn.id,
            fromWindowId: conn.fromWindowId,
            toWindowId: conn.toWindowId,
            paramKey: conn.toInput
        }
    });
    window.dispatchEvent(ev);
} 