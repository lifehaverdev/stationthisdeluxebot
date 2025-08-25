> Imported from vibecode/bulk/decisions/ADR-005-DEBIT.md on 2025-08-21

# ADR-005: Standardized Debit Accounting for Generation Services

## Status
Accepted

## Context

The current system calculates and records generation costs (`costUsd`) in `generationRecord`s, especially for ComfyUI workflows. However, **no actual debit operation** is performed via the internal economy layer (`userEconomyApi.js`). Additionally, some workflows use a separate `PointsService` that interacts with `points`, `qoints`, or `doints` via a legacy database interface, bypassing the modern `usdCredit` system entirely.

This results in:

- Generations being delivered **without payment**
- Multiple, **conflicting accounting systems**
- Inability to accurately **enforce usage limits or monetization**
- **Disjointed transaction history** and economy logs

## Decision

We will adopt a **unified debit enforcement mechanism** for generation services across all platforms.

### Core Requirements

1. **Mandatory Debit on Delivery Completion**
   - Any generation tool that completes successfully and produces a result **must** invoke:
     ```
     POST /internal/v1/data/users/:masterAccountId/economy/debit
     ```
     with a payload containing:
     - `amountUsd`: Final cost
     - `toolId`: Associated `ToolDefinition`
     - `generationId`: The generation record (if applicable)
     - `metadata`: Optional diagnostic tags

2. **Webhook-Driven Finalization**
   - The `webhookProcessor.js` is responsible for calculating the final `costUsd` for a job.
   - **Immediately after** updating the generation record with `costUsd`, it must issue the debit request via the Internal API.

3. **Transaction Recording**
   - The Internal API must:
     - Deduct `amountUsd` from the user’s `usdCredit`
     - Create a corresponding entry in `transactionsDb`
     - Include a reference to the generation ID if provided

4. **Canonical Source of Balance**
   - `usdCredit` is the **only official spendable currency** for AI tasks.
   - Any use of `PointsService` must be refactored to call `userEconomyApi.js` instead.

5. **Graceful Failure Handling**
   - If the debit request fails:
     - **DO NOT** deliver the generation to the user
     - Instead, mark the `generationRecord` as `payment_failed` and notify the user with a retry option

6. **Optional: Cost Previewing**
   - For workflows that want to preview cost ahead of time, they may call:
     ```
     GET /internal/v1/tools/:toolId/costPreview?inputParams=...
     ```
     (To be implemented separately, cached via `ToolRegistry`)

## Consequences

✅ **Monetization integrity**: Every generation deducts from user credit  
✅ **Consistency**: All platforms share the same economy logic  
✅ **Auditability**: Every debit is logged via the Internal API and linked to a generation  
🚫 **No more silent free generations**  
🧨 **Breaks legacy workflows** until they are updated to use `usdCredit`

## Implementation Plan

1. Update `webhookProcessor.js` to issue debit requests post-cost-finalization
2. Add `toolId` and `generationId` fields to the `/economy/debit` endpoint schema
3. Update `transactionsDb.js` to store those fields
4. Refactor `PointsService.js` to call the Internal API instead of direct DB access
5. Remove unused fields like `points` and `qoints` from user schema after migration

## Open Questions

- Should “training” jobs have special handling for free tiers or higher thresholds?
- Do we allow for promotional credits (non-usdCredit) that can be burned the same way?
- What’s the long-term plan for legacy balances in `PointsService`?

---# ADR-005: Standardized Debit Accounting for Generation Services

## Status
Accepted

## Context

The current system calculates and records generation costs (`costUsd`) in `generationRecord`s, especially for ComfyUI workflows. However, **no actual debit operation** is performed via the internal economy layer (`userEconomyApi.js`). Additionally, some workflows use a separate `PointsService` that interacts with `points`, `qoints`, or `doints` via a legacy database interface, bypassing the modern `usdCredit` system entirely.

This results in:

- Generations being delivered **without payment**
- Multiple, **conflicting accounting systems**
- Inability to accurately **enforce usage limits or monetization**
- **Disjointed transaction history** and economy logs

## Decision

We will adopt a **unified debit enforcement mechanism** for generation services across all platforms.

### Core Requirements

1. **Mandatory Debit on Delivery Completion**
   - Any generation tool that completes successfully and produces a result **must** invoke:
     ```
     POST /internal/v1/data/users/:masterAccountId/economy/debit
     ```
     with a payload containing:
     - `amountUsd`: Final cost
     - `toolId`: Associated `ToolDefinition`
     - `generationId`: The generation record (if applicable)
     - `metadata`: Optional diagnostic tags

2. **Webhook-Driven Finalization**
   - The `webhookProcessor.js` is responsible for calculating the final `costUsd` for a job.
   - **Immediately after** updating the generation record with `costUsd`, it must issue the debit request via the Internal API.

3. **Transaction Recording**
   - The Internal API must:
     - Deduct `amountUsd` from the user’s `usdCredit`
     - Create a corresponding entry in `transactionsDb`
     - Include a reference to the generation ID if provided

4. **Canonical Source of Balance**
   - `usdCredit` is the **only official spendable currency** for AI tasks.
   - Any use of `PointsService` must be refactored to call `userEconomyApi.js` instead.

5. **Graceful Failure Handling**
   - If the debit request fails:
     - **DO NOT** deliver the generation to the user
     - Instead, mark the `generationRecord` as `payment_failed` and notify the user with a retry option

6. **Optional: Cost Previewing**
   - For workflows that want to preview cost ahead of time, they may call:
     ```
     GET /internal/v1/tools/:toolId/costPreview?inputParams=...
     ```
     (To be implemented separately, cached via `ToolRegistry`)

## Consequences

✅ **Monetization integrity**: Every generation deducts from user credit  
✅ **Consistency**: All platforms share the same economy logic  
✅ **Auditability**: Every debit is logged via the Internal API and linked to a generation  
🚫 **No more silent free generations**  
🧨 **Breaks legacy workflows** until they are updated to use `usdCredit`

## Implementation Plan

1. Update `webhookProcessor.js` to issue debit requests post-cost-finalization
2. Add `toolId` and `generationId` fields to the `/economy/debit` endpoint schema
3. Update `transactionsDb.js` to store those fields
4. Refactor `PointsService.js` to call the Internal API instead of direct DB access
5. Remove unused fields like `points` and `qoints` from user schema after migration

## Open Questions

- Should “training” jobs have special handling for free tiers or higher thresholds?
- Do we allow for promotional credits (non-usdCredit) that can be burned the same way?
- What’s the long-term plan for legacy balances in `PointsService`?

---