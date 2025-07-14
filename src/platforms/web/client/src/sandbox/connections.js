import { setActiveConnection, setConnectionLine, getConnections, addConnection, getToolWindows } from './state.js';

// Utility: highlight valid input anchors for a given type and source node
function highlightValidAnchors(type, fromWindowId) {
    document.querySelectorAll('.input-anchor').forEach(anchor => {
        const anchorType = anchor.dataset.type;
        const parentWindow = anchor.closest('.tool-window');
        if (anchorType === type && parentWindow && parentWindow.id !== fromWindowId) {
            anchor.classList.add('anchor-highlight-valid');
        } else {
            anchor.classList.add('anchor-highlight-invalid');
        }
    });
}
function clearAnchorHighlights() {
    document.querySelectorAll('.input-anchor').forEach(anchor => {
        anchor.classList.remove('anchor-highlight-valid', 'anchor-highlight-invalid');
    });
}

// Utility: check if adding a connection would create a cycle
function wouldCreateCycle({ fromWindowId, toWindowId }) {
    // Build adjacency list from current connections
    const adj = {};
    getConnections().forEach(conn => {
        if (!adj[conn.fromWindowId]) adj[conn.fromWindowId] = [];
        adj[conn.fromWindowId].push(conn.toWindowId);
    });
    // Add the proposed connection
    if (!adj[fromWindowId]) adj[fromWindowId] = [];
    adj[fromWindowId].push(toWindowId);
    // DFS to see if toWindowId can reach fromWindowId
    const visited = new Set();
    function dfs(node) {
        if (node === fromWindowId) return true;
        if (visited.has(node)) return false;
        visited.add(node);
        const neighbors = adj[node] || [];
        for (const neighbor of neighbors) {
            if (dfs(neighbor)) return true;
        }
        return false;
    }
    return dfs(toWindowId);
}

// Utility: check if output type is compatible with input type
function areTypesCompatible({ fromWindowId, toWindowId, type }) {
    // Find source and target tool windows
    const toolWindows = getToolWindows();
    const fromWin = toolWindows.find(w => w.id === fromWindowId);
    const toWin = toolWindows.find(w => w.id === toWindowId);
    if (!fromWin || !toWin) return false;
    const fromTool = fromWin.tool;
    const toTool = toWin.tool;
    // Use inputSchema if available
    if (toTool.inputSchema) {
        // Check if any input in inputSchema accepts this type
        for (const [inputName, param] of Object.entries(toTool.inputSchema)) {
            if (param.type === type || (Array.isArray(param.type) && param.type.includes(type))) {
                return true;
            }
            // Allow for custom allowedTypes or similar
            if (param.allowedTypes && param.allowedTypes.includes(type)) {
                return true;
            }
        }
        return false;
    }
    // Fallback: check metadata
    if (toTool.metadata && toTool.metadata.inputType) {
        if (Array.isArray(toTool.metadata.inputType)) {
            return toTool.metadata.inputType.includes(type);
        } else {
            return toTool.metadata.inputType === type;
        }
    }
    // If no schema, allow by default (legacy tools)
    return true;
}

// Utility: check if a connection target is valid
function isValidConnectionTarget({ fromWindowId, toAnchor, type }) {
    if (!toAnchor) return false;
    const anchorType = toAnchor.dataset.type;
    const toWindow = toAnchor.closest('.tool-window');
    if (!toWindow) return false;
    if (toWindow.id === fromWindowId) return false; // Prevent self-connection
    if (anchorType !== type) return false; // Type mismatch
    // Advanced type compatibility
    if (!areTypesCompatible({ fromWindowId, toWindowId: toWindow.id, type })) {
        alert('Cannot connect: output type is not compatible with input.');
        return false;
    }
    // Cycle prevention
    if (wouldCreateCycle({ fromWindowId, toWindowId: toWindow.id })) {
        alert('Cannot create connection: this would create a cycle in the graph.');
        return false;
    }
    return true;
}

