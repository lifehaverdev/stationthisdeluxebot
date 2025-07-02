import { makeDraggable } from '../canvas.js';
import { calculateCenterPosition } from '../utils.js';

// Create image in sandbox
export function createImageInSandbox(src, position) {
    const sandbox = document.querySelector('.sandbox-content');
    if (!sandbox) return;

    const container = document.createElement('div');
    container.className = 'sandbox-item image-item';
    
    const img = document.createElement('img');
    img.src = src;
    
    container.appendChild(img);
    makeDraggable(container, container);

    if (position) {
        container.style.left = `${position.x}px`;
        container.style.top = `${position.y}px`;
    } else {
        const center = calculateCenterPosition([]);
        container.style.left = `${center.x}px`;
        container.style.top = `${center.y}px`;
    }

    sandbox.appendChild(container);
} 