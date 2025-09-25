// src/platforms/web/client/src/sandbox/window/drag.js
// Simplest possible drag handler usable by any window.

/**
 * Enable drag behaviour for an element using a handle (e.g., header).
 * @param {HTMLElement} target – element whose position will change.
 * @param {HTMLElement} handle – element that receives the mouse/touch events.
 */
export function enableDrag(target, handle) {
  let dragging = false;
  const offset = { x: 0, y: 0 };

  handle.style.cursor = 'move';

  const startDrag = (e, isTouch = false) => {
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    
    if (!isTouch && e.button !== 0) return;
    
    const scale = (window.sandbox && window.sandbox.getScale) ? window.sandbox.getScale() : 1;
    dragging = true;
    offset.x = (clientX / scale) - target.offsetLeft;
    offset.y = (clientY / scale) - target.offsetTop;
    handle.style.cursor = 'grabbing';
    
    if (isTouch) e.preventDefault();
  };

  const drag = (e, isTouch = false) => {
    if (!dragging) return;
    if (isTouch) e.preventDefault();

    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const scale = (window.sandbox && window.sandbox.getScale) ? window.sandbox.getScale() : 1;
    const newWorkspaceX = (clientX / scale) - offset.x;
    const newWorkspaceY = (clientY / scale) - offset.y;

    target.style.left = `${newWorkspaceX}px`;
    target.style.top  = `${newWorkspaceY}px`;
  };

  const endDrag = (e, isTouch = false) => {
    if (!dragging) return;
    if (isTouch) e.preventDefault();
    
    dragging = false;
    handle.style.cursor = 'move';
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
