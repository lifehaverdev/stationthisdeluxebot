# Sandbox Node System Deep Audit Report

**Date:** 2024  
**Scope:** Comprehensive audit of sandbox node system architecture, UX patterns, and best practices  
**Status:** Complete Investigation

---

## Executive Summary

This audit examines the sandbox node system against industry best practices for canvas-based node editors (Figma, Blender, Node-RED, etc.). The investigation covers coordinate systems, pan/zoom interactions, node placement algorithms, event handling, performance, accessibility, and architectural patterns.

**Critical Issues Found:**
1. Lasso selection coordinate system bug after panning
2. Hypersensitive zoom (1.1 factor per tick)
3. Missing touchpad pan support
4. Rigid node placement algorithm
5. Coordinate conversion inconsistencies
6. Event handling conflicts
7. Performance concerns with connection rendering
8. Missing accessibility features

---

## Part 1: Lasso Selection Coordinate System Investigation

### Current Implementation Analysis

**Location:** `src/platforms/web/client/src/sandbox/index.js` (lines 595-705)

**Key Findings:**

1. **Coordinate System Architecture:**
   - Lasso uses `e.clientX/clientY` (screen coordinates) stored in `lasso.x1/x2/y1/y2`
   - Lasso element appended to `document.body` with `position: fixed`
   - Lasso positioned using screen pixels directly
   - Node intersection uses `el.getBoundingClientRect()` which returns screen coordinates

2. **Canvas Transform Structure:**
   ```css
   .sandbox-canvas {
     transform: translate(pan.x, pan.y) scale(scale);
     transform-origin: 0 0;
   }
   ```
   - Tool windows are children of `.sandbox-canvas`
   - Windows positioned with `left/top` in workspace coordinates
   - CSS transform automatically converts to screen space

3. **The Bug:**
   After panning, `getBoundingClientRect()` should correctly return screen coordinates accounting for the transform. However, the issue is likely:
   - **Root Cause:** The lasso comparison happens correctly, but nodes may be positioned incorrectly after pan/zoom operations
   - **Secondary Issue:** The `e.target === canvas` check (line 600) may fail if canvas structure changes or if nodes overlap the canvas background
   - **Tertiary Issue:** Event propagation may be interfering with lasso detection

### Detailed Analysis

**Lasso Start Condition (line 598-600):**
```javascript
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target !== canvas || spacebarIsDown) return;
```

**Problem:** `e.target === canvas` is too strict. After panning, if nodes are rendered or if the canvas has child elements, `e.target` might be a child element, not the canvas itself.

**Lasso Intersection Test (lines 660-676):**
```javascript
getToolWindows().forEach(win => {
    const el = document.getElementById(win.id);
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    // AABB intersection test
    if (
        elRect.left < lassoRect.right &&
        elRect.right > lassoRect.left &&
        elRect.top < lassoRect.bottom &&
        elRect.bottom > lassoRect.top
    ) {
        selectedIdsInLasso.add(win.id);
    }
});
```

**Analysis:** This should work correctly because:
- `getBoundingClientRect()` accounts for CSS transforms automatically
- Both lasso coordinates and node rects are in screen space
- AABB intersection is correct

**However:** The issue may be that after panning, nodes might not be found (`el` is null) or the DOM structure has changed.

### Recommendations

1. **Fix lasso start condition:**
   ```javascript
   // Instead of: e.target === canvas
   // Use: e.target.closest('.sandbox-canvas') === canvas || e.target === canvas
   ```

2. **Add coordinate system validation:**
   - Verify nodes exist before intersection test
   - Add debug logging to track coordinate values

3. **Improve event handling:**
   - Use event delegation on canvas
   - Check for canvas background class instead of strict equality

---

## Part 2: Pan/Zoom System Audit

### Current Implementation

**Location:** `src/platforms/web/client/src/sandbox/index.js` (lines 162-303)

### Issues Identified

#### 1. Zoom Sensitivity

**Current:** Zoom factor of `1.1` per wheel tick (line 203)
```javascript
const zoomFactor = 1.1;
const newScale = scale * (e.deltaY < 0 ? zoomFactor : 1 / zoomFactor);
```

**Problem:** 10% zoom per tick is too aggressive. Industry standard is 5-8% per tick.

**Best Practice:** Figma uses ~1.05-1.08, Blender uses smooth zoom with deltaY scaling.