export function startConnection(event, outputType, fromWindow) {
    console.log('startConnection called', { outputType, fromWindow });
    setActiveConnection({
        startX: event.clientX,
        startY: event.clientY,
        outputType,
        fromWindow
    });
    highlightValidAnchors(outputType, fromWindow.id);

    const line = document.createElement('div');
    line.className = 'connection-line';
    line.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: linear-gradient(90deg, 
            rgba(255, 255, 255, 0.8), 
            rgba(255, 255, 255, 0.4)
        );
        height: 2px;
        transform-origin: left center;
        z-index: 1000;
        filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.4));
    `;
    document.body.appendChild(line);
    setConnectionLine(line);

    function handleMouseMove(e) {
        console.log('handleMouseMove fired');
        updateConnectionLine(event.clientX, event.clientY, e.clientX, e.clientY);
    }

    function handleMouseUp(e) {
        console.log('handleMouseUp fired');
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        line.remove();
        setConnectionLine(null);
        clearAnchorHighlights();

        const targetAnchor = e.target.closest('.input-anchor');

        if (isValidConnectionTarget({ fromWindowId: fromWindow.id, toAnchor: targetAnchor, type: outputType })) {
            const toWindow = targetAnchor.closest('.tool-window');
            if (toWindow && toWindow !== fromWindow) {
                createPermanentConnection(fromWindow, toWindow, outputType);
                setActiveConnection(null); // Clear state after successful connection
                return;
            }
        }
        
        showToolsForConnection(outputType, e.clientX, e.clientY);
    }

    // Touch event handlers
    function handleTouchMove(e) {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        updateConnectionLine(event.touches ? event.touches[0].clientX : event.clientX, event.touches ? event.touches[0].clientY : event.clientY, touch.clientX, touch.clientY);
    }

    function handleTouchEnd(e) {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);

        line.remove();
        setConnectionLine(null);
        clearAnchorHighlights();

        // Find the element under the finger
        const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
        if (touch) {
            const elem = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetAnchor = elem && elem.closest('.input-anchor');
            if (isValidConnectionTarget({ fromWindowId: fromWindow.id, toAnchor: targetAnchor, type: outputType })) {
                const toWindow = targetAnchor.closest('.tool-window');
                if (toWindow && toWindow !== fromWindow) {
                    createPermanentConnection(fromWindow, toWindow, outputType);
                    setActiveConnection(null);
                    return;
                }
            }
            showToolsForConnection(outputType, touch.clientX, touch.clientY);
        }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
}

function updateConnectionLine(startX, startY, endX, endY) {
    const line = document.querySelector('.connection-line:not(.permanent)');
    if (!line) return;

    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    line.style.width = `${length}px`;
    line.style.left = `${startX}px`;
    line.style.top = `${startY}px`;
    line.style.transform = `rotate(${angle}rad)`;
}

function getAnchorPoint(windowEl, type, isOutput) {
    if (!windowEl) return null;
    if (isOutput) {
        return windowEl.querySelector('.anchor-point');
    } else {
        // Find input anchor matching type
        return windowEl.querySelector(`.input-anchor[data-type="${type}"]`);
    }
}

function drawConnectionLine(fromEl, toEl, type, isPermanent = true, connection = null) {
    if (!fromEl || !toEl) return null;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const fromX = fromRect.right;
    const fromY = fromRect.top + (fromRect.height / 2);
    const toX = toRect.left;
    const toY = toRect.top + (toRect.height / 2);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const line = document.createElement('div');
    line.className = 'connection-line' + (isPermanent ? ' permanent' : '');
    line.style.cssText = `
        position: fixed;
        pointer-events: auto;
        background: linear-gradient(90deg, 
            rgba(255, 255, 255, 0.8) 0%,
            rgba(255, 255, 255, 0.4) 50%,
            rgba(255, 255, 255, 0.8) 100%
        );
        background-size: 200% 100%;
        height: 2px;
        transform-origin: left center;
        z-index: 999;
        filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.4));
        animation: flowingLine 2s linear infinite;
        width: ${length}px;
        left: ${fromX}px;
        top: ${fromY}px;
        transform: rotate(${angle}rad);
        cursor: pointer;
    `;
    if (isPermanent && connection) {
        // Attach click and right-click handlers for editing
        line.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showConnectionEditMenu(e, connection);
        });
        line.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showConnectionEditMenu(e, connection);
        });
    }
    document.body.appendChild(line);
    return line;
}

function showConnectionEditMenu(e, connection) {
    const action = window.prompt('Edit Connection: Type "delete" to remove, "reroute" to reroute.');
    if (action === 'delete') {
        import('./state.js').then(({ removeConnection }) => {
            removeConnection(connection.id);
            renderAllConnections();
        });
    } else if (action === 'reroute') {
        // Start reroute mode: drag output end to new input anchor
        startRerouteConnection(connection);
    }
}

function startRerouteConnection(connection) {
    // Highlight the connection line (optional)
    document.querySelectorAll('.connection-line.permanent').forEach(line => {
        line.style.boxShadow = '';
    });
    // Find the line for this connection
    const fromWindow = document.getElementById(connection.fromWindowId);
    const toWindow = document.getElementById(connection.toWindowId);
    const fromAnchor = getAnchorPoint(fromWindow, connection.type, true);
    const toAnchor = getAnchorPoint(toWindow, connection.type, false);
    // We'll highlight the line visually (optional)
    // Now, start a drag from the output anchor
    highlightValidAnchors(connection.type, fromWindow.id);
    let tempLine = null;
    function handleMouseMove(e) {
        if (!tempLine) {
            tempLine = document.createElement('div');
            tempLine.className = 'connection-line reroute-temp';
            tempLine.style.cssText = `
                position: fixed;
                pointer-events: none;
                background: linear-gradient(90deg, rgba(0,255,255,0.8), rgba(0,255,255,0.4));
                height: 2px;
                transform-origin: left center;
                z-index: 2000;
                filter: drop-shadow(0 0 4px rgba(0,255,255,0.4));
            `;
            document.body.appendChild(tempLine);
        }
        const fromRect = fromAnchor.getBoundingClientRect();
        const startX = fromRect.right;
        const startY = fromRect.top + (fromRect.height / 2);
        const endX = e.clientX;
        const endY = e.clientY;
        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        tempLine.style.width = `${length}px`;
        tempLine.style.left = `${startX}px`;
        tempLine.style.top = `${startY}px`;
        tempLine.style.transform = `rotate(${angle}rad)`;
    }
    function handleMouseUp(e) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        if (tempLine) tempLine.remove();
        clearAnchorHighlights();
        // Check if dropped on a valid input anchor
        const targetAnchor = e.target.closest('.input-anchor');
        if (isValidConnectionTarget({ fromWindowId: fromWindow.id, toAnchor: targetAnchor, type: connection.type })) {
            const newToWindow = targetAnchor.closest('.tool-window');
            if (newToWindow && newToWindow.id !== connection.fromWindowId) {
                // Update connection in state
                import('./state.js').then(({ getConnections, persistState }) => {
                    const connections = getConnections();
                    const idx = connections.findIndex(c => c.id === connection.id);
                    if (idx !== -1) {
                        connections[idx].toWindowId = newToWindow.id;
                        connections[idx].toInput = connection.type; // For now, use type as input name
                        persistState();
                    }
                    renderAllConnections();
                });
                return;
            }
        }
        // If not valid, do nothing (connection remains as before)
        renderAllConnections();
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

export function renderAllConnections() {
    // Remove all existing permanent connection lines
    document.querySelectorAll('.connection-line.permanent').forEach(el => el.remove());
    const connections = getConnections();
    connections.forEach(conn => {
        const fromWindow = document.getElementById(conn.fromWindowId);
        const toWindow = document.getElementById(conn.toWindowId);
        const fromAnchor = getAnchorPoint(fromWindow, conn.type, true);
        const toAnchor = getAnchorPoint(toWindow, conn.type, false);
        drawConnectionLine(fromAnchor, toAnchor, conn.type, true, conn);
    });
}

// After adding a connection, render all
import { showToolsForConnection } from './toolSelection.js';

export function createPermanentConnection(fromWindow, toWindow, type) {
    // Get tool data from window elements
    const fromWindowData = fromWindow && fromWindow.dataset ? fromWindow.dataset : fromWindow;
    const toWindowData = toWindow && toWindow.dataset ? toWindow.dataset : toWindow;
    // Fallback: try to get displayName from windowData or element
    const fromDisplayName = fromWindowData.displayName || fromWindow?.tool?.displayName || fromWindow?.getAttribute?.('data-displayname') || '';
    const toDisplayName = toWindowData.displayName || toWindow?.tool?.displayName || toWindow?.getAttribute?.('data-displayname') || '';
    const fromWindowId = fromWindow.id;
    const toWindowId = toWindow.id;
    // For now, use generic output/input names
    const fromOutput = type;
    const toInput = type;
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
    renderAllConnections();
    return connection;
}

export function updatePermanentConnection(connection) {
    console.log('Attempting to update permanent connection:', connection);
    if (!connection.from || !connection.to) {
        console.error('Connection update failed: Missing from or to window.');
        return;
    }
    
    const fromAnchor = connection.from.querySelector('.anchor-point');
    const toAnchor = connection.to.querySelector(`.input-anchor[data-type="${connection.type}"]`);
    
    if (!fromAnchor || !toAnchor) {
        console.error('Connection update failed: Could not find anchor points.', { from: connection.from, to: connection.to });
        return;
    }

    const fromAnchorRect = fromAnchor.getBoundingClientRect();
    const toAnchorRect = toAnchor.getBoundingClientRect();

    const fromX = fromAnchorRect.right;
    const fromY = fromAnchorRect.top + (fromAnchorRect.height / 2);
    const toX = toAnchorRect.left;
    const toY = toAnchorRect.top + (toAnchorRect.height / 2);

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    connection.element.style.width = `${length}px`;
    connection.element.style.left = `${fromX}px`;
    connection.element.style.top = `${fromY}px`;
    connection.element.style.transform = `rotate(${angle}rad)`;
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

export function updateAllConnections() {
    const connections = getConnections();
    connections.forEach(updatePermanentConnection);
} 