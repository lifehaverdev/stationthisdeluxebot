import { setActiveConnection, setConnectionLine, getConnections } from './state.js';
import { showToolsForConnection } from './toolSelection.js';

export function startConnection(event, outputType, fromWindow) {
    console.log('startConnection called', { outputType, fromWindow });
    setActiveConnection({
        startX: event.clientX,
        startY: event.clientY,
        outputType,
        fromWindow
    });

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

        const targetAnchor = e.target.closest('.input-anchor');

        if (targetAnchor && targetAnchor.dataset.type === outputType) {
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

        // Find the element under the finger
        const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
        if (touch) {
            const elem = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetAnchor = elem && elem.closest('.input-anchor');
            if (targetAnchor && targetAnchor.dataset.type === outputType) {
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

export function createPermanentConnection(fromWindow, toWindow, type) {
    const connection = document.createElement('div');
    connection.className = 'connection-line permanent';
    connection.style.cssText = `
        position: fixed;
        pointer-events: none;
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
    `;
    document.body.appendChild(connection);

    const connectionData = {
        element: connection,
        from: fromWindow,
        to: toWindow,
        type: type
    };
    
    const connections = getConnections();
    connections.push(connectionData);
    updatePermanentConnection(connectionData);

    return connectionData;
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