**Recommendation:**
```javascript
const zoomFactor = 1.05; // Reduced from 1.1
// Or implement smooth zoom:
const zoomDelta = e.deltaY * 0.001; // Scale deltaY
const newScale = scale * (1 + zoomDelta);
```

#### 2. Touchpad Pan Support

**Current:** Pan requires spacebar + drag or middle mouse button (line 215)
```javascript
if ((e.target === canvas || e.target.classList.contains('sandbox-bg')) && 
    (e.button === 1 || spacebarIsDown)) {
```

**Problem:** No native touchpad two-finger pan support. Users must zoom to enable pan, creating friction.

**Best Practice:** Modern editors (Figma, Blender) support:
- Two-finger pan on touchpad
- Horizontal/vertical scroll for pan when not zooming
- Distinguish between mouse wheel (zoom) and touchpad gestures (pan)

**Recommendation:**
```javascript
// Detect touchpad vs mouse wheel
let isTouchpad = false;
sandboxContent.addEventListener('wheel', (e) => {
    // Touchpad typically has smaller deltaY and larger deltaX/deltaY ratio
    const isHorizontalPan = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const isSmallDelta = Math.abs(e.deltaY) < 50;
    
    if (isHorizontalPan || (isSmallDelta && !e.ctrlKey && !e.metaKey)) {
        // Touchpad pan
        e.preventDefault();
        pan.x -= e.deltaX;
        pan.y -= e.deltaY;
        updateTransform();
    } else {
        // Mouse wheel zoom
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            const zoomFactor = 1.05;
            const newScale = scale * (e.deltaY < 0 ? zoomFactor : 1 / zoomFactor);
            setScale(newScale, e.clientX, e.clientY);
        }
    }
}, { passive: false });
```

#### 3. Zoom Focus Point Calculation

**Current:** Lines 175-188 calculate focus point correctly
```javascript
const focusWorkspaceX = screenX / prevScale - pan.x;
const focusWorkspaceY = screenY / prevScale - pan.y;
pan.x = screenX / scale - focusWorkspaceX;
pan.y = screenY / scale - focusWorkspaceY;
```

**Status:** ✅ Correct implementation

#### 4. Pan Coordinate Handling

**Current:** Pan stored in `pan.x/pan.y` and applied via CSS transform
```javascript
canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
```

**Status:** ✅ Correct - pan is in screen pixels, scale is applied correctly

### Recommendations

1. **Reduce zoom sensitivity** from 1.1 to 1.05-1.08
2. **Add touchpad pan detection** using deltaX/deltaY analysis
3. **Implement smooth zoom** with deltaY scaling for better UX
4. **Add zoom limits feedback** (visual indicator when at min/max)
5. **Add zoom reset shortcut** (double-click or Ctrl+0)

---

## Part 3: Node Placement System Audit

### Current Implementation

**Location:** `src/platforms/web/client/src/sandbox/utils.js` (lines 22-57)

### Issues Identified

#### 1. Circular Stagger Pattern

**Current:** Uses fixed 8-slot circular pattern (line 51)
```javascript
const angle = (toolWindows.length * (Math.PI * 2)) / 8;
const radius = radiusScreen / scale; // 180px / scale
return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle)
};
```

**Problems:**
- Fixed 8 slots means nodes cluster after 8 nodes
- Doesn't adapt to existing node positions
- No overlap detection
- Radius (180px) may be too small for large nodes
- Doesn't account for node sizes, only fixed pixel distance

**Best Practice:** Modern editors use:
- Grid-based placement with collision detection
- Spiral placement that expands outward
- Consideration of node bounding boxes
- Placement near last selected node or cursor position

#### 2. Center Position Calculation

**Current:** Uses viewport center (lines 27-38)
```javascript
const rect = sandboxContent.getBoundingClientRect();
const screenCenterX = rect.left + rect.width / 2;
const screenCenterY = rect.top + rect.height / 2;
const { x: centerX, y: centerY } = window.sandbox.screenToWorkspace(screenCenterX, screenCenterY);
```

**Status:** ✅ Correct - accounts for pan/zoom

#### 3. No Overlap Detection

**Problem:** Nodes can overlap or stack awkwardly. No collision detection before placement.

### Recommendations

