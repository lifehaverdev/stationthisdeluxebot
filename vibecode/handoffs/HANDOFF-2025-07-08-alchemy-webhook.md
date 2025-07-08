# HANDOFF: 2025-07-08

## Work Completed
- Diagnosed and fixed the Alchemy webhook endpoint to ensure:
  - Raw body is captured and signature validation works (using global express.json verify).
  - Webhook handler receives and parses the event payload correctly.
  - Internal API dependency injection is correct for webhook processing.
  - Internal API calls use the correct `/internal/v1/data/ledger/entries` path.
  - Deposit events are now processed end-to-end: webhook → internal API → on-chain confirmation → off-chain credit.
- Added detailed logging throughout the webhook and credit service flow for traceability.
- Confirmed that the full round-trip (on-chain event → webhook → internal API → on-chain confirmation → off-chain credit) is working in logs.

## Current State
- Alchemy webhook events are received, validated, and processed.
- Deposits are recorded in the internal ledger and confirmed on-chain.
- Points are credited to users (though there is a discrepancy between quoted and credited points—see "Open Questions").
- All major error states (404s, signature errors, ABI mismatches) have been resolved.

## Next Tasks
- Investigate and resolve the discrepancy between quoted points and credited points (userEconomy/pointsRemaining/pointsCredited).
- Trace the flow from deposit event to userEconomy update to ensure points are credited as expected.
- Add or update tests/demonstrations to prove end-to-end success.
- Document any further changes or fixes in a follow-up handoff.

## Changes to Plan
- No major deviations from the refactor plan; all changes align with the North Star and collaboration protocol.

## Open Questions
- Why is there a mismatch between the quoted points and the points actually credited to the user? (Requires further investigation.)
- Are there any edge cases or race conditions in the deposit/credit pipeline that need additional handling? 