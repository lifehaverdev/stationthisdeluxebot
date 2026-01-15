# Cook Menu Redesign

## Overview

Simplify the Cook Menu Modal to reduce confusion and give users direct control over batch generation instead of auto-calculating based on total supply.

## UI Structure

### Section 1: Workspace

Shows only **non-finalized, non-archived** collections.

**Layout:**
- Actively cooking collections float to top with cooking indicator
- All cards clickable → collection detail view

**Card display:**
- Collection name
- Status text:
  - Active: "2/10" (batch progress)
  - Idle: "24 generated • 18 approved • 3 unreviewed"
- Buttons: **Start Cook**, **Review**
- If cooking: **Pause**, **Stop** buttons

**Optional advisory:** When approaching target supply, subtle hint like "72/100 toward target"

### Section 2: My Collections

Shows **ALL** collections (workspace + finalized + archived).

**Layout:**
- Simple grid/list of names only
- Sortable
- Click → collection detail

**No status, no buttons** - just navigation.

## Start Cook Flow

### Current behavior (removing)
- Click "Start Cook" → immediately cooks toward total supply
- Auto-calculates pieces needed based on `targetSupply - approvedCount`

### New behavior
1. Click "Start Cook" → modal appears
2. Prompt: "How many pieces to generate?"
3. Number input field (no presets, user decides)
4. Buttons: **Cook**, **Cancel**
5. On confirm → generates exactly that batch size
6. When batch completes → status 'completed', collection stays in Workspace

## CookOrchestratorService Changes

- `startCook()` receives explicit `batchSize` parameter
- Remove auto-calculation logic (`totalSupply - producedSoFar`)
- Remove `producedSoFar >= state.total` completion checks
- Generate exactly `batchSize` pieces, then mark batch complete
- `totalSupply` remains on collection for metadata/export, not cook behavior

## Target Supply (Advisory Only)

**Where it surfaces:**
- Collection detail/overview: "Target: 100 • Currently: 72 approved"
- Export section: validation if exporting fewer than target
- Optional subtle hint on Workspace cards

**Where it does NOT surface:**
- Cook start prompt
- No auto-triggering
- No "Needs More Supply" section

## Finalize & Archive

Two actions available in collection detail (Overview tab):

### Archive
- Soft hide from Workspace
- Still appears in "My Collections"
- Can be unarchived

### Finalize
- Permanent completion (published to IPFS/gallery)
- Stays in "My Collections" marked as finalized
- Requires confirmation, cannot easily undo

## Sections Removed

- "Needs More Supply" section
- "Awaiting Review" section
- "Stopped Cooks" as separate section
- Auto-completion based on `approvedCount >= targetSupply`

## Implementation Summary

### CookMenuModal.js
1. Replace 5 status sections with 2: Workspace + My Collections
2. Simplify card status text
3. Add batch size prompt modal for Start Cook
4. Add Archive/Finalize buttons to detail view

### CookOrchestratorService.js
1. Change `startCook()` to accept `batchSize` instead of deriving from supply
2. Remove supply-based completion logic
3. Complete after generating exactly `batchSize` pieces

### cookApi.js (internal)
1. Update start cook endpoint to accept `batchSize`
2. Remove supply shortfall calculations from status responses
