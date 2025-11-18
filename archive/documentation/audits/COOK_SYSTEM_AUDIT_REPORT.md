# Cook System Comprehensive Audit Report

**Date:** 2025-01-27  
**Scope:** Complete audit of cook collection system  
**Objective:** Identify vulnerabilities, race conditions, type inconsistencies, failure modes, and integration issues

---

## Executive Summary

This audit examines the cook system end-to-end, from collection creation through cook initiation, piece generation, and completion. The system manages collections, cooks, casts (for spells), and generation outputs with complex state management and integration points.

---

## Table of Contents

1. [Deprecated Components Analysis](#deprecated-components-analysis)
2. [Type Consistency & ObjectId Handling](#type-consistency--objectid-handling)
3. [State Management & Race Conditions](#state-management--race-conditions)
4. [Failure Handling & Error Recovery](#failure-handling--error-recovery)
5. [Supply & Counting Logic](#supply--counting-logic)
6. [Metadata Validation](#metadata-validation)
7. [Integration Points](#integration-points)
8. [Concurrency Control](#concurrency-control)
9. [Cook Document Management](#cook-document-management)
10. [Event System](#event-system)
11. [API Security & Validation](#api-security--validation)

---

## 1. Deprecated Components Analysis

### 1.1 CookJobStore (cook_jobs collection)

**Status:** ⚠️ DEPRECATED but still referenced

**Location:** `src/core/services/cook/CookJobStore.js`

**Findings:**
- Still imported in `src/api/internal/cookApi.js` (line 2)
- Still imported in `src/core/services/cook/index.js` (line 1)
- Still imported in `src/core/services/cook/CookEmbeddedWorker.js` (line 3)
- Still imported in `scripts/workers/cookWorker.js` (line 7)
- Used in `/internal/cook/active` endpoint for legacy fallback (lines 69-73)
- Used in `/internal/cook/debug/queue` endpoint (line 315)
- Comment in `CookOrchestratorService.js` line 2-3 says "Legacy CookJobStore removed"

**Issues:**
1. **CRITICAL:** CookJobStore is marked as deprecated but still actively imported and used
2. **MEDIUM:** `/active` endpoint has fallback logic that queries cook_jobs collection
3. **LOW:** Debug endpoint still uses CookJobStore

**Recommendation:**
- Remove all imports and usages of CookJobStore
- Remove cook_jobs collection queries from `/active` endpoint
- Remove `/debug/queue` endpoint or migrate to generationOutputs-based query

### 1.2 CookProjectionUpdater (cook_events, cook_status collections)

**Status:** ⚠️ POTENTIALLY DEPRECATED

**Location:** `src/core/services/cook/CookProjectionUpdater.js`

**Findings:**
- Still initialized in `src/core/services/cook/index.js` (lines 14-15)
- Uses `cook_events` collection (line 20)
- Uses `cook_status` collection (line 21)
- Used in `/internal/cook/status` endpoint (line 301)
- CookOrchestratorService still writes to `cook_events` (line 79, 92)

**Issues:**
1. **MEDIUM:** Projection updater may be redundant if status can be derived from generationOutputs
2. **LOW:** Event system may be useful for audit trail but not critical path

**Recommendation:**
- Evaluate if cook_status projection is still needed
- Consider deriving status directly from generationOutputs queries
- Keep cook_events for audit trail if desired

### 1.3 CookEmbeddedWorker

**Status:** ⚠️ DEPRECATED

**Location:** `src/core/services/cook/CookEmbeddedWorker.js`

**Findings:**
- Still imported in `src/core/services/cook/index.js` (line 6)
- Auto-start disabled by default (`EMBEDDED_WORKER_AUTO_START = false`, line 9)
- Uses deprecated CookJobStore
- Comment in ADR says "Remove Stateless Worker Containers"

**Issues:**
1. **LOW:** Worker is disabled but still in codebase
2. **LOW:** Depends on deprecated CookJobStore

**Recommendation:**
- Remove CookEmbeddedWorker entirely
- Remove from index.js exports

---

## 2. Type Consistency & ObjectId Handling

### 2.1 CookOrchestratorService

**File:** `src/core/services/cook/CookOrchestratorService.js`

#### Issue 2.1.1: userId Type Inconsistency

**Location:** Lines 99-117 (`_getProducedCount`)

```javascript
async _getProducedCount(collectionId, userId) {
  await this._init();
  const { ObjectId } = require('mongodb');
  return this.outputsCol.countDocuments({
    'metadata.collectionId': collectionId,
    masterAccountId: new ObjectId(userId),  // ✅ Converts to ObjectId
    // ...
  });
}
```

**Analysis:**
- ✅ Correctly converts userId to ObjectId for query
- ⚠️ But collectionId is used as-is (could be string or number)

**Location:** Lines 122-172 (`startCook`)

```javascript
async startCook({ collectionId, userId, cookId, spellId, toolId, ... }) {
  // ...
  const key = this._getKey(collectionId, userId);  // collectionId used as-is
  const producedSoFar = await this._getProducedCount(collectionId, userId);
  // ...
}
```

**Issues:**
1. **MEDIUM:** collectionId type not validated - could be string, number, or ObjectId
2. **LOW:** No validation that userId is a valid ObjectId string before conversion

**Recommendation:**
- Add ObjectId validation for userId before conversion
- Standardize collectionId type (likely string based on cookCollectionsDb using uuidv4)

#### Issue 2.1.2: Cast Creation ObjectId Handling

**Location:** Lines 14-60 (`submitPiece`)

```javascript
async function submitPiece({ spellId, submission }) {
  if (spellId) {
    // ...
    const res = await internalApiClient.post(
      '/internal/v1/data/spells/casts',
      { spellId, initiatorAccountId: user.masterAccountId || user.userId || user.id },
      // ...
    );
    castId = res.data?._id?.toString() || res.data?.id;
    // ...
  }
}
```

**Analysis:**
- ✅ Has retry logic (3 attempts)
- ✅ Fails fast if castId not created
- ⚠️ Multiple fallback paths for user ID extraction

**Issues:**
1. **LOW:** Multiple fallback paths for user ID could lead to inconsistent types
2. **LOW:** No validation that initiatorAccountId is valid ObjectId format

**Recommendation:**
- Standardize user ID extraction to single source
- Add ObjectId format validation

### 2.2 CooksDB

**File:** `src/core/services/db/cooksDb.js`

#### Issue 2.2.1: ObjectId Conversion

**Location:** Lines 9-24 (`createCook`)

```javascript
async createCook({ collectionId, initiatorAccountId, targetSupply, status='running', metadata={} }){
  const doc={
    collectionId,
    initiatorAccountId: new ObjectId(initiatorAccountId),  // ✅ Converts to ObjectId
    targetSupply,
    // ...
  };
  // ...
}
```

**Analysis:**
- ✅ Correctly converts initiatorAccountId to ObjectId
- ⚠️ No validation that initiatorAccountId is valid ObjectId format before conversion

**Issues:**
1. **MEDIUM:** Will throw error if invalid ObjectId format provided
2. **LOW:** No type checking before conversion

**Recommendation:**
- Add ObjectId.isValid() check before conversion
- Provide clear error message on invalid format

#### Issue 2.2.2: addGeneration Method

**Location:** Lines 26-28 (`addGeneration`)

```javascript
async addGeneration(cookId, generationId){
  await this.updateOne({ _id: new ObjectId(cookId) }, { 
    $push:{ generationIds: new ObjectId(generationId) }, 
    $inc:{ generatedCount:1 }, 
    $set:{ updatedAt:new Date() } 
  });
}
```

**Analysis:**
- ✅ Converts both IDs to ObjectId
- ⚠️ No validation before conversion
- ⚠️ Method exists but may not be used (CookOrchestratorService uses internal API instead)

**Issues:**
1. **MEDIUM:** No validation before ObjectId conversion
2. **LOW:** Method may be unused (orchestrator uses API endpoint)

**Recommendation:**
- Add ObjectId validation
- Verify if method is actually used or can be removed

### 2.3 CookCollectionsDB

**File:** `src/core/services/db/cookCollectionsDb.js`

#### Issue 2.3.1: collectionId Type

**Location:** Lines 16-28 (`createCollection`)

```javascript
async createCollection({ name, description = '', userId, config = {} }) {
  const doc = {
    collectionId: uuidv4(),  // ✅ Uses UUID (string)
    name,
    description,
    userId,  // ⚠️ No ObjectId conversion
    config,
    // ...
  };
  // ...
}
```

**Analysis:**
- ✅ collectionId is UUID string (consistent)
- ⚠️ userId stored as-is (could be string or ObjectId)
- ⚠️ No validation of userId format

**Issues:**
1. **MEDIUM:** userId type not standardized
2. **LOW:** No validation of userId format

**Recommendation:**
- Standardize userId type (likely ObjectId based on other services)
- Add validation

### 2.4 Summary of Type Issues

**Critical Issues:** 0  
**Medium Issues:** 5  
**Low Issues:** 4

**Key Findings:**
- ObjectId conversions are generally correct but lack validation
- collectionId is UUID string (consistent)
- userId handling is inconsistent across services
- No centralized type validation utilities

---

## 3. State Management & Race Conditions

### 3.1 In-Memory State (runningByCollection Map)

**File:** `src/core/services/cook/CookOrchestratorService.js`

**Location:** Line 70

```javascript
this.runningByCollection = new Map(); // key: `${collectionId}:${userId}` → { running:Set(jobId), ... }
```

#### Issue 3.1.1: Race Condition in startCook

**Location:** Lines 130-136

```javascript
if (!this.runningByCollection.has(key)) {
  this.runningByCollection.set(key, { running: new Set(), nextIndex: producedSoFar, generatedCount: producedSoFar, total: supply, maxConcurrent: 3, toolId: toolId || null, cookId, spellId: spellId || null, traitTree, paramOverrides, traitTypes, paramsTemplate });
}
const state = this.runningByCollection.get(key);
this.logger.info(`[Cook DEBUG] State on start`, { nextIndex: state.nextIndex, runningSize: state.running.size, total: state.total });
state.nextIndex = Math.max(state.nextIndex, producedSoFar);
state.total = supply; // update if changed
```

**Issues:**
1. **CRITICAL:** Race condition - two concurrent `startCook` calls can both see `!has(key)` and create duplicate state
2. **MEDIUM:** State updates are not atomic - between `has()` check and `set()`, another call could modify state
3. **MEDIUM:** `state.total = supply` update happens after state creation, could be overwritten

**Impact:**
- Concurrent startCook calls can create duplicate state entries
- State corruption possible
- Supply limits may not be enforced correctly

**Recommendation:**
- Use atomic check-and-set pattern
- Consider using database-level locking or distributed lock
- Or use Map with proper synchronization

#### Issue 3.1.2: Race Condition in scheduleNext

**Location:** Lines 221-307

```javascript
async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
  const key = this._getKey(collectionId, userId);
  const state = this.runningByCollection.get(key);
  if (!state) return;
  state.running.delete(String(finishedJobId));
  
  // ... update cook document ...
  
  // Fill available slots up to maxConcurrent
  let queued = 0;
  while (
    state.running.size < state.maxConcurrent &&
    state.nextIndex < state.total
  ) {
    const producedNow = await this._getProducedCount(collectionId, userId);
    if (producedNow + state.running.size >= state.total) break;
    // ... enqueue piece ...
    state.running.add(String(enq.jobId));
    state.nextIndex += 1;
    // ...
  }
}
```

**Issues:**
1. **CRITICAL:** Race condition - multiple `scheduleNext` calls can run concurrently
2. **CRITICAL:** `producedNow` is fetched inside loop, but state is updated outside - can overschedule
3. **MEDIUM:** `state.running.size` check and `state.running.add()` are not atomic
4. **MEDIUM:** `state.nextIndex` increment can cause duplicate indices if concurrent

**Impact:**
- Can schedule more pieces than maxConcurrent
- Can exceed totalSupply
- Duplicate piece indices possible
- State corruption

**Recommendation:**
- Add mutex/lock per collection+user key
- Make state updates atomic
- Fetch producedNow once before loop, not inside
- Use database transaction for critical updates

#### Issue 3.1.3: State Cleanup

**Location:** Lines 256-267, 143-144

```javascript
// In scheduleNext:
if (producedAfter >= state.total && state.running.size === 0) {
  await this.appendEvent('CookCompleted', { collectionId, userId, cookId: state.cookId });
  // ...
  this.runningByCollection.delete(key);
  return;
}

// In startCook:
if (producedSoFar >= state.total) {
  // ...
  this.runningByCollection.delete(key);
  return { queued: 0 };
}
```

**Issues:**
1. **MEDIUM:** State cleanup happens in multiple places - could miss cleanup on error
2. **MEDIUM:** No cleanup on process restart (in-memory state lost)
3. **LOW:** State can persist indefinitely if completion check fails

**Impact:**
- Memory leak if state not cleaned up
- Stale state after restart
- Inconsistent state after errors

**Recommendation:**
- Centralize cleanup logic
- Add timeout/expiration for stale state
- Rebuild state from database on startup

### 3.2 Supply Counting Race Conditions

**Location:** Lines 99-117 (`_getProducedCount`)

```javascript
async _getProducedCount(collectionId, userId) {
  await this._init();
  const { ObjectId } = require('mongodb');
  return this.outputsCol.countDocuments({
    'metadata.collectionId': collectionId,
    masterAccountId: new ObjectId(userId),
    $and: [
      { $or: [
        { 'metadata.reviewOutcome': { $exists: false } },
        { 'metadata.reviewOutcome': { $ne: 'rejected' } },
      ]},
      { $or: [
        { reviewOutcome: { $exists: false } },
        { reviewOutcome: { $ne: 'rejected' } },
      ]},
      { deliveryStrategy: { $ne: 'spell_step' } },
    ],
  });
}
```

**Issues:**
1. **MEDIUM:** Query checks both `metadata.reviewOutcome` and top-level `reviewOutcome` - inconsistent schema
2. **MEDIUM:** Count is fetched multiple times in scheduleNext loop - can be stale
3. **LOW:** No index mentioned for this query (may be slow)

**Impact:**
- Inaccurate counts if schema inconsistent
- Race conditions if count changes between checks
- Performance issues without proper index

**Recommendation:**
- Standardize reviewOutcome field location
- Add database index for this query
- Consider caching count with TTL

---

## 4. Failure Handling & Error Recovery

### 4.1 Cast Creation Failure

**Location:** `CookOrchestratorService.js` lines 14-60

```javascript
async function submitPiece({ spellId, submission }) {
  if (spellId) {
    let castId;
    let retries = 3;
    while (retries > 0 && !castId) {
      try {
        const res = await internalApiClient.post(
          '/internal/v1/data/spells/casts',
          { spellId, initiatorAccountId: user.masterAccountId || user.userId || user.id },
          { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } }
        );
        castId = res.data?._id?.toString() || res.data?.id;
        if (castId) break; // Success
      } catch (err) {
        retries--;
        if (retries === 0) {
          throw new Error(`Failed to create cast record after 3 retries: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 1000 * (4 - retries)));
      }
    }
    
    if (!castId) {
      throw new Error('Failed to create cast record: No castId returned after retries');
    }
    // ...
  }
}
```

**Analysis:**
- ✅ Has retry logic with exponential backoff
- ✅ Fails fast after retries exhausted
- ⚠️ Error is thrown but may not be handled by caller

**Issues:**
1. **MEDIUM:** Error thrown but caller (startCook/scheduleNext) may not handle it properly
2. **LOW:** No logging of retry attempts

**Location:** Lines 156-166 (startCook)

```javascript
if (IMMEDIATE_SUBMIT) {
  try {
    const submission = enq.submission;
    if (ENABLE_VERBOSE_SUBMIT_LOGS) this.logger.info(`[CookOrchestrator] Immediate submit for job ${enqueuedJobId} (tool ${submission.toolId})`);
    const resp = await submitPiece({ spellId: spellId, submission });
    this.logger.info(`[Cook] Submitted piece. job=${enqueuedJobId} resp=${resp?.status || 'ok'}`);
  } catch (e) {
    this.logger.error(`[CookOrchestrator] Immediate submit failed: ${e.message}`);
  }
}
```

**Issues:**
1. **CRITICAL:** Error is caught and logged but cook continues - piece not submitted but state thinks it is
2. **CRITICAL:** `state.running.add(enqueuedJobId)` happens before submit - if submit fails, jobId is in running set but never completes
3. **MEDIUM:** No retry or recovery mechanism

**Impact:**
- Cook can get stuck if submit fails
- State inconsistency (running set has jobId but no actual generation)
- No way to recover from failed submission

**Recommendation:**
- Move `state.running.add()` to after successful submit
- Add retry logic for failed submissions
- Mark cook as failed if critical submissions fail

### 4.2 Cook Document Update Failure

**Location:** Lines 228-252 (scheduleNext)

```javascript
// --- Update the parent cook document with the completed generation ---
if (state.cookId && finishedJobId) {
  try {
    await this._init();
    const generation = await this.outputsCol.findOne({ 'metadata.jobId': String(finishedJobId) }, { projection: { _id: 1, costUsd: 1 } });
    
    if (!generation) {
      this.logger.warn(`[CookOrchestrator] Generation for jobId ${finishedJobId} not found – parent cook will not be updated.`);
    } else {
      const costDelta = typeof generation.costUsd === 'number' ? generation.costUsd : 0;
      await internalApiClient.put(`/internal/v1/data/cook/cooks/${state.cookId}`, {
        generationId: generation._id.toString(),
        costDeltaUsd: costDelta,
      });
      this.logger.info(`[CookOrchestrator] Updated cook ${state.cookId} with generation ${generation._id} (costUsd=${costDelta}).`);
    }
  } catch (err) {
    this.logger.error(`[CookOrchestrator] Failed to update cook ${state.cookId}: ${err.message}`);
  }
}
```

**Issues:**
1. **MEDIUM:** Error is caught and logged but cook continues - cost may not be tracked
2. **MEDIUM:** No retry logic for failed updates
3. **LOW:** Silent failure - cook document may be inconsistent

**Impact:**
- Cook cost tracking may be inaccurate
- Generation may not be linked to cook
- No way to recover missing updates

**Recommendation:**
- Add retry logic for cook updates
- Consider making updates idempotent
- Add reconciliation job to fix missing updates

### 4.3 Failed Pieces Don't Block Completion

**Location:** Lines 221-307 (scheduleNext)

```javascript
async scheduleNext({ collectionId, userId, finishedJobId, success = true }) {
  // ...
  state.running.delete(String(finishedJobId));
  
  // ... continues regardless of success value ...
}
```

**Analysis:**
- ✅ `success` parameter exists but not used to determine behavior
- ⚠️ Failed pieces are treated same as successful ones

**Issues:**
1. **LOW:** `success` parameter is ignored - failed pieces still advance cook
2. **LOW:** No distinction between failed and successful pieces in completion logic

**Impact:**
- Cook can complete even if all pieces failed
- No way to track failure rate
- May not meet quality requirements

**Recommendation:**
- Track failed pieces separately
- Add option to retry failed pieces
- Consider failure threshold for cook completion

---

## 5. Supply & Counting Logic

### 5.1 _getProducedCount Query Accuracy

**Location:** Lines 99-117

**Issues Identified:**
1. **MEDIUM:** Checks both `metadata.reviewOutcome` and top-level `reviewOutcome` - schema inconsistency
2. **MEDIUM:** Excludes `deliveryStrategy: 'spell_step'` - correct for cook pieces but may miss some
3. **LOW:** No validation that collectionId matches expected format

**Recommendation:**
- Standardize reviewOutcome field location
- Add index: `{ 'metadata.collectionId': 1, masterAccountId: 1, 'metadata.reviewOutcome': 1 }`
- Add validation

### 5.2 Supply Limit Enforcement

**Location:** Lines 140-145, 148-149, 272-277

```javascript
// In startCook:
if (producedSoFar >= state.total) {
  this.logger.info(`[CookOrchestrator] Supply already met for collection ${collectionId}. Nothing to do.`);
  await this.appendEvent('CookCompleted', { collectionId, userId });
  this.runningByCollection.delete(key);
  return { queued: 0 };
}

if (state.nextIndex < state.total && (state.generatedCount + state.running.size) < state.total) {
  // ... submit piece ...
}

// In scheduleNext:
while (
  state.running.size < state.maxConcurrent &&
  state.nextIndex < state.total
) {
  const producedNow = await this._getProducedCount(collectionId, userId);
  if (producedNow + state.running.size >= state.total) break;
  // ...
}
```

**Issues:**
1. **CRITICAL:** Multiple checks use different logic:
   - `producedSoFar >= state.total` (startCook)
   - `(state.generatedCount + state.running.size) < state.total` (startCook)
   - `producedNow + state.running.size >= state.total` (scheduleNext)
2. **CRITICAL:** `state.generatedCount` may be stale - not updated from database
3. **MEDIUM:** `state.nextIndex` can exceed `state.total` if concurrent calls

**Impact:**
- Can exceed supply limit
- Inconsistent supply checking
- Off-by-one errors possible

**Recommendation:**
- Use single source of truth for supply check (always query database)
- Remove `state.generatedCount` - always use `_getProducedCount()`
- Add atomic supply check before submission

### 5.3 Off-by-One Errors

**Location:** Multiple

**Potential Issues:**
1. **LOW:** `state.nextIndex` starts at `producedSoFar` - if 5 pieces produced, nextIndex is 5 (0-indexed?)
2. **LOW:** Piece index assignment uses `index: idx` - need to verify if 0-indexed or 1-indexed

**Recommendation:**
- Document indexing scheme clearly
- Add tests for boundary conditions (0 pieces, 1 piece, exactly totalSupply pieces)

---

## 6. Metadata Validation

### 6.1 Required Fields Validation

**Location:** `CookOrchestratorService.js` lines 122-124

```javascript
async startCook({ collectionId, userId, cookId, spellId, toolId, traitTypes = [], paramsTemplate = {}, traitTree = [], paramOverrides = {}, totalSupply = 1 }) {
  await this._init();
  if (!spellId && !toolId) throw new Error('spellId or toolId required');
```

**Issues:**
1. **MEDIUM:** No validation that collectionId exists
2. **MEDIUM:** No validation that userId is valid format
3. **MEDIUM:** No validation that cookId matches cook document (if provided)
4. **LOW:** No validation of totalSupply > 0

**Recommendation:**
- Add validation for all required fields
- Verify collectionId exists in database
- Validate userId format (ObjectId)
- Validate totalSupply is positive integer

### 6.2 Metadata Propagation

**Location:** Lines 196-209 (`_enqueuePiece`)

```javascript
const submission = {
  toolId: spellIdOrToolId,
  inputs: finalParams || {},
  user: { masterAccountId: userId, platform: 'none' },
  metadata: {
    source: 'cook',
    collectionId,
    cookId,
    pieceIndex,
    toolId: spellIdOrToolId,
    selectedTraits,
    paramSnapshot: finalParams || {},
  }
};
```

**Issues:**
1. **LOW:** `platform: 'none'` - should probably be 'cook'
2. **LOW:** `metadata.jobId` set later (line 213) - could be confusing
3. **MEDIUM:** No validation that required metadata fields are present before submission

**Recommendation:**
- Change platform to 'cook'
- Validate metadata before submission
- Document required metadata fields

---

## 7. Integration Points

### 7.1 Webhook Processor

**Location:** `src/core/services/comfydeploy/webhookProcessor.js` lines 454-472

```javascript
if (generationRecord && updatePayload.status === 'completed') {
  try {
    const meta = generationRecord.metadata || {};
    const collectionId = meta.collectionId;
    const finishedJobId = meta.jobId;
    if (collectionId && finishedJobId) {
      await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId, userId: String(generationRecord.masterAccountId), jobId: finishedJobId, generationId });
      try {
        await CookOrchestratorService.scheduleNext({ collectionId, userId: String(generationRecord.masterAccountId), finishedJobId, success: true });
      } catch (e) {
        logger.warn(`[Webhook Processor] scheduleNext error: ${e.message}`);
      }
    }
  } catch (e) {
    logger.warn(`[Webhook Processor] Cook scheduling hook failed: ${e.message}`);
  }
}
```

**Issues:**
1. **MEDIUM:** Error handling swallows errors - cook may not advance if scheduleNext fails
2. **MEDIUM:** No retry logic for failed scheduleNext calls
3. **LOW:** Always passes `success: true` - doesn't check actual generation status

**Recommendation:**
- Add retry logic for scheduleNext failures
- Check generation status before marking as success
- Add alerting for repeated failures

### 7.2 Notification Dispatcher

**Location:** `src/core/services/notificationDispatcher.js` lines 311-325

```javascript
async _maybeAdvanceCook(record) {
  if (record.notificationPlatform !== 'cook') return;
  const meta = record.metadata || {};
  const { collectionId, cookId, jobId } = meta;
  const userId = String(record.masterAccountId || '') || null;
  if (!collectionId || !userId || !jobId) return;

  try {
    await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId, userId, jobId, generationId: record._id });
    await CookOrchestratorService.scheduleNext({ collectionId, userId, finishedJobId: jobId, success: record.status === 'completed' });
    this.logger.info(`[NotificationDispatcher] Cook orchestration progressed for collection ${collectionId}, job ${jobId}`);
  } catch (err) {
    this.logger.error(`[NotificationDispatcher] Error advancing cook for collection ${collectionId}:`, err.message);
  }
}
```

**Analysis:**
- ✅ **May be necessary** for polling-based async tools (HuggingFace JoyCaption)
- ✅ Polling tools use async adapters that emit generationUpdated events
- ✅ Notification dispatcher listens for these events and calls scheduleNext
- ⚠️ Can cause duplicate calls if same generation triggers both webhook and notification dispatcher

**Tool Execution Types Requiring scheduleNext:**
1. **Immediate/Synchronous** (String, ChatGPT) → Execution API
2. **Webhook-based Async** (ComfyUI) → Webhook Processor
3. **Polling-based Async** (HuggingFace JoyCaption) → Notification Dispatcher

**Issues:**
1. **CRITICAL:** Can cause duplicate scheduleNext calls if same generation triggers multiple paths
2. **CRITICAL:** No idempotency check - same jobId can trigger multiple scheduleNext calls
3. **MEDIUM:** Need to verify if polling tools also trigger webhook processor (making this redundant)

**Impact:**
- Can schedule duplicate pieces
- Can exceed supply limit
- State corruption

**Recommendation:**
- Evaluate if notification dispatcher is redundant (check if polling tools also trigger webhook)
- **Add idempotency check** in scheduleNext to prevent duplicate processing regardless
- Add mutex to prevent race conditions

### 7.3 Generation Execution API

**Location:** `src/api/internal/generations/generationExecutionApi.js` lines 527-537, 647-653

```javascript
// If this was submitted by Cook orchestrator, schedule next immediately
try {
  const isCook = metadata && metadata.source === 'cook' && metadata.collectionId && metadata.jobId;
  if (isCook) {
    const { CookOrchestratorService } = require('../../../core/services/cook');
    await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId: metadata.collectionId, userId: String(user.masterAccountId), jobId: metadata.jobId, generationId: staticPayload.generationId });
    await CookOrchestratorService.scheduleNext({ collectionId: metadata.collectionId, userId: String(user.masterAccountId), finishedJobId: metadata.jobId, success: true });
  }
} catch (e) {
  logger.warn(`[Execute] Cook scheduleNext (static) error: ${e.message}`);
}
```

**Analysis:**
- ✅ **Necessary** for immediate/synchronous tools (String, ChatGPT)
- ✅ These tools complete synchronously and don't go through webhook
- ⚠️ Can cause duplicate calls if same generation triggers multiple paths

**Tool Execution Types:**
1. **Immediate/Synchronous** (String, ChatGPT)
   - Complete synchronously in execution API
   - scheduleNext called here (lines 527-537, 644-654)
   - **Necessary** - no webhook involved

2. **Webhook-based Async** (ComfyUI)
   - Start job, complete via webhook
   - scheduleNext called in webhook processor
   - **Necessary** - webhook is completion signal

3. **Polling-based Async** (HuggingFace JoyCaption)
   - Use async adapters with polling
   - Polling detects completion, emits generationUpdated event
   - scheduleNext called in notification dispatcher
   - **May be necessary** - depends on whether polling tools also trigger webhook

**Issues:**
1. **CRITICAL:** Multiple paths can call scheduleNext for same generation
2. **CRITICAL:** No idempotency check - duplicate processing possible
3. **MEDIUM:** Need to verify if notification dispatcher is redundant for polling tools

**Impact:**
- Can schedule multiple pieces instead of 1
- Can exceed supply limit
- State corruption

**Recommendation:**
- Keep scheduleNext in execution API (for immediate tools)
- Keep scheduleNext in webhook processor (for webhook tools)
- Evaluate notification dispatcher (may be needed for polling tools)
- **Add idempotency check** to prevent duplicate processing
- Add mutex to prevent race conditions

---

## 8. Concurrency Control

### 8.1 Mutex/Locking Mechanism (Required Fix)

**Problem:** In-memory state (`runningByCollection` Map) is accessed concurrently without locking, causing race conditions.

**Solution:** Implement home-baked async mutex using promise chains.

**Implementation:**

```javascript
class CookOrchestratorService {
  constructor() {
    // ... existing code ...
    this.locks = new Map(); // key -> Promise (mutex chain)
  }

