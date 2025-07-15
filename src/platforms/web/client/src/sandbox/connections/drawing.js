import { getConnections } from '../state.js';
import { getAnchorPoint } from './anchors.js';
import { showConnectionEditMenu } from './interaction.js';

export function updateConnectionLine(startX, startY, endX, endY) {
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

export function drawConnectionLine(fromEl, toEl, type, isPermanent = true, connection = null) {
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

export function updateAllConnections() {
    const connections = getConnections();
    connections.forEach(updatePermanentConnection);
} 