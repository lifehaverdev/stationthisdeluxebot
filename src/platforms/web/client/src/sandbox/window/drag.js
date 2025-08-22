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
    dragging = true;
    offset.x = e.clientX - target.offsetLeft;
    offset.y = e.clientY - target.offsetTop;
    handle.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    target.style.left = `${e.clientX - offset.x}px`;
    target.style.top = `${e.clientY - offset.y}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'move';
  });
}
