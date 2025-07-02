import { connections, setConnectionLine, setActiveConnection as setGlobalActiveConnection, getActiveConnection as getGlobalActiveConnection } from './state.js';

let connectionLine = null;

// Create a connection line element
export function createConnectionLine() {
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
    connectionLine = line;
    setConnectionLine(line);
    return line;
}

// Update connection line position
export function updateConnectionLine(startX, startY, endX, endY) {
    if (!connectionLine) return;

    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    connectionLine.style.width = `${length}px`;
    connectionLine.style.left = `${startX}px`;
    connectionLine.style.top = `${startY}px`;
    connectionLine.style.transform = `rotate(${angle}rad)`;
}

// Make an element draggable
export function makeDraggable(element, handle) {
    let offsetX, offsetY;
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    handle.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === handle) {
            isDragging = true;
        }
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            element.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }

    function dragEnd() {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }
}

// Initialize canvas event listeners
export function initCanvas() {
    // Initialize canvas-related elements
    const rippleElement = document.createElement('img');
    rippleElement.src = '/images/workspace/circularwaterripple.gif';
    rippleElement.className = 'click-ripple';
    document.body.appendChild(rippleElement);

    document.addEventListener('click', (e) => {
        const sandbox = document.querySelector('.sandbox-content');
        if (!sandbox || !sandbox.contains(e.target)) return;

        // Show ripple effect
        rippleElement.style.left = `${e.clientX}px`;
        rippleElement.style.top = `${e.clientY}px`;
        rippleElement.classList.add('active');

        // Hide ripple after animation
        setTimeout(() => {
            rippleElement.classList.remove('active');
        }, 300);
    });
}

export function setActiveConnection(connection) {
    setGlobalActiveConnection(connection);
}

export function getActiveConnection() {
    return getGlobalActiveConnection();
}

export function clearConnectionLine() {
    if (connectionLine) {
        connectionLine.remove();
        connectionLine = null;
        setConnectionLine(null);
    }
} 