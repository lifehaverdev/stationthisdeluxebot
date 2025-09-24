# Cost Tracking & Multi-Currency Display

This document describes the cost tracking and multi-currency display system implemented in StationThis Deluxe.

## Overview

The cost tracking system provides full transparency into generation costs across all interfaces, supporting multiple currencies (POINTS, MS2, USD, CULT) with real-time updates and persistent storage.

## Features

### Per-Window Cost Display
- **Latest Execution Cost**: Shows the cost of the most recent execution in the selected denomination
- **Cumulative Cost**: Displays total cost across all versions in that window
- **Multi-Currency Support**: Click on cost display to cycle through denominations
- **Tooltip Details**: Hover to see all currency values

### Workspace HUD
- **Live Totals**: Fixed HUD in sandbox corner showing totals across all windows
- **Real-Time Updates**: Updates automatically as nodes finish executing
- **Reset Functionality**: Click reset button to clear all costs
- **Denomination Switching**: Click HUD to cycle through currencies

### Landing Page Integration
- **Tool Cards**: Each tool card shows estimated base cost
- **Category-Based Estimates**: Default costs based on tool category
- **Metadata Support**: Tools can specify custom cost estimates

## Architecture

### Backend Components

#### Rates API (`/api/internal/economy/rates`)
```javascript
// Returns current exchange rates
{
  "success": true,
  "data": {
    "POINTS_per_USD": 100,
    "MS2_per_USD": 2,
    "CULT_per_USD": 50
  },
  "timestamp": "2025-01-27T10:00:00.000Z"
}
```

#### Cost Calculation
- **GPU-Based**: Uses `GPU_COST_PER_SECOND` table for calculation
- **Duration Tracking**: Calculates cost from `durationMs` and `gpuType`
- **Fallback Support**: Uses provided `costUsd` if available

### Frontend Components

#### State Management (`state.js`)
```javascript
// Window cost data structure
{
  costVersions: [
    { usd: 0.042, points: 4.2, ms2: 0.07, cult: 2.1, timestamp: 1640995200000 }
  ],
  totalCost: { usd: 0.13, points: 13, ms2: 0.26, cult: 6.5 }
}
```

#### Cost HUD (`costHud.js`)
- Fixed position in sandbox corner
- Real-time updates via event listeners
- Denomination switching with localStorage persistence
- Reset functionality for all costs

#### Window Cost Display
- Integrated into BaseWindow header
- Clickable for denomination switching
- Tooltip with all currency values
- Event-driven updates

## Usage

### For Users

1. **Viewing Costs**: Costs appear automatically in window headers and workspace HUD
2. **Switching Currencies**: Click on any cost display to cycle through denominations
3. **Resetting Costs**: Use the reset button in the workspace HUD
4. **Tool Estimates**: Check tool cards for estimated costs before execution

### For Developers

#### Adding Cost Tracking to New Windows
```javascript
// Extend BaseWindow or call initializeCostTracking()
this.initializeCostTracking();
```

#### Custom Cost Calculation
```javascript
// Add cost data for a window
addWindowCost(windowId, {
  usd: 0.042,
  points: 4.2,
  ms2: 0.07,
  cult: 2.1
});
```

#### Listening for Cost Events
```javascript
// Cost update event
window.addEventListener('costUpdate', (event) => {
  const { windowId, costData, totalCost } = event.detail;
  // Update UI
});

// Denomination change event
window.addEventListener('denominationChange', (event) => {
  const { denomination } = event.detail;
  // Update displays
});
```

## Configuration

### Exchange Rates
Default rates are defined in multiple places for consistency:
- Backend: `src/api/internal/economy/ratesApi.js`
- Frontend: `src/platforms/web/client/src/sandbox/components/costHud.js`
- WebSocket handlers: `src/platforms/web/client/src/sandbox/node/websocketHandlers.js`

### GPU Cost Rates
Defined in `src/core/services/comfydeploy/workflowCacheManager.js`:
```javascript
const GPU_COST_PER_SECOND = {
  'T4': 0.00018,
  'L4': 0.00032,
  'A10G': 0.000337,
  'L40S': 0.000596,
  'A100': 0.00114,
  'A100-80GB': 0.001708,
  'H100': 0.002338,
  'H200': 0.001891,
  'B200': 0.002604,
  'CPU': 0.000042
};
```

### Tool Cost Estimates
Default estimates by category in `src/platforms/web/client/src/sandbox/toolSelection.js`:
```javascript
const DEFAULT_COST_ESTIMATES = {
  'text-to-image': '~50 POINTS',
  'image-to-image': '~30 POINTS',
  'text-to-audio': '~20 POINTS',
  'text-to-text': '~5 POINTS',
  'text-to-video': '~100 POINTS',
  'image-to-video': '~80 POINTS',
  'audio-to-audio': '~15 POINTS',
  'video-to-video': '~60 POINTS',
  'uncategorized': '~25 POINTS'
};
```

## Data Persistence

### localStorage Keys
- `costDenom`: Current denomination preference
- `sandbox_tool_windows`: Window data including cost information
- `sandbox_connections`: Connection data

### State Migration
Existing workspaces without cost data are automatically migrated with default values:
```javascript
costVersions: [],
totalCost: { usd: 0, points: 0, ms2: 0, cult: 0 }
```

## Performance Considerations

- **Event-Driven Updates**: Only affected components update when costs change
- **Caching**: Exchange rates are cached with 5-minute TTL
- **Efficient Calculation**: Cost calculation happens only on execution completion
- **Minimal DOM Updates**: Only cost display elements are updated

## Error Handling

- **Missing Cost Data**: Warns in console, continues with zero cost
- **Exchange Rate Failures**: Falls back to default rates
- **Invalid Denominations**: Defaults to POINTS
- **State Corruption**: Gracefully handles missing or malformed cost data

## Future Enhancements

- **Real-Time Exchange Rates**: Integration with external rate APIs
- **Cost Prediction**: Estimate costs before execution
- **Budget Alerts**: Notify users when approaching limits
- **Cost Analytics**: Historical cost analysis and trends
- **Custom Currencies**: Support for additional token types
