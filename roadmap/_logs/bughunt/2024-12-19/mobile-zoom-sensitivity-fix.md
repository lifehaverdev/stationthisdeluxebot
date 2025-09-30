# Mobile Zoom Sensitivity Fix - 2024-12-19

## Bug Description
Mobile sandbox zoom was too sensitive, causing everything to move around in an unwieldy way when users tried to pinch-zoom. The direct ratio calculation `scale * (newDist / lastTouchDist)` made even small finger movements result in large zoom changes.

## Root Cause Analysis
- Pinch zoom implementation used direct distance ratio without any damping
- Mobile touch events are inherently more sensitive than mouse wheel events
- No sensitivity adjustment was applied for touch-based zoom interactions

## Files Modified
- `src/platforms/web/client/src/sandbox/index.js` - Added zoom sensitivity damping for mobile pinch zoom

## Fix Details
- Added `zoomSensitivity` damping factor of 0.3 (30% of original sensitivity)
- Implemented damped ratio calculation: `1 + (distanceRatio - 1) * zoomSensitivity`
- Added documentation comment explaining the mobile zoom sensitivity reduction
- Maintained existing pan functionality during pinch zoom

## Technical Implementation
```javascript
// Reduced sensitivity for mobile pinch zoom
const zoomSensitivity = 0.3; // Lower = less sensitive (0.1-0.5 range)
const distanceRatio = newDist / lastTouchDist;
const dampedRatio = 1 + (distanceRatio - 1) * zoomSensitivity;
setScale(scale * dampedRatio, newCenter.x, newCenter.y);
```

## Verification Steps
1. Test pinch zoom on mobile devices - should be much less sensitive
2. Verify zoom still works but requires more finger movement
3. Ensure pan functionality still works during pinch zoom
4. Test that zoom limits (0.2x to 4.0x) are still respected

## Severity
S2 - Major UX issue on mobile devices

## Status
✅ **FIXED** - Mobile zoom sensitivity reduced by 70% via damping factor
