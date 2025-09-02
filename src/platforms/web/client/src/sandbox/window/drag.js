// src/platforms/web/client/src/sandbox/window/drag.js
// Simplest possible drag handler usable by any window.

/**
 * Enable drag behaviour for an element using a handle (e.g., header).
 * @param {HTMLElement} target – element whose position will change.
 * @param {HTMLElement} handle – element that receives the mouse events.
 */
export function enableDrag(target, handle) {
  let dragging = false;
  const offset = { x: 0, y: 0 };

  handle.style.cursor = 'move';
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const scale = (window.sandbox && window.sandbox.getScale) ? window.sandbox.getScale() : 1;
    dragging = true;
    offset.x = (e.clientX / scale) - target.offsetLeft;
    offset.y = (e.clientY / scale) - target.offsetTop;
    handle.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const scale = (window.sandbox && window.sandbox.getScale) ? window.sandbox.getScale() : 1;
    const newWorkspaceX = (e.clientX / scale) - offset.x;
    const newWorkspaceY = (e.clientY / scale) - offset.y;

    target.style.left = `${newWorkspaceX}px`;
    target.style.top  = `${newWorkspaceY}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'move';
  });
}
