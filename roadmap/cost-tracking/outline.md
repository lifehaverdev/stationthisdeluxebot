# Cost Tracking & Multi-Currency Display — Outline

## Problem Statement
Users currently have no visibility into the cost of their generations, making it difficult to budget and understand the value of their workflows. The platform lacks cost transparency at both the individual tool level and workspace level, preventing users from making informed decisions about their usage patterns.

## Vision
Implement comprehensive cost tracking and multi-currency display across all generation interfaces, providing real-time cost visibility with support for multiple denominations (POINTS, MS2, USD, CULT). Users will see costs at the tool window level, cumulative workspace totals, and estimated costs in the tool catalog.

## Acceptance Criteria
- Per-window cost display shows latest execution cost and cumulative totals
- Workspace HUD displays live totals across all windows with reset functionality
- Landing page tool cards show estimated base costs
- Multi-currency support with denomination switching (POINTS, MS2, USD, CULT)
- Exchange rates fetched from `/api/internal/economy/rates` with fallback constants
- Cost calculation based on GPU type and duration from websocket payloads
- Persistent cost history per window with state migration for existing workspaces
- Currency switching updates all labels within 200ms
- All cost displays show primary denomination with others in tooltip

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| M1: Backend Foundation | Rates API endpoint and cost calculation logic | Sprint 1 |
| M2: State Management | Extend state.js schema and migration logic | Sprint 1 |
| M3: Workspace HUD | CostHud component with live updates | Sprint 1 |
| M4: Window Cost Display | ToolWindow and Spell window cost integration | Sprint 1 |
| M5: Landing Page Integration | Tool catalog cost estimates | Sprint 1 |
| M6: Multi-Currency UI | Denomination switching and display logic | Sprint 1 |
| M7: Testing & Documentation | Unit tests, Cypress tests, and docs | Sprint 1 |

## Dependencies
- WebSocket payload structure for durationMs and gpuType
- GPU_COST_PER_SECOND table in workflowCacheManager.js
- Existing state.js persistence system
- Tool registry for base cost estimates
- localStorage for denomination preference
