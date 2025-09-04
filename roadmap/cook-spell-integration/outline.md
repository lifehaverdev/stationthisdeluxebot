# Collection Cook — Spell Integration

## Problem Statement
Collections cooks presently support only "tool" generators. Creators cannot power their collection generation with Spell assets that exist elsewhere in the platform. This limits creative flexibility and causes duplication.

## Vision
Allow a Collection to reference either a Tool **or** a Spell as its generator.  The UI should present both options, and backend orchestration must seamlessly accept `spellId` analogous to the existing `toolId` path.

## Current-State Findings
- **Frontend (CookMenuModal.js)** already stores `generatorType` values `tool | spell` but only implements TOOL pickers. Spell picker is "TBD".
- **CookOrchestratorService.js** and **cookApi.js** already accept `spellId` — logic paths mirror `toolId`.  No structural change expected.
- **Param options**: the modal calls `/api/v1/tools/registry/:toolId` to introspect Tool schemas. An equivalent `/api/v1/spells/registry/:spellId` (or similar) endpoint will be required for Spells.
- **Trait engine & cook flow** are generator-agnostic: they simply forward `toolId` OR `spellId` as `toolId` field in execution payload.  This remains compatible.
- **Limitations / Gaps**
  1. No UI to browse/search user spells.
  2. No REST endpoint for spell registry in external API namespace.
  3. Need validation when starting a cook that chosen spell belongs to user / is public.

## Strategy
1. **API Surface**
   - Add `GET /api/v1/spells/registry` → list spells user can access.
   - Add `GET /api/v1/spells/registry/:spellId` → return displayName & inputSchema (mirrors tool registry).
2. **CookMenuModal Enhancements**
   - When `generatorType === 'spell'` show searchable select populated from spells registry.
   - Store `spellId` on collection (`generatorType:"spell" , spellId`).
   - Re-use existing param-override table by fetching schema via spells registry.
3. **Backend Validation**
   - Cook collections service: ensure `spellId` forwarded; fallback totalSupply validations unchanged.
4. **Testing**
   - Unit: orchestrator startCook with spellId.
   - Integration: modal → start cook → generation outputs.
5. **Rollout**
   - Feature-flag `COLL_SPELLS_BETA` guarding modal spell picker until stable.

## Acceptance Criteria
- Users can choose “Spell” and select one of their spells when editing a collection.
- Start-Cook succeeds and queued pieces reference the chosen spell.
- Param override UI lists fields from Spell input schema.
- Regression: tool cook flow remains unaffected.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| M1 | API endpoints for spell registry | 2025-09-05 |
| M2 | CookMenuModal spell picker & param introspection | 2025-09-07 |
| M3 | Start-Cook backend validation & orchestration smoke test | 2025-09-08 |
| M4 | End-to-end UX QA & docs | 2025-09-10 |

## Dependencies
- SpellsService must expose metadata + input schema.
- Auth middleware for spell access control.

## Implementation Log (ongoing)
- 2025-09-02 Initial investigation completed; outline drafted.
- 2025-09-02 Spell cook flow operational – CookMenuModal spell picker, deterministic pieceKey (cookId:index), generationOutputs counting logic, submitPiece helper routing execute vs cast.
