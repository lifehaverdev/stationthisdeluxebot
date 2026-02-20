/**
 * Viewport — imperative zoom/pan/touch/lasso controller for the sandbox canvas.
 *
 * Pure imperative module. All transforms applied directly to element.style
 * for 60fps performance. No virtual DOM, no setState.
 *
 * Usage:
 *   const vp = createViewport({ canvasEl, contentEl, state, connections });
 *   vp.destroy(); // cleanup
 */

const MIN_SCALE = 0.2;
const MAX_SCALE = 4.0;
const GRID_SIZE = 32;
const PAN_DAMPING = 0.4;
const ZOOM_FACTOR = 1.05;
const TOUCH_ZOOM_SENSITIVITY = 0.3;
const LASSO_MIN_SIZE = 10;

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.canvasEl   - .sandbox-canvas element
 * @param {HTMLElement} opts.contentEl  - .sandbox-content element
 * @param {Object} opts.state          - state.js module (lasso, selectNode, clearSelection, etc.)
 * @param {Object} opts.connections    - connections module (renderAllConnections)
 */
export function createViewport({ canvasEl, contentEl, state, connections }) {
  let scale = 1;
  let pan = { x: 0, y: 0 };
  let spacebarDown = false;
  const lasso = state.lasso;

  // ── Coordinate transforms ─────────────────────────────────
  function screenToWorkspace(x, y) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: ((x - rect.left) / scale) - pan.x,
      y: ((y - rect.top) / scale) - pan.y
    };
  }

  function workspaceToScreen(x, y) {
    return { x, y };
  }

  // ── Transform ─────────────────────────────────────────────
  function applyTransform() {
    canvasEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    const bg = GRID_SIZE * scale;
    canvasEl.style.backgroundSize = `${bg}px ${bg}px, ${bg}px ${bg}px`;
    refreshWindows();
  }

  function refreshWindows() {
    state.getToolWindows().forEach(win => {
      const el = document.getElementById(win.id);
      if (el) {
        el.style.left = `${win.workspaceX}px`;
        el.style.top = `${win.workspaceY}px`;
      }
    });
    connections.renderAllConnections();
  }

  function setScaleAt(newScale, focusX, focusY) {
    const prev = scale;
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    if (focusX !== undefined) {
      const rect = canvasEl.getBoundingClientRect();
      const cx = focusX - rect.left, cy = focusY - rect.top;
      const wx = (cx / prev) - pan.x, wy = (cy / prev) - pan.y;
      pan.x += ((cx / scale) - wx - pan.x) * PAN_DAMPING;
      pan.y += ((cy / scale) - wy - pan.y) * PAN_DAMPING;
    }
    applyTransform();
  }

  // ── Keyboard ──────────────────────────────────────────────
  const onKeyDown = (e) => { if (e.code === 'Space') spacebarDown = true; };
  const onKeyUp = (e) => { if (e.code === 'Space') spacebarDown = false; };
  const onBlur = () => { spacebarDown = false; };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ── Wheel ─────────────────────────────────────────────────
  function onWheel(e) {
    const isHoriz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const isSmall = Math.abs(e.deltaY) < 50 && Math.abs(e.deltaX) < 50;
    if ((isHoriz || isSmall) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      pan.x -= e.deltaX; pan.y -= e.deltaY;
      applyTransform();
    } else if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      setScaleAt(scale * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR), e.clientX, e.clientY);
    }
  }
  contentEl.addEventListener('wheel', onWheel, { passive: false });

  // ── Mouse pan ─────────────────────────────────────────────
  let isPanning = false, startM = { x: 0, y: 0 }, panStart = { x: 0, y: 0 };
  function isBg(target) {
    return target === canvasEl || target.classList?.contains('sandbox-bg');
  }
  function onMouseDown(e) {
    if (e.target.closest('.tool-window, .spell-window') && e.button !== 1) return;
    if (isBg(e.target) && (e.button === 1 || spacebarDown)) {
      isPanning = true;
      startM = { x: e.clientX, y: e.clientY };
      panStart = { ...pan };
      contentEl.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }
  function onMouseMove(e) {
    if (!isPanning) return;
    pan.x = panStart.x + (e.clientX - startM.x);
    pan.y = panStart.y + (e.clientY - startM.y);
    applyTransform();
  }
  function onMouseUp() { isPanning = false; contentEl.style.cursor = ''; }
  contentEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // ── Touch ─────────────────────────────────────────────────
  let lastDist = null, lastCenter = null;
  function onTouchStart(e) {
    if (e.touches.length === 1) {
      if (e.target.closest('.tool-window, .spell-window')) return;
      if (isBg(e.target)) {
        isPanning = true;
        startM = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        panStart = { ...pan };
      }
    } else if (e.touches.length === 2) {
      isPanning = false;
      lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      lastCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
  }
  function onTouchMove(e) {
    if (isPanning && e.touches.length === 1) {
      e.preventDefault();
      pan.x = panStart.x + (e.touches[0].clientX - startM.x);
      pan.y = panStart.y + (e.touches[0].clientY - startM.y);
      applyTransform();
    } else if (e.touches.length === 2 && lastDist) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const c = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      setScaleAt(scale * (1 + (d / lastDist - 1) * TOUCH_ZOOM_SENSITIVITY), c.x, c.y);
      pan.x += c.x - lastCenter.x; pan.y += c.y - lastCenter.y;
      applyTransform();
      lastDist = d; lastCenter = c;
    }
  }
  function onTouchEnd(e) {
    if (!e.touches.length) isPanning = false;
    if (e.touches.length < 2) { lastDist = null; lastCenter = null; }
  }
  contentEl.addEventListener('touchstart', onTouchStart, { passive: false });
  contentEl.addEventListener('touchmove', onTouchMove, { passive: false });
  contentEl.addEventListener('touchend', onTouchEnd);

  // ── Lasso ─────────────────────────────────────────────────
  function onLassoDown(e) {
    if (e.target.closest('.tool-window, .spell-window')) return;
    const isCanvas = e.target === canvasEl || e.target.closest('.sandbox-canvas') ||
                     e.target.classList?.contains('sandbox-bg') || e.target === contentEl;
    if (e.button !== 0 || !isCanvas || spacebarDown) return;
    lasso.active = true;
    lasso.x1 = e.clientX; lasso.y1 = e.clientY;
    if (!lasso.element) {
      lasso.element = document.createElement('div');
      lasso.element.className = 'lasso-rect';
      document.body.appendChild(lasso.element);
    }
    lasso.element.style.display = 'block';
    updateLasso(e);
    e.preventDefault(); e.stopPropagation();
  }
  function onLassoMove(e) { if (lasso.active) updateLasso(e); }
  function onLassoUp(e) {
    if (!lasso.active) return;
    if (e.target.closest('.tool-window, .spell-window')) {
      lasso.active = false;
      if (lasso.element) lasso.element.style.display = 'none';
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (lasso.element) lasso.element.style.display = 'none';
    const dx = Math.abs(lasso.x1 - lasso.x2), dy = Math.abs(lasso.y1 - lasso.y2);
    lasso.active = false;
    if (dx < LASSO_MIN_SIZE && dy < LASSO_MIN_SIZE) return;

    // Suppress next click
    const suppress = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); document.removeEventListener('click', suppress, true); };
    document.addEventListener('click', suppress, true);

    const r = { left: Math.min(lasso.x1, lasso.x2), right: Math.max(lasso.x1, lasso.x2), top: Math.min(lasso.y1, lasso.y2), bottom: Math.max(lasso.y1, lasso.y2) };
    const hits = new Set();
    state.getToolWindows().forEach(win => {
      const el = document.getElementById(win.id);
      if (!el) return;
      const b = el.getBoundingClientRect();
      if (b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) hits.add(win.id);
    });
    if (!e.shiftKey) state.clearSelection();
    hits.forEach(id => state.selectNode(id, true));
  }
  function updateLasso(e) {
    if (!lasso.element) return;
    lasso.x2 = e.clientX; lasso.y2 = e.clientY;
    Object.assign(lasso.element.style, {
      left: `${Math.min(lasso.x1, lasso.x2)}px`, top: `${Math.min(lasso.y1, lasso.y2)}px`,
      width: `${Math.abs(lasso.x1 - lasso.x2)}px`, height: `${Math.abs(lasso.y1 - lasso.y2)}px`
    });
  }
  contentEl.addEventListener('mousedown', onLassoDown);
  document.addEventListener('mousemove', onLassoMove);
  document.addEventListener('mouseup', onLassoUp);

  // ── Init ──────────────────────────────────────────────────
  applyTransform();

  // ── API ───────────────────────────────────────────────────
  const api = {
    screenToWorkspace, workspaceToScreen,
    getScale: () => scale,
    getPan: () => ({ ...pan }),
    getGridSize: () => GRID_SIZE,
    applyTransform, refreshWindows,
    destroy() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      contentEl.removeEventListener('wheel', onWheel);
      contentEl.removeEventListener('mousedown', onMouseDown);
      contentEl.removeEventListener('mousedown', onLassoDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousemove', onLassoMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mouseup', onLassoUp);
      contentEl.removeEventListener('touchstart', onTouchStart);
      contentEl.removeEventListener('touchmove', onTouchMove);
      contentEl.removeEventListener('touchend', onTouchEnd);
      if (lasso.element) { lasso.element.remove(); lasso.element = null; }
      delete window.sandbox;
    }
  };

  window.sandbox = api;
  return api;
}
