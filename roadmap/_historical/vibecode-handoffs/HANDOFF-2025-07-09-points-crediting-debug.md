> Imported from vibecode/handoffs/HANDOFF-2025-07-09-points-crediting-debug.md on 2025-08-21

# HANDOFF: 2025-07-09

## Work Completed
- Implemented a robust, race-free deposit confirmation pipeline for points crediting.
- Added an in-memory group lock (user-token level) to prevent concurrent confirmation attempts for the same deposit group.
- Combined the group lock with a recent tx cache to debounce duplicate webhook deliveries from Alchemy.
- Verified via logs and dashboard that only one confirmation is attempted per deposit, and points are credited exactly once.
- Confirmed that duplicate webhooks are safely ignored while a group is being processed.
- User dashboard now reflects credited points immediately after successful confirmation.

## Current State
- Deposit events are processed idempotently and atomically: only one on-chain confirmation is ever attempted for a deposit group, even under heavy webhook replay or race conditions.
- The ledger entry is updated to CONFIRMED only after a successful on-chain confirmation, and points are credited and visible in the dashboard.
- Duplicate or concurrent webhook deliveries for the same deposit group are safely ignored/skipped.
- The system is robust against double confirmation, ledger overwrites, and race conditions.

## Next Tasks
- **Handle legacy errored deposits:**
  - Identify all ledger entries with status ERROR that resulted from previous double confirmation attempts.
  - For each, check if the deposit was actually confirmed on-chain (i.e., the first confirmation succeeded but the entry was later overwritten by an error from a duplicate attempt).
  - If so, update the ledger entry status to CONFIRMED and credit the appropriate points to the user.
  - Optionally, build an admin tool or script to automate this reconciliation and recovery process.
- Add metrics/logging for group lock contention and skipped confirmations for monitoring.
- Continue to monitor for any edge cases or new error patterns as the system runs in production.

## Changes to Plan
- No major changes to the overall plan. The focus has shifted from fixing duplicate confirmation to also addressing recovery for previously errored deposits.

## Open Questions
- **How should we handle deposits that are currently in ERROR due to double confirmation?**
  - Should we automatically attempt to reconcile and credit points for these, or require admin review?
  - What is the best way to detect on-chain that a deposit was actually confirmed, even if the ledger entry is in ERROR?
  - Should users be notified if their previously errored deposits are recovered and credited?
- **Should we expose failed deposit attempts and their reasons in the user dashboard for transparency, or only to admins?**
- **Is there a need for a migration or one-time script to clean up and recover points for all affected users?**

## Discussion: Handling Legacy Errored Deposits
Many deposits that were processed before the group lock fix ended up with status ERROR due to double confirmation attempts. In these cases, the first on-chain confirmation often succeeded, but a second (duplicate) attempt failed and overwrote the ledger entry with an error, leaving the user's points uncredited and trapped.

**Proposed Recovery Approach:**
- Query all ledger entries with status ERROR and a non-null confirmation_tx_hash.
- For each, check the on-chain status of the confirmation_tx_hash:
  - If the tx succeeded and the deposit was credited on-chain, update the ledger entry to CONFIRMED and credit the user's points.
  - If the tx failed, leave as ERROR and flag for admin review.
- Optionally, notify users whose deposits are recovered.
- Consider building an admin dashboard view or script for this reconciliation process.

This approach will ensure that all users receive the points they are owed, and that the ledger accurately reflects the true state of all deposits, even those affected by past race conditions. 