# Mobile Drag Rerender Fix - 2024-12-19

## Bug Description
On mobile devices, windows in the sandbox could be clicked to drag but wouldn't move until the user zoomed or panned in the sandbox. The issue was that tap drags weren't triggering rerenders, while click drags worked fine.

## Root Cause Analysis
- **ToolWindow** and **SpellWindow** use `setupDragging` from `node/drag.js` which has proper touch event support
- **CollectionWindow** and **UploadWindow** extend **BaseWindow** directly and use `enableDrag` from `window/drag.js` which only handled mouse events
- The `enableDrag` function was missing touch event listeners (`touchstart`, `touchmove`, `touchend`)

## Files Modified
- `src/platforms/web/client/src/sandbox/window/drag.js` - Added touch event support to `enableDrag` function

## Fix Details
- Refactored `enableDrag` to use unified `startDrag`, `drag`, and `endDrag` functions that handle both mouse and touch events
- Added touch event listeners with `{ passive: false }` to prevent default browser behavior
- Maintained existing mouse event functionality
- Added proper touch coordinate extraction using `e.touches[0].clientX/clientY`

## Verification Steps
1. Test CollectionWindow drag on mobile - should now work immediately
2. Test UploadWindow drag on mobile - should now work immediately  
3. Verify ToolWindow drag still works (was already working)
4. Verify mouse drag still works on desktop

## Severity
S2 - Major feature broken on mobile devices

## Status
✅ **FIXED** - Touch event support added to enableDrag function
