> Imported from vibecode/bulk/decisions/adr/ADR-012-Micro-Fee-Reward-System.md on 2025-08-21

# ADR-012: Micro-Fee Reward System for Mods and Spells

## Context

The StationThis platform allows users to create and share mods (LoRA models) and spells (multi-step workflows). These user-generated features drive engagement and attract new users. However, there is currently no mechanism to reward creators when their mods or spells are used by others. To incentivize innovation and reward creators, we propose a micro-fee system that distributes a portion of generation costs to the owners of these features.

## Decision

- **Micro-Fee Structure:**
  - When a user runs a generation that uses a mod (LoRA), a 5% fee is added to the total generation cost. This fee is distributed to the owners of the LoRAs used, split evenly if multiple LoRAs are involved.
  - When a user runs a spell, a 6% fee is added to the total generation cost. 3% goes to the spell creator, and 3% is distributed among the owners of any LoRAs used within the spell. If no LoRAs are used, the spell creator receives the full 6%.
  - The micro-fee is always added on top of the base cost, not deducted from it.
  - The payout is credited in USD credits on the backend, but denominated in points when displayed to users.
  - Payouts are instant per use.

- **Implementation Details:**
  - The system will detect which mods and/or spells were used in each generation.
  - After a successful generation, if the user is not the owner, the micro-fee is calculated and distributed accordingly.
  - All payouts are logged in TransactionsDB and credited to the owner's UserEconomyDB balance.
  - Owners can view their earnings and usage history.

## Consequences

- **Positive:**
  - Creators are directly incentivized to build high-quality mods and spells.
  - The platform can attract more innovative contributors.
  - Usage and earnings are transparently tracked and auditable.

- **Negative:**
  - Slightly higher costs for users when using community-created features.
  - Additional complexity in the billing and accounting logic.

## Alternatives Considered

- **Flat Fee:** Rejected in favor of a percentage-based system, which scales with usage and cost.
- **Delayed Payouts:** Rejected in favor of instant payouts for better user experience and transparency.
- **Points-Only Rewards:** Rejected in favor of USD credits for backend accounting, with points as the user-facing denomination. 

## Implementation Notes

- **Data Flow:**
  - `src/core/services/WorkflowExecutionService.js`: The `_executeStep` function was modified to capture the `loraResolutionData` (which includes `appliedLoras`) from `workflowsService.prepareToolRunPayload`. This data is now stored in the `metadata` of the generation record, making it available for billing.

- **Billing & Reward Logic:**
  - `src/core/services/comfydeploy/webhookProcessor.js`: This file now contains the core implementation for the reward system.
    - A new function, `calculateCreatorRewards`, was introduced. It's called after a generation is successful and calculates the total fee based on the generation's base cost and the applied spell/LoRAs from the generation record's metadata. It returns the final cost (base + fee) and a list of reward objects.
    - The user who initiated the generation is now debited for the `finalCost`.
    - After the user's debit is successful, a new `distributeCreatorRewards` function is called.
    - This function iterates through the rewards and calls a new `issueCredit` helper function for each creator, which posts to the `/v1/data/users/{masterAccountId}/economy/credit` internal API endpoint.
    - This ensures that creators are only paid after the user's payment has been successfully processed. 