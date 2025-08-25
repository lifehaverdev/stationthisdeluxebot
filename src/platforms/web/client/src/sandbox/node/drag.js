import { updateToolWindowPosition, pushHistory, persistState } from '../state.js';
import { renderAllConnections } from '../connections/index.js';

// Setup dragging functionality
export function setupDragging(windowData, handle) {
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let initialWorkspacePos = { x: 0, y: 0 };

    const startDrag = (e, isTouch = false) => {
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        
        isDragging = true;
        dragStart = { x: clientX, y: clientY };
        initialWorkspacePos = { x: windowData.workspaceX, y: windowData.workspaceY };
        
        if(windowData.element){ windowData.element.style.cursor='grabbing'; }
        if(handle){ handle.style.cursor='grabbing'; }
        if (isTouch) e.preventDefault();
    };

    const drag = (e, isTouch = false) => {
        if (!isDragging) return;
        if (isTouch) e.preventDefault();

        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        const scale = window.sandbox.getScale();

        const dx = (clientX - dragStart.x) / scale;
        const dy = (clientY - dragStart.y) / scale;

        windowData.workspaceX = initialWorkspacePos.x + dx;
        windowData.workspaceY = initialWorkspacePos.y + dy;
        
        // Convert workspace → screen so the element tracks the cursor exactly
        const { x: screenX, y: screenY } = window.sandbox.workspaceToScreen(windowData.workspaceX, windowData.workspaceY);
        if(windowData.element){ windowData.element.style.left=`${screenX}px`; windowData.element.style.top=`${screenY}px`; }

        // Update all connections in real-time
        renderAllConnections();
    };

    const endDrag = (e, isTouch = false) => {
        if (!isDragging) return;
        if (isTouch) e.preventDefault();
        
        // Push history before making the final state change
        pushHistory();

        const gridSize = window.sandbox.getGridSize();
        const finalX = Math.round(windowData.workspaceX / gridSize) * gridSize;
        const finalY = Math.round(windowData.workspaceY / gridSize) * gridSize;

        updateToolWindowPosition(windowData.id, finalX, finalY);
        
        // Persist the final state
        persistState();
        
        // Final render after snap
        const { x: snapScreenX, y: snapScreenY } = window.sandbox.workspaceToScreen(finalX, finalY);
        if(windowData.element){ windowData.element.style.left = `${snapScreenX}px`; windowData.element.style.top = `${snapScreenY}px`;  }
        
        isDragging = false;
        if(windowData.element) windowData.element.style.cursor = '';
        if(handle) handle.style.cursor = 'move';
    };

    // Mouse Events
    handle.addEventListener('mousedown', (e) => startDrag(e, false));
    document.addEventListener('mousemove', (e) => drag(e, false));
    document.addEventListener('mouseup', (e) => endDrag(e, false));

    // Touch Events
    handle.addEventListener('touchstart', (e) => startDrag(e, true), { passive: false });
    document.addEventListener('touchmove', (e) => drag(e, true), { passive: false });
    document.addEventListener('touchend', (e) => endDrag(e, true), { passive: false });
} 