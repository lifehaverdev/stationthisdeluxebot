# Collection Review Optimization Plan

## Objective
Stop the review experience from stalling or re-trying indefinitely by decoupling heavy data fetches from image delivery and introducing smarter batching/CA token handling. This document captures the workstream we discussed so the team can coordinate fixes without losing the context that drove the investigation.

## Current Symptoms
- `/collections/:id/pieces/unreviewed` waits for `/internal/v1/data/generations` to scan 400–500 docs, which frequently takes 60–70 s and exceeds the 15 s timeout on `internalApiClient`.
- Generation responses include full artifact payloads that get rebuilt each fetch, so the request is both slow and heavy.
- The review window floods `/pieces/review/bulk` whenever a flush chunk fails (403/500) because the retry logic re-queues decisions immediately and retries without backoff. This makes the UI look stuck on the same pieces.
- CSRF tokens expire during long sessions; the client currently fetches a new token per flush but doesn’t refresh it when it sees 403, so failures just keep repeating.

## Key Targets
1. **Data subset & indices**
   - Add query options (limit, projection, sort) to `generationOutputsDb.findGenerations` and expose them through `/internal/v1/data/generations`.
   - Plugin those options into the `/pieces/unreviewed` proxy so it only pulls `limit=12` docs at a time, sorted by timestamp.
   - Create a compound index on `metadata.collectionId`, `status`, `deliveryStrategy`, and `metadata.reviewOutcome` to keep these lookups fast even as the collection grows.

2. **Assets / image delivery**
   - Stop embedding artifact payloads in the `unreviewed` response. Either return only metadata with references to signed URLs or let the client request the image info (e.g., GET `/generations/:id/artifacts`) once a card is rendered.
   - Ensure the signed URLs are CDN-friendly so browsers download images directly without going through the Node proxy.

3. **Client batching/debounce + failure recovery**
   - Treat `_pendingReviewDecisions` as a debounced queue: flush only after either `batchSize` is reached or `pauseMs` of inactivity, and cancel flush retries unless the UI re-triggers them.
   - If a bulk POST fails with 403, refresh the CSRF token once (already partially implemented) and retry once more before giving up; do not requeue chunks immediately without backoff.
   - Show the “Not synced / retrying” banner when retries are pending so reviewers know the system is waiting; avoid rapid-fire POST spam.

4. **Timeout handling**
   - Introduce a specific `longRunningApiClient` route for `/internal/v1/data/generations` in `cookApi`, or temporarily raise `internalApiClient.timeout` above 15 s, to prevent false 500s while the index work is in progress.
   - Log slow queries on the internal route (e.g., instrumentation around `findGenerations`) to monitor improvements.

5. **Sync points / documentation**
   - Document the new behavior in this repo (perhaps extend this file) and update the frontend or ops team so they understand the new request cadence.
   - Capture metrics (latency, retries, queue length) once the fix is live to ensure the review loop stays stable under load.

## Suggested Work Breakdown
1. **Storage + API**
   - Update `generationOutputsDb.findGenerations` to accept `options` (limit/projection/sort already supported) and confirm the internal route passes them through (maybe add defaults for review use case).
   - Add the new Mongo index; coordinate with ops if production requires downtime.
   - Short-term: raise the timeout used by `internalApiClient` for this route and log the matched count/time.

2. **Front-end**
   - Adjust `CollectionWindow` to respect a “pause” interval between flushes and not requeue immediately after failure.
   - Keep CSRF token refresh/in-flight promise logic (already added) and tie it to the newer debounce/backoff flow so an expired token doesn’t cause repeated POSTs.
   - Ensure the review UI only fetches image URLs when rendering a card; avoid populating `_reviewQueue` with full payload blobs.

3. **Observability & Ops**
   - Add logging around slow calls (maybe `logger.time` or manual timers) in `generationOutputsApi`.
   - Document the queue/timeout behavior for future debugging (this file + release notes).

4. **Verification**
   - Unit/integration tests for the new index and limited queries.
   - Manual test: open the review window, verify you can review dozens of docs without hitting 403 or repeated batches, and confirm `/pieces/review/bulk` only fires once per flush except for an intentional retry after 403.

Let me know if you want me to implement any of these steps, or if we should expand this doc with milestones/owners. 
