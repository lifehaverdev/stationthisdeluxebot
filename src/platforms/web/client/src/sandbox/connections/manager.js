import {
    pushHistory,
    addConnection,
    getConnections,
    getToolWindow,
    persistState,
} from '../state.js';
import { rerenderToolWindowById } from '../node/index.js';
import { renderAllConnections } from './drawing.js';

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

export function removeConnection(connection) {
    const connections = getConnections();
    const index = connections.indexOf(connection);
    if (index > -1) {
        connections.splice(index, 1);
    }
    if (connection.element) {
        connection.element.remove();
    }
} 