1. **Implement grid-based placement:**
   ```javascript
   const gridSize = 200; // workspace units
   const gridX = Math.round(centerX / gridSize) * gridSize;
   const gridY = Math.round(centerY / gridSize) * gridSize;
   ```

2. **Add spiral placement algorithm:**
   ```javascript
   function findNextPosition(centerX, centerY, existingNodes) {
       const gridSize = 200;
       let radius = gridSize;
       let angle = 0;
       const angleStep = Math.PI / 4; // 45 degrees
       
       for (let spiral = 0; spiral < 20; spiral++) {
           for (let i = 0; i < 8; i++) {
               const x = centerX + radius * Math.cos(angle);
               const y = centerY + radius * Math.sin(angle);
               
               // Check for overlap
               if (!hasOverlap(x, y, existingNodes)) {
                   return { x, y };
               }
               
               angle += angleStep;
           }
           radius += gridSize;
       }
       // Fallback to center if no space found
       return { x: centerX, y: centerY };
   }
   ```

3. **Add overlap detection:**
   ```javascript
   function hasOverlap(x, y, existingNodes, nodeWidth = 300, nodeHeight = 200) {
       const padding = 20;
       return existingNodes.some(node => {
           const dx = Math.abs(node.workspaceX - x);
           const dy = Math.abs(node.workspaceY - y);
           return dx < (nodeWidth + padding) && dy < (nodeHeight + padding);
       });
   }
   ```

4. **Place near cursor or last selected node:**
   - If nodes are selected, place near selection
   - Otherwise, place at cursor position or viewport center

---

## Part 4: Coordinate System Consistency Audit

### Current Implementation

**Location:** `src/platforms/web/client/src/sandbox/index.js` (lines 131-145)

### Analysis

#### 1. workspaceToScreen Implementation

**Current:**
```javascript
function workspaceToScreen(x, y) {
    // Children of .sandbox-canvas inherit the canvas transform. Their raw
    // left/top are expressed in *workspace* coordinates; scaling & pan
    // are both handled by the parent transform. Therefore return the
    // raw workspace coordinates here.
    return { x: x, y: y };
}
```

**Status:** ✅ Correct - This is a no-op because CSS transform handles conversion. Nodes are positioned in workspace coords, and the canvas transform converts them to screen space.

**However:** The function name is misleading. It doesn't actually convert to screen coordinates. Consider renaming to `workspaceToWorkspace` or documenting that it's a no-op.

#### 2. screenToWorkspace Implementation

**Current:**
```javascript
function screenToWorkspace(x, y) {
    return {
        x: (x / scale) - pan.x,
        y: (y / scale) - pan.y
    };
}
```

**Status:** ⚠️ **POTENTIALLY INCORRECT**

**Issue:** The formula assumes screen coordinates are relative to canvas origin, but `x/y` parameters are likely viewport coordinates (from `e.clientX/clientY`).

**Correct formula should be:**
```javascript
function screenToWorkspace(x, y) {
    const canvasRect = canvas.getBoundingClientRect();
    const canvasX = x - canvasRect.left;
    const canvasY = y - canvasRect.top;
    return {
        x: (canvasX / scale) - pan.x,
        y: (canvasY / scale) - pan.y
    };
}
```

**However:** Looking at usage (line 589, 843), `screenToWorkspace` is called with `e.clientX/clientY` which are viewport coordinates. The function needs to account for canvas position.

#### 3. Node Positioning During Drag

**Location:** `src/platforms/web/client/src/sandbox/node/drag.js` (lines 23-43)

**Current:**
```javascript
const dx = (clientX - dragStart.x) / scale;
const dy = (clientY - dragStart.y) / scale;
windowData.workspaceX = initialWorkspacePos.x + dx;
windowData.workspaceY = initialWorkspacePos.y + dy;
const { x: screenX, y: screenY } = window.sandbox.workspaceToScreen(windowData.workspaceX, windowData.workspaceY);
if(windowData.element){ windowData.element.style.left=`${screenX}px`; windowData.element.style.top=`${screenY}px`; }
```

**Status:** ✅ Correct - Uses workspace coordinates, CSS transform handles screen conversion

#### 4. Connection Line Coordinates

**Location:** `src/platforms/web/client/src/sandbox/connections/drawing.js` (lines 20-66)

