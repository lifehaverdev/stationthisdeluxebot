import {
    setActiveConnection,
    setConnectionLine,
    getConnections,
    addConnection,
    getAvailableTools,
    pushHistory,
    persistState,
    getToolWindow
} from '../state.js';
import { showToolsForConnection } from '../toolSelection.js';
import { highlightValidAnchors, clearAnchorHighlights, getAnchorPoint } from './anchors.js';
import { updateConnectionLine, renderAllConnections } from './drawing.js';
import { isValidConnectionTarget } from './validation.js';
import { createPermanentConnection } from './manager.js';


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

        // Use elementFromPoint for robust anchor detection
        const elem = document.elementFromPoint(e.clientX, e.clientY);
        const targetAnchor = elem && elem.closest('.input-anchor');
        
        if (targetAnchor) {
            // Dropped on an anchor. We should not show the tool creation menu.
            // We either create a connection or do nothing (if invalid).
            if (isValidConnectionTarget({ fromWindowId: fromWindow.id, toAnchor: targetAnchor, type: outputType })) {
                const toWindow = targetAnchor.closest('.tool-window');
                if (toWindow) { // self-connection check is in isValidConnectionTarget
                    createPermanentConnection(fromWindow, toWindow, outputType, targetAnchor);
                }
            }
            // If invalid, the user has already been alerted by isValidConnectionTarget.
            // We must clear the active connection state and stop.
            setActiveConnection(null);
            return;
        } else {
            // Not dropped on an anchor, show the tool creation menu.
            showToolsForConnection(outputType, e.clientX, e.clientY);
        }
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
        if (!touch) return;

        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetAnchor = elem && elem.closest('.input-anchor');

        if (targetAnchor) {
            // Dropped on an anchor. We should not show the tool creation menu.
            if (isValidConnectionTarget({ fromWindowId: fromWindow.id, toAnchor: targetAnchor, type: outputType })) {
                const toWindow = targetAnchor.closest('.tool-window');
                if (toWindow) {
                    createPermanentConnection(fromWindow, toWindow, outputType, targetAnchor);
                }
            }
            // If invalid, the user has already been alerted by isValidConnectionTarget.
            // We must clear the active connection state and stop.
            setActiveConnection(null);
            return;
        } else {
            // Not dropped on an anchor, show the tool creation menu.
            showToolsForConnection(outputType, touch.clientX, touch.clientY);
        }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
}

export function showConnectionEditMenu(e, connection) {
    const action = window.prompt('Edit Connection: Type "delete" to remove, "reroute" to reroute.');
    
    pushHistory(); // Save state before any action

    const connections = getConnections();
    if (action === 'delete') {
        const connIndex = getConnections().findIndex(c => c.id === connection.id);
        if (connIndex === -1) return;

        const connToRemove = getConnections()[connIndex];
        const toWinState = getToolWindow(connToRemove.toWindowId);

        // *** FIX: Revert the parameter mapping on the target node ***
        if (toWinState && toWinState.parameterMappings && toWinState.parameterMappings[connToRemove.toInput]) {
            // Find the original default value from the tool's schema
            const tool = getAvailableTools().find(t => t.toolId === toWinState.tool.toolId);
            const paramDef = tool?.inputSchema?.[connToRemove.toInput];
            const defaultValue = paramDef?.default !== undefined ? paramDef.default : '';

            toWinState.parameterMappings[connToRemove.toInput] = {
                type: 'static',
                value: defaultValue
            };
            rerenderToolWindowById(connToRemove.toWindowId); // Rerender to show the change
        }
        
        // Remove the connection from the state array
        getConnections().splice(connIndex, 1);
        
        persistState();
        renderAllConnections();

    } else if (action === 'reroute') {
        // We've already pushed history, so reroute will be part of this transaction
        startRerouteConnection(connection);
    }
}

export function startRerouteConnection(connection) {
    // Highlight the connection line (optional)
    document.querySelectorAll('.connection-line.permanent').forEach(line => {
        line.style.boxShadow = '';
    });
    // Find the line for this connection
    const fromWindow = document.getElementById(connection.fromWindowId);
    const toWindow = document.getElementById(connection.toWindowId);
    const fromAnchor = getAnchorPoint(fromWindow, connection.type, true);
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

        const elem = document.elementFromPoint(e.clientX, e.clientY);
        const targetAnchor = elem && elem.closest('.input-anchor');

        if (targetAnchor && isValidConnectionTarget({ fromWindowId: connection.fromWindowId, toAnchor: targetAnchor, type: connection.type })) {
            const newToWindow = targetAnchor.closest('.tool-window');
            
            // NOTE: history is pushed by the calling function (showConnectionEditMenu)
            const connections = getConnections();
            const idx = connections.findIndex(c => c.id === connection.id);

            if (idx !== -1) {
                const oldToWindowId = connections[idx].toWindowId;
                const oldToInput = connections[idx].toInput;
                const newToInput = targetAnchor.dataset.param || connection.type;

                // 1. Update parameter mapping on old target
                const oldToWinState = getToolWindow(oldToWindowId);
                if (oldToWinState && oldToWinState.parameterMappings && oldToWinState.parameterMappings[oldToInput]) {
                    delete oldToWinState.parameterMappings[oldToInput];
                }

                // 2. Update connection object
                connections[idx].toWindowId = newToWindow.id;
                connections[idx].toInput = newToInput;
                connections[idx].toDisplayName = newToWindow.dataset.displayName || '';

                // 3. Update parameter mapping on new target
                const newToWinState = getToolWindow(newToWindow.id);
                if (newToWinState) {
                    if (!newToWinState.parameterMappings) newToWinState.parameterMappings = {};
                    newToWinState.parameterMappings[newToInput] = {
                        type: 'nodeOutput',
                        nodeId: connection.fromWindowId,
                        outputKey: connection.type
                    };
                }
                
                persistState();
                renderAllConnections();
            }
        } else {
            // If drop was invalid or not on an anchor, just re-render original state
            // No history/state change, so no push/persist needed.
            if (targetAnchor) {
                // alert is shown in isValidConnectionTarget
            }
            renderAllConnections();
        }
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
} 