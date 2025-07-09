# HANDOFF: 2025-07-09

## Work Completed
- Traced the full flow of deposit events from quote to ledger entry and dashboard aggregation.
- Refactored backend aggregation to use wallet address and case-insensitive matching.
- Added detailed logging to aggregation and crediting logic.
- Verified that points are correctly calculated and credited in the ledger when status is CONFIRMED.
- Identified that recent deposits are not showing in the dashboard because their ledger entries have status ERROR, not CONFIRMED.
- Investigated the contract and found that every deposit confirmation is being attempted twice; the second attempt fails and is saved as ERROR in the ledger.

## Current State
- The dashboard points aggregation works and matches all CONFIRMED ledger entries for the user's wallet.
- New deposits are processed, but the ledger entry for each deposit ends up with status ERROR due to a duplicate confirmation attempt (the second attempt fails on-chain and is saved as the final state).
- The user does not see their new points in the dashboard because only CONFIRMED entries are counted.
- The root cause is duplicate confirmation attempts for the same deposit, leading to the second (failing) attempt overwriting the ledger entry with ERROR status.

## Next Tasks
- Investigate why duplicate confirmation attempts are being made for each deposit group in CreditService.
- Ensure that only one confirmation is attempted per deposit group.
- Add explicit error logging and admin visibility for failed confirmations.
- Optionally, expose failed deposit attempts and their reasons in the user dashboard for transparency.
- Once the duplicate confirmation bug is fixed, verify that new deposits are credited as CONFIRMED and points show up in the dashboard as expected.

## Changes to Plan
- No major changes to the overall plan, but the focus is now on fixing the duplicate confirmation bug in CreditService before further dashboard or aggregation changes.

## Open Questions
- What is triggering the duplicate confirmation attempts? Is it a race condition, webhook replay, or logic bug in the deposit processing pipeline?
- Should failed deposit attempts be visible to users, or only to admins?
- Is there a need for a migration to clean up existing ERROR entries that should have been CONFIRMED? 