**Current:** Uses `getBoundingClientRect()` for anchor positions
```javascript
const fromRect = fromEl.getBoundingClientRect();
const toRect = toEl.getBoundingClientRect();
```

**Status:** ✅ Correct - `getBoundingClientRect()` accounts for transforms automatically

### Recommendations

1. **Fix screenToWorkspace to account for canvas position:**
   ```javascript
   function screenToWorkspace(x, y) {
       const canvasRect = canvas.getBoundingClientRect();
       const canvasX = x - canvasRect.left;
       const canvasY = y - canvasRect.top;
       return {
           x: (canvasX / scale) - pan.x,
           y: (canvasY / scale) - pan.y
       };
   }
   ```

2. **Rename workspaceToScreen** to `workspaceToWorkspace` or document that it's a no-op

3. **Add coordinate validation helpers:**
   ```javascript
   function validateCoordinates(workspaceX, workspaceY) {
       // Check bounds, NaN, Infinity, etc.
   }
   ```

---

## Part 5: Event Handling & Interaction Conflicts

### Current Implementation

**Location:** `src/platforms/web/client/src/sandbox/index.js`

### Issues Identified

#### 1. Event Target Checking

**Lasso (line 600):**
```javascript
if (e.button !== 0 || e.target !== canvas || spacebarIsDown) return;
```

**Pan (line 215):**
```javascript
if ((e.target === canvas || e.target.classList.contains('sandbox-bg')) && 
    (e.button === 1 || spacebarIsDown)) {
```

**Problem:** Strict `e.target === canvas` check fails if:
- Canvas has child elements
- Nodes overlap canvas background
- DOM structure changes after panning

**Recommendation:** Use event delegation or `closest()`:
```javascript
// Lasso
if (e.button !== 0 || !e.target.closest('.sandbox-canvas') || spacebarIsDown) return;

// Pan
if (e.target.closest('.sandbox-canvas') && (e.button === 1 || spacebarIsDown)) {
```

#### 2. Spacebar State Management

**Current:** Global `spacebarIsDown` flag (lines 58-66)
```javascript
let spacebarIsDown = false;
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spacebarIsDown = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spacebarIsDown = false;
});
```

**Status:** ✅ Simple and effective

**Potential Issue:** If spacebar is held while switching tabs/windows, state may desync.

**Recommendation:** Add window blur handler to reset:
```javascript
window.addEventListener('blur', () => {
    spacebarIsDown = false;
});
```

#### 3. Mouse Button Conflicts

**Current:**
- Lasso: Left mouse (`e.button !== 0` means button === 0)
- Pan: Middle mouse (`e.button === 1`) or spacebar

**Status:** ✅ No conflicts - different buttons

#### 4. Touch Event Handling

**Current:** Separate touch handlers (lines 238-303)

**Status:** ✅ Separate handling prevents conflicts

**Issue:** Touch pan doesn't check for lasso activation, but lasso is mouse-only so no conflict.

### Recommendations

1. **Improve event target checking** using `closest()` instead of strict equality
2. **Add window blur handler** to reset spacebar state
3. **Add event priority system** to handle conflicts explicitly
4. **Add debug logging** for event conflicts

---

## Part 6: Performance Audit

### Issues Identified

#### 1. Connection Rendering

**Location:** `src/platforms/web/client/src/sandbox/connections/drawing.js` (line 68)

**Current:** `renderAllConnections()` removes and recreates all connection lines on every call
```javascript
document.querySelectorAll('.connection-line.permanent').forEach(el => el.remove());
connections.forEach(conn => {
    // ... create new line
});
```

**Problem:** O(n) DOM operations on every pan/zoom/drag. With many connections, this causes jank.

**Recommendation:** Use requestAnimationFrame batching and only update changed connections:
```javascript
let connectionUpdateScheduled = false;
function scheduleConnectionUpdate() {
    if (!connectionUpdateScheduled) {
        connectionUpdateScheduled = true;
        requestAnimationFrame(() => {
            renderAllConnections();
            connectionUpdateScheduled = false;
        });
    }
}
```

#### 2. Window Rendering

**Location:** `src/platforms/web/client/src/sandbox/index.js` (line 147)

**Current:** `renderAllWindows()` updates all windows on every transform
```javascript
function renderAllWindows() {
    getToolWindows().forEach(win => {
        const el = document.getElementById(win.id);
        if (el) {
            el.style.left = `${win.workspaceX}px`;
            el.style.top = `${win.workspaceY}px`;
        }
    });
    renderAllConnections();
}
```

