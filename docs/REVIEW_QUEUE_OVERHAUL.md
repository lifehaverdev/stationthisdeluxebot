# Review Queue Overhaul

## Goal
Replace the ad hoc “find all generations without `metadata.reviewOutcome`” approach with a first-class review queue so we can:

- assign review work atomically (pop N oldest pending items)
- avoid duplicate displays or “stuck” items when a client crashes
- capture clear audit logs of who reviewed what and when
- decouple review state from the large `generationOutputs` collection

## Proposed Data Model

### `collection_reviews` (Mongo collection)

| Field               | Type          | Description |
|---------------------|---------------|-------------|
| `_id`               | ObjectId      | Queue entry id |
| `generationId`      | ObjectId      | Reference to `generationOutputs` document |
| `collectionId`      | String        | External collection identifier |
| `masterAccountId`   | ObjectId      | Owner of the collection (optional) |
| `status`            | String        | `pending` \| `in_progress` \| `accepted` \| `rejected` \| `failed` |
| `assignedTo`        | ObjectId      | Reviewer’s user id when item is popped |
| `assignedAt`        | Date          | Timestamp of assignment |
| `reviewedAt`        | Date          | Timestamp of final decision |
| `decisionReason`    | String        | Optional comment / metadata |
| `metadata`          | Object        | Extra info (e.g., locking info, tags) |
| `retryCount`        | Number        | Auto-increment for retried items |

Indexes:
- `{ collectionId: 1, status: 1, requestTimestamp: 1 }` for queue pops
- `{ assignedTo: 1, status: 1 }` to find locked items per reviewer
- `{ generationId: 1 }` unique to ensure single queue entry per generation

### Flow

1. When a generation completes, a worker inserts/updates the corresponding `collection_reviews` entry (status `pending`). This avoids scanning `generationOutputs`.
2. Review clients call `/queue/pop` to atomically claim the next set of pending items. The server marks `status = in_progress`, sets `assignedTo`/`assignedAt`, returns minimal metadata plus display payload references.
3. The client shows the items, gathers decisions, and calls `/queue/commit` with the decisions. The server validates that the items are still assigned to that user, updates `status = accepted|rejected`, sets `reviewedAt`, and writes `metadata.reviewOutcome` back to `generationOutputs`.
4. If the client crashes or doesn’t commit within a timeout, a background job resets `status = pending`, clears `assignedTo`, and increments `retryCount`.

## API Endpoints

All endpoints sit under `/api/v1/review-queue` (external) and `/internal/v1/data/review-queue` (internal).

### External (review client)

1. `POST /api/v1/review-queue/pop`
   - Body: `{ collectionId, limit, strategy }`
   - Auth: JWT or API key
   - Behavior: calls internal `/pop`, returns `{ items: [{ queueId, generationId, displayPayload }] }`

2. `POST /api/v1/review-queue/commit`
   - Body: `{ decisions: [{ queueId, generationId, outcome, reason? }] }`
   - Returns per-item results; internal route updates queue + generationOutputs.

3. `POST /api/v1/review-queue/release`
   - Optional: allow client to abandon an item without decision (puts it back to pending).

4. `GET /api/v1/review-queue/stats?collectionId=...`
   - Returns counts by status, oldest pending age, etc., for UI dashboards.

### Internal

1. `POST /internal/v1/data/review-queue/pop`
   - Accepts `{ collectionId, limit, reviewerId }`
   - Uses `findOneAndUpdate` with sort ascending to atomically set `status='in_progress'`, `assignedTo`, `assignedAt`.
   - Supports optional `lockTimeout` to reassign old locks.

2. `POST /internal/v1/data/review-queue/commit`
   - Validates each queueId belongs to requester, updates queue status, writes `metadata.reviewOutcome` to `generationOutputs`, emits events.

3. `POST /internal/v1/data/review-queue/release`
   - Clears `assignedTo`/`assignedAt`, sets status back to pending if not already decided.

4. `GET /internal/v1/data/review-queue/stats`
   - Aggregates counts grouped by `collectionId`.

5. Background job / cron: `POST /internal/v1/data/review-queue/reap`
   - Resets `in_progress` items whose `assignedAt` is older than threshold.

## Integration Steps

1. **Schema + DB layer**
   - Add `reviewQueueDb` with `insert`, `pop`, `commit`, `release`, `stats` methods and indexes.
   - Modify generation completion flow to insert/update queue entries.

2. **Internal API**
   - Implement `/pop`, `/commit`, `/release`, `/stats`, `/reap` routes enforcing reviewer auth.

3. **External API**
   - Replace `/collections/:id/pieces/unreviewed` with `/review-queue/pop`.
   - Replace bulk review POST with `/review-queue/commit`.

4. **Frontend**
   - Update `CollectionWindow` to use new endpoints and display queue-assigned items, handling “no items” vs. “assignment in progress”.

5. **Metrics + Logging**
   - Emit events when items are popped, committed, released, or reaped.
   - Track queue depth per collection.

6. **Migration Plan**
   - Script to backfill `collection_reviews` from existing `generationOutputs` for any pending items.
   - Feature-flag the new endpoints; once stable, remove old `/pieces/unreviewed` route.
