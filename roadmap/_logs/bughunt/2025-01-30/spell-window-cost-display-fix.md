# Spell Window Cost Display Fix

## Issue
SpellWindows are not displaying cost values in their headers, showing "0 POINTS" even though the backend logs show actual costs being calculated.

## Root Cause Analysis

### 1. Frontend Timing Issue (FIXED)
- **Problem**: SpellWindow was initializing cost tracking before window registration
- **Impact**: `getWindowCost()` couldn't find the window in state, so `updateCostDisplay()` returned early
- **Fix**: Moved `initializeCostTracking()` to after window registration in both code paths

### 2. Backend Cost Calculation Bypass for Spell Steps (FIXED)
- **Problem**: Webhook processor was bypassing cost calculation for spell steps entirely
- **Code Location**: `src/core/services/comfydeploy/webhookProcessor.js` lines 119-142
- **Original Logic**: "If this is an intermediate step in a spell, we just update the record and let the dispatcher handle it. We do NOT calculate cost or debit the user at this stage."
- **Impact**: Spell steps had `costUsd: null` in database and websocket payloads
- **Fix**: Calculate cost for spell steps (for display purposes) but still bypass debit logic

### 3. Individual Step Cost Display (ADDED)
- **Enhancement**: Added individual cost display to each spell step in the status list
- **Implementation**: Updated step creation and websocket handlers to show costs like "1. ChatGPT - 25 POINTS"
- **Styling**: Added CSS for professional step cost display with visual feedback

## Files Modified

### Backend
- **`src/core/services/comfydeploy/webhookProcessor.js`**
  - Added cost calculation logic for spell steps (lines 125-164)
  - Includes `costUsd` and `durationMs` in spell step update payload
  - Logs: "Calculated costUsd for spell step: $X for generation Y"

### Frontend
- **`src/platforms/web/client/src/sandbox/window/SpellWindow.js`**
  - Fixed cost tracking initialization timing (lines 61-79)
  - Moved `initializeCostTracking()` after window registration
  - Added debug logging

- **`src/platforms/web/client/src/sandbox/window/ToolWindow.js`**
  - Added debug logging to cost display updates

- **`src/platforms/web/client/src/sandbox/logic/spellExecution.js`**
  - Enhanced step creation with cost display spans (lines 88-102)
  - Steps now show "Calculating..." initially

- **`src/platforms/web/client/src/sandbox/node/websocketHandlers.js`**
  - Added step cost update logic in `handleGenerationUpdate()` (lines 314-339)
  - Added step cost display in `handleToolResponse()` (lines 414-420)
  - Converts USD cost to points for display

- **`src/platforms/web/client/src/sandbox/style/components/spellWindow.css`**
  - Added professional styling for step costs (lines 104-147)
  - Visual states for pending, completed, and free steps

## Testing

### Test Scenario
1. Create a spell window with multiple steps
2. Execute the spell
3. Verify header cost display updates as steps complete
4. Verify individual step costs are displayed
5. Reload page and verify costs persist

### Expected Behavior
- **Header Cost**: Shows accumulated cost like "💲 150 POINTS"
- **Individual Step Costs**: Each step shows its cost:
  ```
  1. ChatGPT - 25 POINTS
  2. onno - 125 POINTS
  ```
- **Real-time Updates**: Costs appear as each tool completes
- **Visual Feedback**: Completed steps highlighted in green

## Current Status
- ✅ Frontend timing issue fixed
- ✅ Backend cost calculation added for spell steps
- ✅ Individual step cost display implemented
- ⚠️  **PENDING**: Verify cost data is properly included in websocket payload
  - Backend calculates and stores cost
  - Frontend receives `costUsd: null` in websocket payload
  - Need to investigate why cost data isn't reaching the frontend

## Next Steps
1. Check if websocket notification is using updated generation record with cost data
2. Verify `_convertCostUsdForWebSocket()` function is receiving cost data
3. Add logging to track cost data flow from webhook processor to websocket notification
4. Test complete flow end-to-end

## Notes
- Spell steps now have cost data calculated but users are still charged upfront for the entire spell
- Cost calculation uses same logic as regular tools (duration * GPU rate)
- Frontend shows step costs in real-time as they complete
- Cost data should persist across page reloads