  /**
   * Acquire lock for a specific collection+user key
   * Uses promise chain pattern to serialize operations
   * Returns a function to release the lock
   */
  async _acquireLock(key) {
    // Get or create lock promise chain for this key
    if (!this.locks.has(key)) {
      this.locks.set(key, Promise.resolve());
    }
    
    // Add ourselves to the chain - wait for previous operations
    const previousLock = this.locks.get(key);
    let releaseLock;
    const ourLock = previousLock.then(() => {
      return new Promise(resolve => {
        releaseLock = resolve; // Store release function
      });
    });
    
    // Update chain with our lock
    this.locks.set(key, ourLock);
    
    // Wait for our turn
    await ourLock;
    
    // Return release function
    return () => {
      releaseLock(); // Release lock, allowing next operation
    };
  }
}
```

**How It Works:**
1. First call: Creates lock chain starting with `Promise.resolve()`, proceeds immediately
2. Second call: Waits for first call's lock promise, adds itself to chain
3. First call finishes: Calls `releaseLock()`, resolves second call's promise
4. Second call proceeds: Now has exclusive access
5. Result: Operations are serialized per key, preventing race conditions

**Usage:**

```javascript
async scheduleNext({ collectionId, userId, finishedJobId }) {
  const key = this._getKey(collectionId, userId);
  
  // Acquire lock - wait for any concurrent operations to finish
  const releaseLock = await this._acquireLock(key);
  
  try {
    const state = this.runningByCollection.get(key);
    if (!state) {
      releaseLock();
      return;
    }
    
    // Protected code - only one operation can run at a time per key
    state.running.delete(String(finishedJobId));
    
    while (state.running.size < state.maxConcurrent && state.nextIndex < state.total) {
      // ... safe to modify state here ...
      state.running.add(String(enq.jobId));
      state.nextIndex += 1;
    }
  } finally {
    releaseLock(); // Always release lock, even on error
  }
}
```

**Benefits:**
- No external library needed
- Simple promise chain pattern
- Per-key locking (different collections don't block each other)
- Automatic cleanup (lock chain is self-managing)

### 8.2 maxConcurrent Enforcement

**Location:** Lines 272-305

**Issues:**
1. **CRITICAL:** Race condition - `state.running.size < state.maxConcurrent` check and `state.running.add()` are not atomic
2. **CRITICAL:** Multiple concurrent scheduleNext calls can all pass the check
3. **MEDIUM:** maxConcurrent is hardcoded to 3 (line 131) - not configurable

**Impact:**
- Can exceed maxConcurrent limit
- Resource exhaustion
- Poor performance

**Recommendation:**
- **Use mutex (from 8.1)** to ensure atomic operations
- Make maxConcurrent configurable
- Add monitoring/alerting for concurrency violations

### 8.3 State Updates Not Atomic

**Location:** Throughout scheduleNext

**Issues:**
1. **CRITICAL:** Multiple state fields updated separately:
   - `state.running.add()`
   - `state.nextIndex += 1`
   - `state.generatedCount = producedNow`
2. **CRITICAL:** No transaction or lock - updates can be interleaved

**Impact:**
- State corruption
- Inconsistent state
- Duplicate indices

**Recommendation:**
- Use mutex/lock per collection+user key
- Or move critical state to database
- Make updates atomic

---

## 9. Cook Document Management

### 9.1 Cook Creation

**Location:** `src/api/internal/cookApi.js` lines 28-30

```javascript
if(!cooksDb) return res.status(503).json({ error: 'cooksDb-unavailable' });
const cook = await cooksDb.createCook({ collectionId, initiatorAccountId: userId, targetSupply: totalSupply });
const cookId = cook._id;
```

**Analysis:**
- ✅ Cook created before orchestration starts
- ✅ cookId passed to orchestrator
- ⚠️ No validation that collectionId exists
- ⚠️ No validation that user owns collection

**Issues:**
1. **MEDIUM:** No validation that collection exists
2. **MEDIUM:** No authorization check - user can cook any collectionId
3. **LOW:** No validation that targetSupply is reasonable

**Recommendation:**
- Verify collection exists
- Check user authorization
- Add validation for targetSupply

### 9.2 Generation Tracking

**Location:** `CookOrchestratorService.js` lines 228-252

**Issues:**
1. **MEDIUM:** Generation lookup uses `metadata.jobId` - may not find generation if jobId format differs
2. **MEDIUM:** No retry if generation not found immediately
3. **LOW:** Cost aggregation happens incrementally - no reconciliation

**Recommendation:**
- Add retry logic for generation lookup
- Add reconciliation job to fix missing links
- Consider batch updates for cost aggregation

### 9.3 Cook Status Updates

**Location:** Lines 259-265

```javascript
if (state.cookId) {
    try {
        await internalApiClient.put(`/internal/v1/data/cook/cooks/${state.cookId}`, { status: 'completed' });
    } catch(err) {
        this.logger.error(`[CookOrchestrator] Failed to finalize cook ${state.cookId}:`, err.message);
    }
}
```

**Issues:**
1. **MEDIUM:** Error caught but cook may remain in 'running' status
2. **LOW:** No retry logic

**Recommendation:**
- Add retry logic
- Add reconciliation job for stuck cooks

---

## 10. Event System

### 10.1 Event Emission

**Location:** Lines 90-93, 138, 154, 257, 296

**Events Emitted:**
- CookStarted
- PieceQueued
- PieceGenerated (via appendEvent calls)
- CookCompleted

**Issues:**
1. **LOW:** Events written to cook_events collection but may not be used
2. **LOW:** No validation that event data is complete
3. **MEDIUM:** Event emission happens in multiple places - could miss events on error

**Recommendation:**
- Verify if events are still needed
- Add validation for event data
- Centralize event emission

### 10.2 Projection Updater

**Location:** `CookProjectionUpdater.js`

**Issues:**
1. **MEDIUM:** May be deprecated but still initialized
2. **LOW:** Change stream can fail silently
3. **LOW:** Polling fallback may not catch all events

**Recommendation:**
- Evaluate if still needed
- Improve error handling
- Add monitoring

---

## 11. API Security & Validation

### 11.1 Input Validation

**Location:** `src/api/internal/cookApi.js`

**Issues:**
1. **MEDIUM:** `/start` endpoint validates collectionId and userId exist but not format
2. **MEDIUM:** No validation of totalSupply range
3. **MEDIUM:** No validation of traitTree/paramOverrides structure
4. **LOW:** No rate limiting

**Recommendation:**
- Add input validation middleware
- Validate all input formats
- Add rate limiting

### 11.2 Authorization

**Location:** Multiple endpoints

**Issues:**
1. **CRITICAL:** No authorization check - user can cook any collectionId
2. **CRITICAL:** No check that user owns collection
3. **MEDIUM:** userId extracted from multiple sources (req.user, req.body, req.query) - inconsistent

**Impact:**
- Users can cook collections they don't own
- Security vulnerability

**Recommendation:**
- Add authorization middleware
- Verify user owns collection before cooking
- Standardize userId extraction

---

## Summary of Critical Issues

1. **CRITICAL:** Race conditions in startCook and scheduleNext - can cause state corruption
2. **CRITICAL:** Triple scheduleNext calls (webhook, dispatcher, execution API) - can exceed supply
3. **CRITICAL:** No authorization checks - users can cook any collection
4. **CRITICAL:** State updates not atomic - can cause duplicate pieces
5. **CRITICAL:** Failed submissions still mark jobId as running - cook can get stuck

## Summary of Medium Issues

1. **MEDIUM:** Deprecated components still in use (CookJobStore, CookProjectionUpdater)
2. **MEDIUM:** Type validation missing (ObjectId, collectionId)
3. **MEDIUM:** Supply counting uses inconsistent logic
4. **MEDIUM:** Error handling swallows errors - no recovery
5. **MEDIUM:** No retry logic for critical operations

## Next Steps

1. Fix critical race conditions
2. Remove duplicate scheduleNext calls
3. Add authorization checks
4. Add type validation
5. Improve error handling and recovery
6. Remove deprecated components
7. Add comprehensive tests

