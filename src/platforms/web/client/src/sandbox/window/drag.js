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
    const rect = target.getBoundingClientRect();
    dragging = true;
    offset.x = e.clientX - rect.left;
    offset.y = e.clientY - rect.top;
    handle.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const scale = (window.sandbox && window.sandbox.getScale) ? window.sandbox.getScale() : 1;
    const newLeftScreen = e.clientX - offset.x;
    const newTopScreen  = e.clientY - offset.y;

    // Convert screen coords -> workspace (unscaled)
    let newLeft = newLeftScreen, newTop = newTopScreen;
    if (window.sandbox && typeof window.sandbox.screenToWorkspace === 'function') {
      ({ x: newLeft, y: newTop } = window.sandbox.screenToWorkspace(newLeftScreen, newTopScreen));
    } else {
      newLeft /= scale; newTop /= scale;
    }

    target.style.left = `${newLeft}px`;
    target.style.top  = `${newTop}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'move';
  });
}