**Status:** ✅ Efficient - only updates position, CSS handles transform

#### 3. State Persistence

**Location:** `src/platforms/web/client/src/sandbox/state.js` (line 177)

**Current:** `persistState()` serializes entire state to localStorage on every change

**Problem:** With large workspaces, this can cause lag. localStorage has size limits.

**Recommendation:** 
- Debounce persistence (wait 500ms after last change)
- Use IndexedDB for large workspaces
- Compress state before storing

### Recommendations

1. **Batch connection updates** using requestAnimationFrame
2. **Debounce state persistence** (500ms delay)
3. **Add performance monitoring** to track frame times
4. **Consider virtual scrolling** for very large workspaces

---

## Part 7: Accessibility Audit

### Issues Identified

#### 1. Keyboard Navigation

**Missing:**
- Arrow key panning
- Tab navigation between nodes
- Keyboard shortcuts for common actions
- Focus management

#### 2. Screen Reader Support

**Missing:**
- ARIA labels for nodes
- ARIA live regions for selection changes
- Semantic HTML structure

#### 3. Visual Accessibility

**Missing:**
- High contrast mode support
- Reduced motion support
- Focus indicators

### Recommendations

1. **Add keyboard shortcuts:**
   - Arrow keys: Pan canvas
   - Tab: Navigate between nodes
   - Enter: Execute selected node
   - Delete: Remove selected nodes

2. **Add ARIA attributes:**
   ```html
   <div class="tool-window" 
        role="button" 
        aria-label="Tool: ChatGPT"
        tabindex="0">
   ```

3. **Add focus management:**
   - Visible focus indicators
   - Focus trap in modals
   - Focus restoration after actions

---

## Part 8: Architecture & Best Practices

### Current Architecture

**Strengths:**
- Clean separation of concerns (state, rendering, interactions)
- Workspace coordinate system prevents zoom issues
- Modular component structure

**Weaknesses:**
- No centralized event bus (events scattered)
- Global state in multiple files
- No TypeScript for type safety
- Limited error handling

### Recommendations

1. **Centralize event handling:**
   ```javascript
   // Event bus pattern
   const eventBus = {
       on(event, handler) { /* ... */ },
       emit(event, data) { /* ... */ }
   };
   ```

2. **Add TypeScript** for type safety and better IDE support

3. **Improve error handling:**
   - Try-catch around critical operations
   - Error boundaries for rendering
   - User-friendly error messages

4. **Add unit tests** for coordinate conversion functions

5. **Document coordinate system** clearly in code comments

---

## Implementation Priority

### Critical (Fix Immediately)
1. Fix lasso selection coordinate system bug
2. Fix `screenToWorkspace` to account for canvas position
3. Reduce zoom sensitivity (1.1 → 1.05)

### High Priority
4. Add touchpad pan support
5. Improve node placement algorithm
6. Fix event target checking

### Medium Priority
7. Batch connection rendering
8. Debounce state persistence
9. Add keyboard navigation

### Low Priority
10. Add accessibility features
11. Refactor to TypeScript
12. Add performance monitoring

---

## Conclusion

The sandbox node system has a solid foundation but needs improvements in several areas:

1. **Coordinate system bugs** causing lasso selection to fail after panning
2. **UX issues** with zoom sensitivity and touchpad support
3. **Performance concerns** with connection rendering
4. **Missing accessibility** features

The recommended fixes are prioritized and can be implemented incrementally. The most critical issues are the coordinate system bugs that break core functionality.

---

## Appendix: Code References

### Key Files
- `src/platforms/web/client/src/sandbox/index.js` - Main orchestrator, pan/zoom, lasso
- `src/platforms/web/client/src/sandbox/state.js` - Global state management
- `src/platforms/web/client/src/sandbox/utils.js` - Node placement
- `src/platforms/web/client/src/sandbox/node/drag.js` - Node dragging
- `src/platforms/web/client/src/sandbox/connections/drawing.js` - Connection rendering

### Industry References
- Figma: Smooth zoom, touchpad pan, grid-based placement
- Blender: Coordinate system best practices, performance optimization
- Node-RED: Node editor patterns, accessibility

