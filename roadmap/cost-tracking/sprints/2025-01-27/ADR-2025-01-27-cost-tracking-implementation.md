# ADR-2025-01-27: Cost Tracking & Multi-Currency Display Implementation

## Context
Users currently have no visibility into generation costs, making budgeting and usage decisions difficult. The platform needs comprehensive cost tracking across all interfaces with multi-currency support (POINTS, MS2, USD, CULT) to provide transparency and enable informed decision-making.

## Decision
Implement a comprehensive cost tracking system with the following architecture:

1. **Backend Foundation**
   - Create `/api/internal/economy/rates` endpoint returning exchange rates
   - Use existing GPU cost table from `workflowCacheManager.js` for calculations
   - Calculate costs from websocket payload `durationMs` and `gpuType`

2. **State Management**
   - Extend `state.js` schema with `costVersions` array and `totalCost` object per window
   - Add migration logic for existing workspaces without cost data
   - Store denomination preference in `localStorage.costDenom`

3. **UI Components**
   - Create `costHud.js` component for workspace totals with reset functionality
   - Modify `ToolWindow.js` and Spell windows for per-window cost display
   - Update landing page tool cards with estimated costs
   - Implement denomination switching with <200ms update time

4. **Cost Calculation Rules**
   - Convert duration to USD: `GPU_COST_PER_SECOND[gpuType] * (durationMs/1000)`
   - Calculate all currencies using exchange rates
   - Store cost history per window with cumulative totals
   - Fallback to constants if exchange rate fetch fails

## Alternatives Considered
- **Client-only calculation**: Rejected due to potential inconsistency with backend calculations
- **Single currency only**: Rejected as users need flexibility for different use cases
- **Post-execution cost display only**: Rejected as real-time feedback is crucial for user experience

## Consequences
- Users gain full cost transparency across all interfaces
- Multi-currency support enables flexible cost display
- Real-time updates provide immediate feedback
- State migration ensures backward compatibility
- Performance impact minimal due to efficient calculation and caching

## Implementation Log
- 2025-01-27: Created epic structure and ADR
- 2025-01-27: Implemented backend rates API endpoint at `/api/internal/economy/rates`
- 2025-01-27: Extended state.js schema with costVersions and totalCost fields
- 2025-01-27: Created costHud.js component for workspace totals with real-time updates
- 2025-01-27: Modified BaseWindow and ToolWindow classes for cost display in headers
- 2025-01-27: Added cost calculation to websocket handlers for execution completion
- 2025-01-27: Updated tool selection to show cost estimates on tool cards
- 2025-01-27: Implemented denomination switching with localStorage persistence
- 2025-01-27: Created comprehensive documentation and unit tests
- 2025-01-27: All core functionality implemented and tested
